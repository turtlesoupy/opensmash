import { createSpecialJobs } from "./specials/jobs.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFighterJobs } from "./fighter-jobs.js";
import { createJobDatabase } from "./job-database.js";
import { createObjectStore } from "./object-store.js";
import { resolveProjectPaths } from "./project-paths.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  pipelineProjectRoot: PIPELINE_PROJECT_ROOT,
  engineRoot: ENGINE_ROOT,
  pipelineUiRoot: PIPELINE_UI_ROOT,
} = resolveProjectPaths(APP_ROOT);
const jobsRoot = path.resolve(
  process.env.FIGHTER_JOBS_ROOT || path.join(APP_ROOT, "data", "fighter-jobs"),
);

const jobId = process.env.JOB_ID;
if (!jobId) throw new Error("JOB_ID is required");

const executionId = process.env.CLOUD_RUN_EXECUTION ||
  `manual-${process.pid}-${process.env.CLOUD_RUN_TASK_ATTEMPT || "0"}`;
const objectStore = createObjectStore({ appRoot: APP_ROOT });
const isSpecial=process.env.JOB_KIND==="specials";
const specialRoot=path.join(APP_ROOT,"data","special-jobs");
const jobDatabase = createJobDatabase({ jobsRoot:isSpecial?specialRoot:jobsRoot, ...(isSpecial?{collectionName:process.env.FIRESTORE_SPECIALS_COLLECTION||"specialJobs"}:{}) });
const fighterJobs = isSpecial ? createSpecialJobs({repoRoot:PIPELINE_PROJECT_ROOT,jobsRoot:specialRoot,jobDatabase,objectStore,dispatcher:{driver:"external"}}) : createFighterJobs({
  appRoot: APP_ROOT,
  repoRoot: PIPELINE_PROJECT_ROOT,
  engineRoot: ENGINE_ROOT,
  pipelineUiRoot: PIPELINE_UI_ROOT,
  objectStore,
  jobDatabase,
  dispatcher: { driver: "external" },
});

await objectStore.init();
await jobDatabase.init();
await fighterJobs.init({ loadAll: false,dispatchPending:false });

const result = await fighterJobs.runSingle(jobId, executionId);
if (!result) throw new Error(`Fighter job '${jobId}' does not exist`);
console.log(JSON.stringify({
  jobId,
  executionId,
  status: result.status,
  revision: result.revision,
}));
