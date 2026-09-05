import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  automaticRetryPlan,
  createFighterJobs,
  isJobAccessible,
  parseProgressEvent,
  publicCharacterMetadata,
  submissionSettings,
  uploaderToken,
} from "./fighter-jobs.js";
import { createTurnstileVerifier } from "./turnstile.js";

// Keep the in-process queue from spawning the real pipeline during tests.
process.env.FIGHTER_WORKER_DISABLED = "1";

const PNG_HEADER = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function uploadRequest({ name = "Test Fighter", turnstileToken = null, headers = {} } = {}) {
  const boundary = "opensmash-test-boundary";
  const head = [
    `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="rightsAttested"\r\n\r\ntrue\r\n`,
    turnstileToken === null
      ? ""
      : `--${boundary}\r\nContent-Disposition: form-data; name="cf-turnstile-response"\r\n\r\n${turnstileToken}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="fighter.png"\r\n`,
    "Content-Type: image/png\r\n\r\n",
  ].join("");
  const request = Readable.from([
    Buffer.concat([Buffer.from(head), PNG_HEADER, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  ]);
  request.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, ...headers };
  return request;
}

async function harness({ storedJobs = [], moderator = async () => ({ status: "approved" }), driver = "local", dispatch = async () => ({ executionName: "exec" }), turnstile = null, reservedSlugs = undefined, watch = () => null } = {}) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "opensmash-jobs-test-"));
  await mkdir(path.join(appRoot, "data", "fighter-jobs"), { recursive: true });
  const saved = [];
  const jobDatabase = {
    list: async () => storedJobs,
    insert: async () => {},
    save: async (job) => { saved.push(job); },
    watch,
  };
  const objectStore = {
    putFile: async (key) => ({ key, url: null }),
    putJson: async (key) => ({ key, url: null }),
    getFile: async () => {},
  };
  const jobs = createFighterJobs({
    appRoot,
    repoRoot: appRoot,
    engineRoot: appRoot,
    pipelineUiRoot: path.join(appRoot, "ui"),
    objectStore,
    jobDatabase,
    dispatcher: { driver, dispatch },
    submissionModerator: moderator,
    turnstile,
    ...(reservedSlugs ? { reservedSlugs } : {}),
  });
  return { jobs, saved, cleanup: () => rm(appRoot, { recursive: true, force: true }) };
}

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

function storedJob(overrides = {}) {
  return {
    protocolVersion: 1,
    id: overrides.id || "11111111-1111-1111-1111-111111111111",
    ownerId: "owner-1",
    name: "Stored",
    slug: overrides.slug || "stored",
    visibility: "public",
    status: "failed",
    stage: "failed",
    progress: 0,
    createdAt: minutesAgo(60 * 48),
    updatedAt: minutesAgo(60 * 48),
    retry: { automaticCounts: { moderation: 2, transient: 0 }, nextAttemptAt: null, label: null },
    logTail: [],
    ...overrides,
  };
}

test("parallel uploads from one account cannot all pass the active-job quota", async () => {
  let releaseModeration;
  const gate = new Promise((resolve) => { releaseModeration = resolve; });
  const { jobs, cleanup } = await harness({ moderator: async () => { await gate; return { status: "approved" }; } });
  try {
    const first = jobs.create(uploadRequest({ name: "Alpha" }), { uid: "owner-1" });
    // The second and third requests arrive while the first is still awaiting
    // moderation; they must be refused immediately, not after it finishes.
    await assert.rejects(
      jobs.create(uploadRequest({ name: "Beta" }), { uid: "owner-1" }),
      (error) => error.status === 429 && /Finish your current fighter/.test(error.message),
    );
    await assert.rejects(
      jobs.create(uploadRequest({ name: "Gamma" }), { uid: "owner-1" }),
      (error) => error.status === 429,
    );
    releaseModeration();
    const job = await first;
    assert.equal(job.status, "queued");
    assert.match(job.slug, /^alpha[a-z0-9]{6}$/);
    // Once the job exists it still holds the slot on its own.
    await assert.rejects(
      jobs.create(uploadRequest({ name: "Delta" }), { uid: "owner-1" }),
      (error) => error.status === 429,
    );
  } finally {
    await cleanup();
  }
});

