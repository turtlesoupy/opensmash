import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ACTIVE_JOB_STATUSES } from "./job-protocol.js";
import { DAY_MS, assertQuota, quotaUsage } from "./job-quota.js";

export function prepareRetry(job, ownerId, jobs, { quota, maxManualRetries }) {
  const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };
  if (!job || job.ownerId !== ownerId) reject(404, "Fighter job not found.");
  if (ACTIVE_JOB_STATUSES.has(job.status)) reject(409, "That fighter is already being generated.");
  if (job.status === "complete") reject(409, "That fighter is already complete.");
  const retries = job.retry?.manualRetriesAt || [];
  if (retries.length >= maxManualRetries) reject(429, "This fighter has used all of its retries. Create a new fighter instead.");
  assertQuota(quotaUsage(jobs, ownerId), quota);
  const now = new Date().toISOString();
  return {
    ...job, status: "queued", stage: "queued", stageLabel: "Queued to resume",
    progress: 0, error: null, completedAt: null, dispatch: null, lease: null,
    revision: (job.revision || 0) + 1, updatedAt: now,
    retry: { automaticCounts: job.retry?.automaticCounts || { moderation: 0, transient: 0 },
      nextAttemptAt: null, label: null, manualRetriesAt: [...retries, now] },
  };
}

// Local mode runs in one process, but separate adapters can share a root.
const localQuotaLocks = new Map();
async function withLocalQuotaLock(root, run) {
  const key = path.resolve(root);
  const previous = localQuotaLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(run);
  localQuotaLocks.set(key, current);
  try { return await current; }
  finally { if (localQuotaLocks.get(key) === current) localQuotaLocks.delete(key); }
}

function duplicateSlugError(slug) {
  const error = new Error(`A fighter with slug '${slug}' already exists.`);
  error.code = "DUPLICATE_SLUG";
  return error;
}

function leaseLostError(id) {
  const error = new Error(`Fighter job '${id}' is no longer leased by this worker.`);
  error.code = "LEASE_LOST";
  return error;
}

// A job may be claimed when nobody is working on it. "running" and
// "retrying" are refused outright even if the lease looks expired: the API's
// reconciliation is the only path that turns a silent worker into a
// resumable job, so two containers can never publish the same attempt.
function claimDecision(job, executionId) {
  if (!job) return { claimed: false, job: null };
  if (job.status === "complete" || job.status === "cancelled") {
    return { claimed: false, job };
  }
  if (job.lease?.executionId === executionId) return { claimed: true, job };
  if (job.status === "running" || job.status === "retrying") {
    return { claimed: false, job };
  }
  const leaseExpires = Date.parse(job.lease?.expiresAt || "");
  if (job.lease?.executionId && leaseExpires > Date.now()) {
    return { claimed: false, job };
  }
  return { claimed: true, job };
}

function leaseFor(executionId, leaseSeconds) {
  return {
    executionId,
    expiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
  };
}

