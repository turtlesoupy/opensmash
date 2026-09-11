import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FirestoreJobDatabase, createJobDatabase } from "./job-database.js";

async function withDatabase(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opensmash-jobdb-test-"));
  const database = createJobDatabase({ jobsRoot: root });
  await database.init();
  try {
    await run(database);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 60_000).toISOString();

test("claim refuses running and retrying jobs even when their lease looks expired", async () => {
  await withDatabase(async (database) => {
    await database.insert({ id: "j1", slug: "one", ownerId: "a", status: "running", createdAt: past,
      lease: { executionId: "exec-a", expiresAt: past } });
    assert.equal((await database.claim("j1", "exec-b", 60)).claimed, false);
    // The same execution may re-claim idempotently.
    assert.equal((await database.claim("j1", "exec-a", 60)).claimed, true);

    await database.insert({ id: "j2", slug: "two", ownerId: "a", status: "retrying", createdAt: past, lease: null });
    assert.equal((await database.claim("j2", "exec-b", 60)).claimed, false);
  });
});

test("claim accepts queued jobs and jobs whose reconciled lease was cleared", async () => {
  await withDatabase(async (database) => {
    await database.insert({ id: "j1", slug: "one", ownerId: "a", status: "queued", createdAt: past,
      lease: { executionId: "exec-old", expiresAt: past } });
    const claim = await database.claim("j1", "exec-new", 60);
    assert.equal(claim.claimed, true);
    assert.equal(claim.job.lease.executionId, "exec-new");
    assert.ok(Date.parse(claim.job.lease.expiresAt) > Date.now());

    await database.insert({ id: "j2", slug: "two", ownerId: "a", status: "queued", createdAt: past,
      lease: { executionId: "exec-live", expiresAt: future } });
    assert.equal((await database.claim("j2", "exec-new", 60)).claimed, false);
  });
});

test("saves conditional on the lease fail once another owner holds the job", async () => {
  await withDatabase(async (database) => {
    await database.insert({ id: "j1", slug: "one", ownerId: "a", status: "queued", createdAt: past });
    const { job } = await database.claim("j1", "exec-a", 60);
    await database.save({ ...job, progress: 10 }, { executionId: "exec-a" });

    // The API reconciles the job: lease cleared, status failed.
    await database.save({ ...job, status: "failed", lease: null });
    await assert.rejects(
      database.save({ ...job, progress: 20 }, { executionId: "exec-a" }),
      (error) => error.code === "LEASE_LOST",
    );
    const stored = await database.get("j1");
    assert.equal(stored.status, "failed");
    assert.equal(stored.lease, null);
    assert.equal(stored.progress, undefined);
  });
});

test("insert enforces the quota against stored jobs", async () => {
  await withDatabase(async (database) => {
    const quota = { maxActivePerOwner: 1, maxDailyPerOwner: 3, maxGlobalActive: 20 };
    const now = new Date().toISOString();
    await database.insert({ id: "j1", slug: "one", ownerId: "a", status: "running", createdAt: now }, { quota });
    await assert.rejects(
      database.insert({ id: "j2", slug: "two", ownerId: "a", status: "queued", createdAt: now }, { quota }),
      (error) => error.code === "QUOTA_EXCEEDED" && error.reason === "active",
    );
    await database.insert({ id: "j3", slug: "three", ownerId: "b", status: "queued", createdAt: now }, { quota });
    await assert.rejects(
      database.insert({ id: "j4", slug: "one", ownerId: "c", status: "queued", createdAt: now }, { quota }),
      (error) => error.code === "DUPLICATE_SLUG",
    );
  });
});

// Minimal Firestore stand-in: enough of collection/query/count/transaction to
// prove the insert path counts site-wide usage server-side instead of reading
// every matching document.
function fakeFirestore(seed) {
  const docs = new Map(seed.map((job) => [job.id, job]));
  const slugs = new Set(seed.map((job) => job.slug));
  const reads = { documents: 0, aggregations: 0 };
  const matches = (job, filters) => filters.every(([field, op, value]) => {
    if (op === "==") return job[field] === value;
    if (op === "in") return value.includes(job[field]);
    if (op === ">=") return job[field] >= value;
    throw new Error(`unsupported op ${op}`);
  });
  const query = (filters) => ({
    where: (field, op, value) => query([...filters, [field, op, value]]),
    limit: () => query(filters),
    count: () => ({ kind: "aggregate", filters }),
    kind: "query",
    filters,
  });
  const collection = {
    ...query([]),
    doc: (id) => ({ kind: "doc", id }),
    firestore: {
      collection: () => ({ doc: (slug) => ({ kind: "slug", id: slug }) }),
      runTransaction: async (run) => run({
        get: async (target) => {
          if (target.kind === "slug") return { exists: slugs.has(target.id) };
          const rows = [...docs.values()].filter((job) => matches(job, target.filters));
          if (target.kind === "aggregate") {
            reads.aggregations += 1;
            return { data: () => ({ count: rows.length }) };
          }
          reads.documents += rows.length;
          return { docs: rows.map((job) => ({ id: job.id, data: () => job })) };
        },
        create: (target, value) => {
          if (target.kind === "slug") slugs.add(target.id);
          else docs.set(target.id, value);
        },
      }),
    },
  };
  return { collection, reads, docs };
}

test("firestore insert counts site-wide usage with aggregations, not document reads", async () => {
  const now = Date.now();
  const iso = (offsetMs) => new Date(now - offsetMs).toISOString();
  const seed = [];
  for (let index = 0; index < 40; index += 1) {
    seed.push({ id: `other-${index}`, slug: `other-${index}`, ownerId: `owner-${index}`, status: "queued", createdAt: iso(1000) });
  }
  const database = new FirestoreJobDatabase({ collectionName: "jobs" });
  const fake = fakeFirestore(seed);
  database.collection = fake.collection;

  const quota = { maxActivePerOwner: 1, maxDailyPerOwner: 10, maxGlobalActive: 200, maxGlobalDaily: 5000 };
  await database.insert({ id: "mine", slug: "mine", ownerId: "me", status: "queued", createdAt: iso(0) }, { quota });
  assert.equal(fake.reads.aggregations, 2);
  assert.equal(fake.reads.documents, 0, "only the owner's own (empty) jobs are read as documents");
  assert.ok(fake.docs.has("mine"));

  await assert.rejects(
    database.insert({ id: "next", slug: "next", ownerId: "someone", status: "queued", createdAt: iso(0) }, { quota: { ...quota, maxGlobalActive: 41 } }),
    (error) => error.code === "QUOTA_EXCEEDED" && error.reason === "global",
  );
  await assert.rejects(
    database.insert({ id: "next", slug: "next", ownerId: "someone", status: "queued", createdAt: iso(0) }, { quota: { ...quota, maxGlobalDaily: 41 } }),
    (error) => error.code === "QUOTA_EXCEEDED" && error.reason === "globalDaily",
  );
  // Jobs older than a day do not count toward the daily budget.
  fake.docs.set("old", { id: "old", slug: "old", ownerId: "x", status: "complete", createdAt: iso(2 * 24 * 60 * 60 * 1000) });
  await database.insert({ id: "next", slug: "next", ownerId: "someone", status: "queued", createdAt: iso(0) }, { quota: { ...quota, maxGlobalDaily: 42 } });
});

test("Firestore watch reconnects after terminal errors and reconciles missed updates and deletions", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const database = new FirestoreJobDatabase({ collectionName: "jobs" });
  const subscriptions = [];
  database.collection = { onSnapshot(next, error) {
    const subscription = { next, error, stopped: false };
    subscriptions.push(subscription);
    return () => { subscription.stopped = true; };
  } };
  const events = [];
  const stop = database.watch((job, options) => events.push([job.id, job.revision, options.removed]));
  const snapshot = (jobs) => {
    const docs = jobs.map(job => ({ id: job.id, data: () => job }));
    return { docs, docChanges: () => docs.map(doc => ({ type: "added", doc })) };
  };
  subscriptions[0].next(snapshot([{ id: "a", revision: 1 }, { id: "b", revision: 1 }]));
  subscriptions[0].error(new Error("timeout"));
  assert.equal(subscriptions[0].stopped, true);
  t.mock.timers.tick(1000);
  assert.equal(subscriptions.length, 2);
  subscriptions[1].next(snapshot([{ id: "a", revision: 2 }, { id: "c", revision: 1 }]));
  assert.deepEqual(events.slice(2), [["b", 1, true], ["a", 2, false], ["c", 1, false]]);
  subscriptions[0].next(snapshot([{ id: "old", revision: 1 }]));
  assert.equal(events.length, 5);
  subscriptions[1].error(new Error("timeout"));
  t.mock.timers.tick(1000);
  assert.equal(subscriptions.length, 3);
  subscriptions[2].error(new Error("timeout again"));
  t.mock.timers.tick(1000);
  assert.equal(subscriptions.length, 3);
  t.mock.timers.tick(1000);
  assert.equal(subscriptions.length, 4);
  subscriptions[3].error(new Error("timeout"));
  stop();
  t.mock.timers.tick(30_000);
  assert.equal(subscriptions.length, 4);
});