test("a failed upload releases its quota reservation", async () => {
  const { jobs, cleanup } = await harness({ moderator: async () => { throw Object.assign(new Error("blocked"), { status: 422 }); } });
  try {
    await assert.rejects(jobs.create(uploadRequest({ name: "Alpha" }), { uid: "owner-1" }), /blocked/);
    // A second attempt gets as far as moderation again instead of a 429.
    await assert.rejects(jobs.create(uploadRequest({ name: "Beta" }), { uid: "owner-1" }), /blocked/);
  } finally {
    await cleanup();
  }
});

test("manual retries are capped per job and keep the automatic budget", async () => {
  const stored = storedJob();
  const { jobs, saved, cleanup } = await harness({ storedJobs: [stored] });
  try {
    await jobs.init();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const job = await jobs.retry(stored.id, "owner-1");
      assert.equal(job.status, "queued");
      assert.equal(job.retry.manualRetriesAt.length, attempt);
      assert.equal(job.retry.automaticCounts.moderation, 2);
      saved.at(-1).status = "failed"; // simulate the worker failing again
    }
    await assert.rejects(
      jobs.retry(stored.id, "owner-1"),
      (error) => error.status === 429 && /used all of its retries/.test(error.message),
    );
  } finally {
    await cleanup();
  }
});

test("manual retries count against the daily limit", async () => {
  const recent = storedJob({ createdAt: minutesAgo(10), updatedAt: minutesAgo(10) });
  const older = storedJob({
    id: "22222222-2222-2222-2222-222222222222", slug: "older",
    retry: { automaticCounts: { moderation: 0, transient: 0 }, nextAttemptAt: null, label: null, manualRetriesAt: [minutesAgo(5), minutesAgo(4)] },
  });
  // Pin the per-account daily limit so the assertion does not track the default.
  const previousLimit = process.env.MAX_DAILY_JOBS_PER_OWNER;
  process.env.MAX_DAILY_JOBS_PER_OWNER = "3";
  const { jobs, cleanup } = await harness({ storedJobs: [recent, older] });
  try {
    await jobs.init();
    // One creation plus two retries today already equals the daily limit of 3.
    await assert.rejects(
      jobs.retry(recent.id, "owner-1"),
      (error) => error.status === 429 && /daily fighter limit/.test(error.message),
    );
  } finally {
    if (previousLimit === undefined) delete process.env.MAX_DAILY_JOBS_PER_OWNER;
    else process.env.MAX_DAILY_JOBS_PER_OWNER = previousLimit;
    await cleanup();
  }
});

test("a queued job that was never dispatched is reconciled as interrupted", async () => {
  const stuck = storedJob({ status: "queued", stage: "queued", updatedAt: minutesAgo(10), createdAt: minutesAgo(10) });
  const fresh = storedJob({
    id: "22222222-2222-2222-2222-222222222222", slug: "fresh", ownerId: "owner-2", status: "queued", stage: "queued",
    updatedAt: minutesAgo(1), createdAt: minutesAgo(1),
  });
  const { jobs, cleanup } = await harness({ storedJobs: [stuck, fresh], driver: "cloud-run" });
  try {
    await jobs.init();
    assert.equal(jobs.get(stuck.id).status, "failed");
    assert.equal(jobs.get(stuck.id).stage, "interrupted");
    assert.equal(jobs.get(fresh.id).status, "queued");
    // The owner can start something new again.
    const retried = await jobs.retry(stuck.id, "owner-1");
    assert.equal(retried.status, "queued");
  } finally {
    await cleanup();
  }
});