class LocalJobDatabase {
  constructor(root) {
    this.driver = "local";
    this.root = root;
  }

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  async list() {
    const entries = await readdir(this.root, { withFileTypes: true });
    const jobs = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        const job = JSON.parse(await readFile(path.join(this.root, entry.name, "job.json"), "utf8"));
        if (job.id === entry.name) jobs.push(job);
      } catch (error) {
        console.warn(`Skipping fighter job '${entry.name}': ${error.message}`);
      }
    }
    return jobs;
  }

  async get(id) {
    try {
      return JSON.parse(await readFile(path.join(this.root, id, "job.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async insert(job, { quota = null } = {}) {
    return withLocalQuotaLock(this.root, async () => {
    const existing = await this.list();
    if (existing.some((candidate) => candidate.slug === job.slug)) {
      throw duplicateSlugError(job.slug);
    }
    if (quota) assertQuota(quotaUsage(existing, job.ownerId), quota);
    await this.write(job);
    });
  }

  async retry(id, ownerId, options) {
    return withLocalQuotaLock(this.root, async () => {
      const jobs = await this.list();
      const updated = prepareRetry(jobs.find((job) => job.id === id), ownerId, jobs, options);
      await this.write(updated);
      return updated;
    });
  }

  async save(job, { executionId = null } = {}) {
    if (executionId) {
      const stored = await this.get(job.id);
      if (stored?.lease?.executionId !== executionId) throw leaseLostError(job.id);
    }
    await this.write(job);
  }

  async write(job) {
    const root = path.join(this.root, job.id);
    await mkdir(root, { recursive: true });
    const finalPath = path.join(root, "job.json");
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, finalPath);
  }

  watch() {
    return null;
  }

  async delete(id) {
    await rm(path.join(this.root, id), { recursive: true, force: true });
  }

  async claim(id, executionId, leaseSeconds) {
    const decision = claimDecision(await this.get(id), executionId);
    if (!decision.claimed) return decision;
    decision.job.lease = leaseFor(executionId, leaseSeconds);
    await this.write(decision.job);
    return decision;
  }
}

export class FirestoreJobDatabase {
  constructor({ collectionName }) {
    this.driver = "firestore";
    this.collectionName = collectionName;
    this.collection = null;
  }

  async init() {
    const { Firestore } = await import("@google-cloud/firestore");
    const firestore = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    });
    this.collection = firestore.collection(this.collectionName);
  }

  async list() {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((document) => document.data());
  }

  async get(id) {
    const document = await this.collection.doc(id).get();
    return document.exists ? document.data() : null;
  }

  async insert(job, { quota = null } = {}) {
    const jobRef = this.collection.doc(job.id);
    const slugRef = this.collection.firestore.collection(`${this.collectionName}Slugs`).doc(job.slug);
    await this.collection.firestore.runTransaction(async (transaction) => {
      const guard = this.collection.firestore.collection(`${this.collectionName}Quota`).doc("admission");
      await transaction.get(guard);
      const slug = await transaction.get(slugRef);
      if (slug.exists) throw duplicateSlugError(job.slug);
      if (quota) {
        // The owner's own jobs are few, so they are read and filtered in
        // memory (and reading them inside the transaction serializes
        // concurrent inserts for the same owner). The two site-wide limits
        // use server-side count aggregations instead of fetching documents:
        // one read per 1000 index entries, no matter how busy the site is.
        // Each query needs only a single-field index; createdAt is an ISO
        // string so the range compare works lexically.
        const since = new Date(Date.now() - DAY_MS).toISOString();
        const [ownerJobs, activeCount, recentCount] = await Promise.all([
          transaction.get(this.collection.where("ownerId", "==", job.ownerId)),
          transaction.get(this.collection.where("status", "in", [...ACTIVE_JOB_STATUSES]).count()),
          quota.maxGlobalDaily > 0
            ? transaction.get(this.collection.where("createdAt", ">=", since).count())
            : null,
        ]);
        const usage = quotaUsage(ownerJobs.docs.map((document) => document.data()), job.ownerId);
        usage.globalActive = activeCount.data().count;
        // Counts creations only; manual retries of older jobs are bounded per
        // job and per account and are not worth a second aggregation here.
        usage.globalDaily = recentCount ? recentCount.data().count : 0;
        assertQuota(usage, quota);
      }
      transaction.create(slugRef, { jobId: job.id, createdAt: job.createdAt });
      transaction.create(jobRef, job);
      transaction.set(guard, { updatedAt: job.updatedAt || job.createdAt });
    });
  }

  async retry(id, ownerId, options) {
    return this.collection.firestore.runTransaction(async (transaction) => {
      // Share the admission guard with creation so retries cannot race new
      // uploads (including when an account has no active documents yet).
      const guard = this.collection.firestore.collection(`${this.collectionName}Quota`).doc("admission");
      await transaction.get(guard);
      // Retries must count retries of older jobs too, not only recent creations.
      const snapshot = await transaction.get(this.collection);
      const jobs = snapshot.docs.map((document) => document.data());
      const updated = prepareRetry(jobs.find((job) => job.id === id), ownerId, jobs, options);
      transaction.set(this.collection.doc(id), updated);
      transaction.set(guard, { updatedAt: updated.updatedAt });
      return updated;
    });
  }

  async save(job, { executionId = null } = {}) {
    const reference = this.collection.doc(job.id);
    if (!executionId) {
      await reference.set(job);
      return;
    }
    await this.collection.firestore.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      const stored = document.exists ? document.data() : null;
      if (stored?.lease?.executionId !== executionId) throw leaseLostError(job.id);
      transaction.set(reference, job);
    });
  }

  async delete(id) {
    const job = await this.get(id);
    const batch = this.collection.firestore.batch();
    batch.delete(this.collection.doc(id));
    if (job?.slug) {
      batch.delete(this.collection.firestore.collection(`${this.collectionName}Slugs`).doc(job.slug));
    }
    await batch.commit();
  }

  watch(listener) {
    return this.collection.onSnapshot((snapshot) => {
      for (const change of snapshot.docChanges()) {
        listener(change.doc.data(), { removed: change.type === "removed" });
      }
    }, (error) => console.error("Firestore fighter job watch failed:", error));
  }

  async claim(id, executionId, leaseSeconds) {
    const reference = this.collection.doc(id);
    return this.collection.firestore.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      const decision = claimDecision(document.exists ? document.data() : null, executionId);
      if (!decision.claimed) return decision;
      decision.job.lease = leaseFor(executionId, leaseSeconds);
      transaction.set(reference, decision.job);
      return decision;
    });
  }
}

export function createJobDatabase({ jobsRoot }) {
  if ((process.env.JOB_DATABASE || "local") === "firestore") {
    return new FirestoreJobDatabase({
      collectionName: process.env.FIRESTORE_JOBS_COLLECTION || "fighterJobs",
    });
  }
  return new LocalJobDatabase(jobsRoot);
}
