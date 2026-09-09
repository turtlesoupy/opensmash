import { createSpecialJobs } from "./specials/jobs.js";
// Long-lived fighter worker: a Cloud Run *service* (min-instances keep it
// warm) instead of a Cloud Run Job execution per fighter, which spent one to
// four minutes provisioning a task before the pipeline could start.
//
// Contract with the API's CloudRunServiceDispatcher (job-dispatcher.js):
//   POST /run {jobId}  -> 409 when this instance is busy or the job is not
//                         claimable; otherwise 200 and an ndjson stream whose
//                         first line is {"accepted":true,"executionId"} and
//                         whose last line is {"done":true,"status"}.
// The response stays open for the whole run so Cloud Run sees an in-flight
// request: the instance is neither scaled away nor CPU-throttled mid-job, and
// concurrency=1 makes the autoscaler add instances per concurrent fighter.
// A client that disconnects does not stop the run; the job's lease and the
// API's reconciliation remain the source of truth, as with Job executions.
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFighterJobs } from "./fighter-jobs.js";
import { createJobDatabase } from "./job-database.js";
import { createObjectStore } from "./object-store.js";
import { resolveProjectPaths } from "./project-paths.js";

const JOB_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const HEARTBEAT_MS = 30_000;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

// `claim(jobId, executionId)` resolves {claimed, job}; `run(jobId, executionId)`
// runs the claimed job to completion and resolves its public snapshot.
export function createWorkerServiceHandler({ claim, run, instanceId, heartbeatMs = HEARTBEAT_MS }) {
  let current = null;
  let runs = 0;

  async function handleRun(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!JOB_ID_PATTERN.test(jobId)) return json(res, 400, { error: "jobId is required" });
    const jobKind=body.jobKind||"fighter";
    if(!["fighter","specials"].includes(jobKind))return json(res,400,{error:"Unknown job kind"});
    if (current) return json(res, 409, { error: "busy", jobId: current.jobId });

    runs += 1;
    const executionId = `${instanceId}-${runs}`;
    current = { jobId, executionId, startedAt: new Date().toISOString() };
    try {
      let claim_;
      try {
        claim_ = await claim(jobId, executionId,jobKind);
      } catch (error) {
        console.error(`Could not claim fighter job '${jobId}':`, error);
        return json(res, 503, { error: `claim failed: ${error.message}` });
      }
      if (!claim_.claimed) {
        return json(res, 409, {
          error: claim_.job ? "not claimable" : "unknown job",
          status: claim_.job?.status || null,
        });
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      });
      res.write(`${JSON.stringify({ accepted: true, executionId, jobId })}\n`);
      const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(`${JSON.stringify({ heartbeat: new Date().toISOString() })}\n`);
      }, heartbeatMs);
      heartbeat.unref();
      let result = null;
      try {
        result = await run(jobId, executionId,jobKind);
      } catch (error) {
        console.error(`Fighter job '${jobId}' crashed in the worker:`, error);
        result = { status: "failed", error: error.message };
      } finally {
        clearInterval(heartbeat);
      }
      if (!res.destroyed) {
        res.end(`${JSON.stringify({ done: true, status: result?.status || null, revision: result?.revision })}\n`);
      }
    } finally {
      current = null;
    }
  }

  return {
    handler(req, res) {
      const { pathname } = new URL(req.url, "http://worker");
      // Not /healthz: Cloud Run's frontend answers that path itself with a 404
      // before the container sees it (verified 2026-09-04, hello image too).
      if (req.method === "GET" && ["/livez", "/readyz"].includes(pathname)) {
        return json(res, 200, { ok: true, instance: instanceId, busy: current });
      }
      if (req.method === "POST" && pathname === "/run") {
        return handleRun(req, res).catch((error) => {
          console.error("Worker /run failed:", error);
          if (!res.headersSent) json(res, 500, { error: error.message });
          else if (!res.destroyed) res.end();
        });
      }
      return json(res, 404, { error: "Not found" });
    },
    isBusy: () => current !== null,
    current: () => current,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const {
    pipelineProjectRoot: PIPELINE_PROJECT_ROOT,
    engineRoot: ENGINE_ROOT,
    pipelineUiRoot: PIPELINE_UI_ROOT,
  } = resolveProjectPaths(APP_ROOT);
  const jobsRoot = path.resolve(
    process.env.FIGHTER_JOBS_ROOT || path.join(APP_ROOT, "data", "fighter-jobs"),
  );
  const PORT = Number(process.env.PORT || 8080);
  const leaseSeconds = Number(process.env.FIGHTER_LEASE_SECONDS || 15 * 60);
  const instanceId = `${process.env.K_REVISION || "worker"}-${randomUUID().slice(0, 8)}`;

  const objectStore = createObjectStore({ appRoot: APP_ROOT });
  const jobDatabase = createJobDatabase({ jobsRoot });
  await objectStore.init();
  await jobDatabase.init();

  // fighter-jobs keeps per-run worker state (lease owner, lease-lost flag,
  // current child), so every run gets a fresh instance over the shared
  // database and object store.
  const specialsRoot=path.join(APP_ROOT,"data","special-jobs");
  const specialsDatabase=createJobDatabase({jobsRoot:specialsRoot,collectionName:process.env.FIRESTORE_SPECIALS_COLLECTION||"specialJobs"});
  await specialsDatabase.init();
  async function run(jobId, executionId,jobKind) {
    if(jobKind==="specials") {
      const specials=createSpecialJobs({repoRoot:PIPELINE_PROJECT_ROOT,jobsRoot:specialsRoot,jobDatabase:specialsDatabase,objectStore,dispatcher:{driver:"external"}});
      await specials.init({dispatchPending:false});
      return specials.runSingle(jobId,executionId);
    }
    const fighterJobs = createFighterJobs({
      appRoot: APP_ROOT,
      repoRoot: PIPELINE_PROJECT_ROOT,
      engineRoot: ENGINE_ROOT,
      pipelineUiRoot: PIPELINE_UI_ROOT,
      objectStore,
      jobDatabase,
      dispatcher: { driver: "external" },
    });
    await fighterJobs.init({ loadAll: false });
    return fighterJobs.runSingle(jobId, executionId);
  }

  const service = createWorkerServiceHandler({
    claim: (jobId, executionId,jobKind) => (jobKind==="specials" ? specialsDatabase : jobDatabase).claim(jobId, executionId, jobKind==="specials" ? 2400 : leaseSeconds),
    run,
    instanceId,
  });
  const server = http.createServer(service.handler);
  // A fighter run holds one request open for up to an hour.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Fighter worker ${instanceId} listening on ${PORT}`);
  });

  // Cloud Run sends SIGTERM before stopping an instance. runSingle checkpoints
  // and interrupts the running job on the same signal; stop accepting new
  // work, wait for that run to unwind, then exit.
  process.on("SIGTERM", () => {
    server.close();
    const wait = () => {
      if (!service.isBusy()) process.exit(0);
      setTimeout(wait, 500).unref();
    };
    setTimeout(wait, 1_000).unref();
  });
}