test("the dispatch record is saved before the worker is contacted and never after", async () => {
  const failed = storedJob({ status: "failed", stage: "failed", createdAt: minutesAgo(5), updatedAt: minutesAgo(5) });
  let savesWhenDispatched = null;
  let dispatchedSnapshot = null;
  const { jobs, saved, cleanup } = await harness({
    storedJobs: [failed],
    driver: "cloud-run-service",
    dispatch: async (job) => {
      // A warm worker claims the job here; a save after this point would
      // overwrite its lease with the API's stale copy.
      savesWhenDispatched = saved.length;
      dispatchedSnapshot = structuredClone(saved.at(-1));
      return { executionName: "worker-1-7" };
    },
  });
  try {
    await jobs.init();
    const retried = await jobs.retry(failed.id, "owner-1");
    assert.equal(retried.status, "queued");
    assert.equal(dispatchedSnapshot.status, "queued");
    assert.equal(typeof dispatchedSnapshot.dispatch.dispatchedAt, "string");
    assert.equal(dispatchedSnapshot.dispatch.executionName, null);
    assert.equal(saved.length, savesWhenDispatched, "no save after the worker accepted");
  } finally {
    await cleanup();
  }
});

test("cancel frees the owner's slot and the job stays retryable", async () => {
  const queued = storedJob({ status: "queued", stage: "queued", createdAt: minutesAgo(1), updatedAt: minutesAgo(1) });
  const { jobs, cleanup } = await harness({ storedJobs: [queued] });
  try {
    await jobs.init();
    await assert.rejects(jobs.create(uploadRequest({ name: "Beta" }), { uid: "owner-1" }), (error) => error.status === 429);
    const cancelled = await jobs.cancel(queued.id, "owner-1");
    assert.equal(cancelled.status, "cancelled");
    await assert.rejects(jobs.cancel(queued.id, "owner-2"), (error) => error.status === 404);
    const created = await jobs.create(uploadRequest({ name: "Beta" }), { uid: "owner-1" });
    assert.equal(created.status, "queued");
    await jobs.cancel(created.id, "owner-1");
    assert.equal((await jobs.retry(queued.id, "owner-1")).status, "queued");
  } finally {
    await cleanup();
  }
});

test("published character metadata omits the model's description of the person", () => {
  assert.deepEqual(
    publicCharacterMetadata({ display: "Ada", short: "ADA", desc: "a woman in her 30s...", emblem: "a brass gear", refs: [], cost_usd: 0.1 }),
    { display: "Ada", short: "ADA", emblem: "a brass gear" },
  );
  assert.equal(uploaderToken("firebase-uid", "salt"), uploaderToken("firebase-uid", "salt"));
  assert.notEqual(uploaderToken("firebase-uid", "salt"), uploaderToken("firebase-uid", "other"));
  assert.doesNotMatch(uploaderToken("firebase-uid", "salt"), /firebase/);
  assert.equal(uploaderToken(null), null);
});

