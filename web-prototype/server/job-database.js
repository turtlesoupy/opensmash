import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ACTIVE_JOB_STATUSES } from "./job-protocol.js";
import { DAY_MS, assertQuota, quotaUsage } from "./job-quota.js";

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

function staleJobError(id) {
  const error = new Error(`Fighter job '${id}' changed during reconciliation.`);
  error.code = "STALE_JOB";
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
    const existing = await this.list();
    if (existing.some((candidate) => candidate.slug === job.slug)) {
      throw duplicateSlugError(job.slug);
    }
    if (quota) assertQuota(quotaUsage(existing, job.ownerId), quota);
    await this.write(job);
  }

  async save(job, { executionId = null, expectedRevision = null } = {}) {
    if (executionId || expectedRevision !== null) {
      const stored = await this.get(job.id);
      if (expectedRevision !== null && (!stored || (stored.revision || 0) !== expectedRevision)) throw staleJobError(job.id);
      if (executionId && stored?.lease?.executionId !== executionId) throw leaseLostError(job.id);
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
    });
  }

  async save(job, { executionId = null, expectedRevision = null } = {}) {
    const reference = this.collection.doc(job.id);
    if (!executionId && expectedRevision === null) {
      await reference.set(job);
      return;
    }
    await this.collection.firestore.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      const stored = document.exists ? document.data() : null;
      if (expectedRevision !== null && (!stored || (stored.revision || 0) !== expectedRevision)) throw staleJobError(job.id);
      if (executionId && stored?.lease?.executionId !== executionId) throw leaseLostError(job.id);
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

  watch(listener, { retryDelayMs = 1000, maxRetryDelayMs = 30_000 } = {}) {
    let stopped = false;
    let unsubscribe = null;
    let retryTimer = null;
    let delay = retryDelayMs;
    let generation = 0;
    const known = new Map();
    const connect = () => {
      if (stopped) return;
      const currentGeneration = ++generation;
      let firstSnapshot = true;
      unsubscribe = this.collection.onSnapshot((snapshot) => {
        if (stopped || currentGeneration !== generation) return;
        delay = retryDelayMs;
        // A new subscription does not report deletions that happened while
        // disconnected. Reconcile its full first snapshot with the old one.
        if (firstSnapshot) {
          const present = new Set(snapshot.docs.map((doc) => doc.id));
          for (const [id, job] of known) {
            if (!present.has(id)) {
              known.delete(id);
              listener(job, { removed: true });
            }
          }
          firstSnapshot = false;
        }
        for (const change of snapshot.docChanges()) {
          const job = change.doc.data();
          const removed = change.type === "removed";
          if (removed) known.delete(change.doc.id);
          else known.set(change.doc.id, job);
          listener(job, { removed });
        }
      }, (error) => {
        if (stopped || currentGeneration !== generation) return;
        // Firestore's error callback is terminal: the SDK no longer retries.
        ++generation;
        console.error("Firestore fighter job watch failed; reconnecting:", error);
        unsubscribe?.();
        unsubscribe = null;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, delay);
        retryTimer.unref?.();
        delay = Math.min(delay * 2, maxRetryDelayMs);
      });
    };
    connect();
    return () => {
      stopped = true;
      ++generation;
      clearTimeout(retryTimer);
      unsubscribe?.();
    };
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