test("malformed multipart uploads do not leave an unhandled file-write rejection", async () => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "opensmash-upload-test-"));
  await mkdir(path.join(appRoot, "data", "fighter-jobs"), { recursive: true });
  const boundary = "opensmash-test-boundary";
  const request = Readable.from([
    Buffer.from([
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="photo"; filename="fighter.png"\r\n',
      "Content-Type: image/png\r\n",
      "\r\n",
      "not-a-complete-multipart-body",
    ].join("")),
  ]);
  request.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  const jobs = createFighterJobs({
    appRoot,
    repoRoot: appRoot,
    engineRoot: appRoot,
    pipelineUiRoot: appRoot,
    objectStore: {},
    jobDatabase: {},
    dispatcher: { driver: "local" },
  });

  try {
    await assert.rejects(
      jobs.create(request, { uid: "upload-test-user" }),
      /Unexpected end of form/,
    );
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("output moderation retries are bounded", () => {
  const log = `provider error: {'code': 'moderation_blocked', 'moderation_stage': 'output'}`;
  assert.equal(automaticRetryPlan(log, "portrait", {}).kind, "moderation");
  assert.equal(automaticRetryPlan(log, "portrait", { moderation: 2 }), null);
});

test("transient retries skip expensive mesh stages", () => {
  assert.equal(automaticRetryPlan("HTTP 503 server_error", "portrait", {}).kind, "transient");
  assert.equal(automaticRetryPlan("HTTP 503 server_error", "mesh-build", {}), null);
});

test("structured pipeline progress is validated", () => {
  const line = '@@opensmash {"protocolVersion":1,"type":"job.progress","stage":"portrait","label":"Painting character-select art","progress":75}';
  assert.deepEqual(parseProgressEvent(line), {
    key: "portrait",
    label: "Painting character-select art",
    progress: 75,
  });
  assert.equal(parseProgressEvent("@@opensmash not-json"), null);
});

test("submission visibility defaults private and requires rights attestation", () => {
  assert.deepEqual(submissionSettings({ rightsAttested: "true" }), { visibility: "private" });
  assert.deepEqual(
    submissionSettings({ rightsAttested: "true", visibility: "private" }),
    { visibility: "private" },
  );
  assert.throws(
    () => submissionSettings({ visibility: "public" }),
    (error) => error.status === 400 && /rights or permission/.test(error.message),
  );
});

test("private fighter assets are only accessible to their uploader", () => {
  const privateJob = { visibility: "private", ownerId: "owner-1" };
  assert.equal(isJobAccessible(privateJob, "owner-1"), true);
  assert.equal(isJobAccessible(privateJob, "owner-2"), false);
  assert.equal(isJobAccessible(privateJob), false);
  assert.equal(isJobAccessible({ visibility: "public", ownerId: "owner-1" }), true);
});

test("the human check gates creation, sees the client address, and releases the quota slot on failure", async () => {
  const calls = [];
  const turnstile = createTurnstileVerifier({
    secretKey: "secret",
    siteKey: "site",
    fetchImpl: async (url, init) => {
      const body = Object.fromEntries(init.body);
      calls.push(body);
      return { json: async () => ({ success: body.response === "good-token" }) };
    },
  });
  const { jobs, cleanup } = await harness({ turnstile });
  try {
    await jobs.init();
    // Missing token: rejected before moderation, nothing created, and the
    // account's single active slot is free again.
    await assert.rejects(
      jobs.create(uploadRequest({ name: "Alpha" }), { uid: "owner-1" }),
      (error) => error.status === 403 && /human check/.test(error.message),
    );
    assert.equal(calls.length, 0, "no siteverify call without a token");
    // Rejected token: siteverify was consulted with the forwarded address.
    await assert.rejects(
      jobs.create(uploadRequest({ name: "Alpha", turnstileToken: "bad-token", headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }), { uid: "owner-1" }),
      (error) => error.status === 403 && /failed/.test(error.message),
    );
    assert.deepEqual(calls.at(-1), { secret: "secret", response: "bad-token", remoteip: "203.0.113.7" });
    // Accepted token: the same account can now create, proving the two
    // failed attempts did not leak a reservation.
    const created = await jobs.create(uploadRequest({ name: "Alpha", turnstileToken: "good-token" }), { uid: "owner-1" });
    assert.equal(created.name, "Alpha");
    assert.equal(calls.length, 2);
  } finally {
    await cleanup();
  }
});

test("creation skips the human check when Turnstile is not configured", async () => {
  const { jobs, cleanup } = await harness({ turnstile: createTurnstileVerifier({ secretKey: "", isProduction: false }) });
  try {
    await jobs.init();
    const created = await jobs.create(uploadRequest({ name: "Alpha" }), { uid: "owner-1" });
    assert.equal(created.name, "Alpha");
  } finally {
    await cleanup();
  }
});

test("generated fighters get unique slugs that avoid the baked roster and each other", async () => {
  // Every candidate for "Alpha" is reserved except the one deterministic
  // suffix we let through, proving the baked-roster set is consulted.
  const seen = [];
  const reservedSlugs = async () => ({
    has: (slug) => {
      seen.push(slug);
      return seen.length < 3; // reject the first two candidates
    },
  });
  const { jobs, cleanup } = await harness({ reservedSlugs });
  try {
    await jobs.init();
    const first = await jobs.create(uploadRequest({ name: "Alpha" }), { uid: "owner-1" });
    assert.equal(seen.length, 3);
    assert.match(first.slug, /^alpha[a-z0-9]{6}$/);
    assert.equal(first.name, "Alpha");
    // A second player can make the same name: different slug, no 409.
    const second = await jobs.create(uploadRequest({ name: "Alpha" }), { uid: "owner-2" });
    assert.match(second.slug, /^alpha[a-z0-9]{6}$/);
    assert.notEqual(second.slug, first.slug);
  } finally {
    await cleanup();
  }
});

test("a delete observed from the database drops the job on this instance too", async () => {
  let listener = null;
  const stored = {
    id: "33333333-3333-3333-3333-333333333333", slug: "goneabc123", ownerId: "owner-1", name: "Gone",
    status: "complete", stage: "complete", visibility: "public", createdAt: minutesAgo(30),
    retry: { automaticCounts: { moderation: 0, transient: 0 }, nextAttemptAt: null, label: null, manualRetriesAt: [] },
  };
  const { jobs, cleanup } = await harness({ storedJobs: [stored], watch: (fn) => { listener = fn; return () => {}; } });
  try {
    await jobs.init();
    assert.equal(jobs.listVisible().length, 1);
    const events = [];
    jobs.subscribe(stored.id, "owner-1", (event) => events.push(event));
    listener({ ...stored }, { removed: true });
    assert.equal(jobs.listVisible().length, 0);
    assert.equal(jobs.get(stored.id, "owner-1"), null);
    assert.equal(events.at(-1).status, "deleted");
    // The slug is free again for the same name on this instance.
    assert.equal(jobs.isSlugPublic("goneabc123"), false);
  } finally {
    await cleanup();
  }
});


test("fighter target settings persist and only the owner can choose built targets", async () => {
  const original = storedJob({ status: "complete", artifacts: { targets: ["luigi", "fox"] } });
  const h = await harness({ storedJobs: [original] });
  try {
    await h.jobs.init();
    await assert.rejects(h.jobs.updateSettings(original.id, "someone-else", { retarget: "luigi" }), { status: 404 });
    for (const retarget of ["auto", "ness", "unknown", null]) {
      await assert.rejects(h.jobs.updateSettings(original.id, "owner-1", { retarget }), { status: 400 });
    }
    const updated = await h.jobs.updateSettings(original.id, "owner-1", { retarget: "luigi" });
    assert.equal(updated.character.fkind, 4);
    assert.equal(updated.character.base, "luigi");
    assert.equal(h.saved.at(-1).retarget, "luigi");
    assert.equal(h.jobs.get(original.id, "owner-1").character.fkind, 4);
    const reloaded = await harness({ storedJobs: [h.saved.at(-1)] });
    try {
      await reloaded.jobs.init();
      assert.equal(reloaded.jobs.get(original.id, "owner-1").character.base, "luigi");
    } finally { await reloaded.cleanup(); }
    const reset = await h.jobs.updateSettings(original.id, "owner-1", { retarget: "mario" });
    assert.equal(reset.character.fkind, 0);
  } finally { await h.cleanup(); }
});

test("unfinished fighters cannot change target", async () => {
  const original = storedJob();
  const h = await harness({ storedJobs: [original] });
  try {
    await h.jobs.init();
    await assert.rejects(h.jobs.updateSettings(original.id, "owner-1", { retarget: "mario" }), { status: 409 });
  } finally { await h.cleanup(); }
});
