import { prepareSourceExport, sourceManifest, SOURCE_FILES } from "./source-export.js";
import { availableFighterTargets } from "../shared/fighter-targets.js";
import Busboy from "busboy";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { ACTIVE_JOB_STATUSES, capabilityFor, jobSnapshot, publicJob } from "./job-protocol.js";
import { QuotaError, assertQuota, quotaLimits, quotaUsage } from "./job-quota.js";
import { TURNSTILE_FIELD } from "./turnstile.js";
import { readOsb6Targets } from "./roster.js";
import { moderateFighterSubmission } from "./submission-moderation.js";

const execFileAsync = promisify(execFile);
const CAPABILITY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const SLUG_SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_SUFFIX_LENGTH = 6;

function randomCapability(length = 16, alphabet = CAPABILITY_ALPHABET) {
  // Rejection sampling avoids modulo bias across the alphabet.
  const limit = 256 - (256 % alphabet.length);
  let value = "";
  while (value.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      value += alphabet[byte % alphabet.length];
      if (value.length === length) break;
    }
  }
  return value;
}

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const PHOTO_TYPES = new Map([
  ["image/jpeg", { extension: ".jpg", magic: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 }],
  ["image/png", { extension: ".png", magic: (bytes) => bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) }],
  ["image/webp", { extension: ".webp", magic: (bytes) => bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" }],
]);

const STAGES = [
  { match: "expand:", key: "expand", label: "Describing the fighter", progress: 6 },
  { match: "character:", key: "character", label: "Fighter concept ready", progress: 12 },
  { match: "tpose:", key: "tpose", label: "Generating the model sheet", progress: 18 },
  { match: "mesh: uploading", key: "mesh-upload", label: "Starting the 3D model", progress: 27 },
  { match: "mesh: img3d", key: "mesh-build", label: "Building the 3D model", progress: 36 },
  { match: "mesh: rig task", key: "mesh-rig", label: "Rigging the fighter", progress: 45 },
  { match: "mesh:", key: "mesh", label: "3D model ready", progress: 50 },
  { match: "convert:", key: "convert", label: "Converting for the game", progress: 56 },
  { match: "variants:", key: "variants", label: "Building moveset variants", progress: 66 },
  { match: "portrait:", key: "portrait", label: "Painting character-select art", progress: 75 },
  { match: "stock:", key: "stock", label: "Drawing the stock icon", progress: 81 },
  { match: "emblem:", key: "emblem", label: "Designing the emblem", progress: 86 },
  { match: "ui:", key: "ui", label: "Packing game UI", progress: 91 },
  { match: "voice:", key: "voice", label: "Recording the announcer", progress: 95 },
  { match: "staged into", key: "publish", label: "Publishing the fighter", progress: 98 },
  { match: "done:", key: "complete", label: "Fighter ready", progress: 100 },
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Reaching one of these stages proves an expensive earlier output (Tripo task
// ids, the paid rigged mesh, generated art) is on disk, so it is checkpointed
// immediately instead of only when the attempt fails.
const CHECKPOINT_STAGES = new Set([
  "mesh-build", "mesh-rig", "mesh", "convert", "variants",
  "portrait", "stock", "emblem", "ui", "voice", "publish",
]);

export function slugFor(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
}

// Generated fighters get a random suffix so two players can both make
// "Steve Jobs" and neither collides with the baked roster's stevejobs, whose
// bundle would otherwise shadow theirs everywhere the slug is the key.
export function uniqueSlugFor(name) {
  const base = slugFor(name);
  return base ? `${base}${randomCapability(SLUG_SUFFIX_LENGTH, SLUG_SUFFIX_ALPHABET)}` : "";
}

// Public manifests carry an opaque per-account id rather than the account's
// display name, so fighters by the same uploader can still be grouped.
export function uploaderToken(uid, salt = process.env.UPLOADER_TOKEN_SALT || "opensmash-uploader") {
  if (!uid) return null;
  return createHash("sha256").update(`${salt}:${uid}`).digest("hex").slice(0, 16);
}

// The pipeline's character.json includes the model's free-text description of
// the person in the photo. Only the fields the game needs are published.
export function publicCharacterMetadata(metadata) {
  const result = { display: metadata.display, short: metadata.short };
  if (typeof metadata.emblem === "string") result.emblem = metadata.emblem;
  return result;
}

export function submissionSettings(fields = {}) {
  const visibility = fields.visibility || "private";
  if (visibility !== "public" && visibility !== "private") {
    throw new HttpError(400, "Choose public or private visibility.");
  }
  if (fields.rightsAttested !== "true") {
    throw new HttpError(400, "Confirm that you have the rights or permission to upload this character and photo.");
  }
  return { visibility };
}

export function isJobAccessible(job, ownerId = null) {
  return Boolean(job && (job.visibility !== "private" || job.ownerId === ownerId));
}

export function automaticRetryPlan(log, stage, retryCounts = {}) {
  const moderationRetries = retryCounts.moderation || 0;
  const isOutputModeration =
    log.includes("moderation_blocked") &&
    /["']moderation_stage["']\s*:\s*["']output["']/i.test(log);
  if (isOutputModeration && moderationRetries < 2) {
    const subject =
      stage === "portrait" ? "Portrait" :
        stage === "stock" ? "Stock icon" :
          stage === "emblem" ? "Emblem" : "Generated art";
    return {
      kind: "moderation",
      delayMs: 1_500,
      label: `${subject} was blocked; rerolling automatically (${moderationRetries + 1}/2)`,
    };
  }

  const transientRetries = retryCounts.transient || 0;
  const expensiveMeshStage = new Set(["mesh-upload", "mesh-build", "mesh-rig", "mesh"]).has(stage);
  const isTransient = /HTTP (?:429|5\d\d)\b|rate[_ -]?limit|server_error|ETIMEDOUT|ECONNRESET|TimeoutError|timed out/i.test(log);
  if (isTransient && !expensiveMeshStage && transientRetries < 3) {
    return {
      kind: "transient",
      delayMs: 2_000 * (2 ** transientRetries),
      label: `Provider temporarily unavailable; retrying automatically (${transientRetries + 1}/3)`,
    };
  }
  return null;
}

export function parseProgressEvent(line) {
  if (!line.startsWith("@@opensmash ")) return null;
  try {
    const event = JSON.parse(line.slice("@@opensmash ".length));
    if (
      event.protocolVersion !== 1 ||
      event.type !== "job.progress" ||
      typeof event.stage !== "string" ||
      typeof event.label !== "string" ||
      !Number.isInteger(event.progress) ||
      event.progress < 0 ||
      event.progress > 100
    ) return null;
    return { key: event.stage, label: event.label, progress: event.progress };
  } catch {
    return null;
  }
}

async function readMagic(filePath) {
  const handle = await open(filePath, "r");
  try {
    const bytes = Buffer.alloc(16);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function receiveForm(req, jobRoot) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "Use a multipart form with a photo.");
  }

  await mkdir(jobRoot, { recursive: false });
  const fields = {};
  let photo = null;
  let uploadError = null;
  const writes = [];

  let parseError = null;
  try {
    await new Promise((resolve, reject) => {
      let parser;
      try {
        parser = Busboy({
          headers: req.headers,
          // One extra field and a larger fieldSize for the Turnstile token
          // (Cloudflare documents up to 2048 characters).
          limits: { files: 1, fileSize: MAX_PHOTO_BYTES, fields: 6, fieldSize: 2048, parts: 7 },
        });
      } catch (error) {
        reject(new HttpError(400, error.message || "Could not read that form."));
        return;
      }

      parser.on("field", (name, value) => {
        if (["name", "emblem", "visibility", "rightsAttested", TURNSTILE_FIELD].includes(name)) fields[name] = value;
      });
      parser.on("file", (fieldName, stream, info) => {
        if (fieldName !== "photo" || photo) {
          uploadError ||= new HttpError(400, "Upload exactly one fighter photo.");
          stream.resume();
          return;
        }
        const type = PHOTO_TYPES.get(info.mimeType);
        if (!type) {
          uploadError ||= new HttpError(415, "Use a JPEG, PNG, or WebP photo.");
          stream.resume();
          return;
        }

        const filePath = path.join(jobRoot, `photo${type.extension}`);
        photo = { path: filePath, type, mimeType: info.mimeType, originalName: info.filename || "photo" };
        const destination = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
        stream.on("limit", () => {
          uploadError ||= new HttpError(413, "The photo must be 12 MB or smaller.");
        });
        // Observe every write immediately. If parsing fails, Busboy destroys the
        // active file stream before receiveForm can reach the aggregate await.
        const finished = pipeline(stream, destination).then(
          () => null,
          (error) => error,
        );
        writes.push(finished);
      });
      parser.on("filesLimit", () => {
        uploadError ||= new HttpError(400, "Upload exactly one fighter photo.");
      });
      parser.on("partsLimit", () => {
        uploadError ||= new HttpError(400, "That form has too many fields.");
      });
      parser.on("error", reject);
      parser.on("finish", resolve);
      req.on("aborted", () => {
        const error = new HttpError(400, "Upload interrupted.");
        reject(error);
        parser.destroy(error);
      });
      req.pipe(parser);
    });
  } catch (error) {
    parseError = error;
  }

  const writeError = (await Promise.all(writes)).find(Boolean);
  if (parseError) throw parseError;
  if (writeError) throw writeError;
  if (uploadError) throw uploadError;
  if (!photo) throw new HttpError(400, "Choose a fighter photo.");

  const info = await stat(photo.path);
  if (!info.size) throw new HttpError(400, "The uploaded photo is empty.");
  const bytes = await readMagic(photo.path);
  if (!photo.type.magic(bytes)) throw new HttpError(415, "The uploaded file is not a valid photo.");

  return { fields, photo };
}

export function createFighterJobs({
  appRoot,
  repoRoot,
  engineRoot,
  pipelineUiRoot,
  objectStore,
  jobDatabase,
  dispatcher,
  submissionModerator = moderateFighterSubmission,
  turnstile = null,
  // Slugs that can never be issued to a generated fighter (the baked roster).
  reservedSlugs = async () => new Set(),
}) {
  const jobsRoot = path.resolve(process.env.FIGHTER_JOBS_ROOT || path.join(appRoot, "data", "fighter-jobs"));
  const pipelineRoot = path.join(repoRoot, "pipeline");
  const playRoot = path.join(repoRoot, "play");
  const pipelineScript = path.join(pipelineRoot, "run_character.py");
  const normalizeImageScript = path.join(appRoot, "server", "normalize-image.py");
  const jobs = new Map();
  const queue = [];
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const localExecution = dispatcher.driver === "local";
  const leaseSeconds = Number(process.env.FIGHTER_LEASE_SECONDS || 15 * 60);
  const limits = quotaLimits();
  const maxManualRetries = Number(process.env.MAX_MANUAL_RETRIES_PER_JOB || 3);
  // Creations that passed the quota check but are not yet in `jobs`. Counted
  // synchronously so parallel uploads from one account cannot all see zero.
  const pending = { owners: new Map(), global: 0 };
  let stopDatabaseWatch = null;
  let workerBusy = false;
  // Set when this process is a worker holding a lease; every save is then
  // conditional on the stored lease still naming this execution.
  let workerExecutionId = null;
  let leaseLost = false;
  let currentRun = null;
  let checkpointChain = Promise.resolve();
  let checkpointQueued = false;

  function jobRoot(id) {
    return path.join(jobsRoot, id);
  }

  async function saveJob(job, { bumpRevision = true } = {}) {
    if (bumpRevision) {
      job.revision = (job.revision || 0) + 1;
      job.updatedAt = new Date().toISOString();
    }
    if (job.lease?.executionId) {
      job.lease.expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    }
    if (leaseLost) {
      const error = new Error(`Fighter job '${job.id}' is no longer leased by this worker.`);
      error.code = "LEASE_LOST";
      throw error;
    }
    try {
      await jobDatabase.save(job, workerExecutionId ? { executionId: workerExecutionId } : {});
    } catch (error) {
      if (error.code === "LEASE_LOST") {
        leaseLost = true;
        console.error(`Fighter job '${job.id}' lease was taken by another owner; stopping this worker.`);
        abortCurrentRun("lease-lost");
      }
      throw error;
    }
    events.emit(job.id, jobSnapshot(job));
  }

  async function insertJob(job) {
    job.revision = (job.revision || 0) + 1;
    job.updatedAt = new Date().toISOString();
    await jobDatabase.insert(job, { quota: limits });
    events.emit(job.id, jobSnapshot(job));
  }

  function httpErrorFrom(error) {
    return error instanceof QuotaError || error?.code === "QUOTA_EXCEEDED"
      ? new HttpError(error.status || 429, error.message)
      : error;
  }

  function normalizeStoredJob(job) {
    job.revision ||= 0;
    job.protocolVersion ||= 1;
    job.updatedAt ||= job.createdAt;
    job.attempt ||= 0;
    job.retry ||= {
      automaticCounts: job.automaticRetryCounts || { moderation: 0, transient: 0 },
      nextAttemptAt: job.nextAttemptAt || null,
      label: job.retryLabel || null,
    };
    job.retry.manualRetriesAt ||= [];
    delete job.automaticRetryCounts;
    delete job.nextAttemptAt;
    delete job.retryLabel;
    return job;
  }

  async function loadJobs() {
    await mkdir(jobsRoot, { recursive: true });
    const storedJobs = await jobDatabase.list();
    for (const job of storedJobs) {
      try {
        if (!job.id) continue;
        normalizeStoredJob(job);
        if (localExecution && (job.status === "running" || job.status === "retrying")) {
          job.status = "queued";
          job.stage = "queued";
          job.stageLabel = "Recovered after server restart";
          job.progress = Math.min(job.progress || 0, 95);
          job.error = null;
          job.retry.nextAttemptAt = null;
          await saveJob(job);
        }
        if (
          job.status === "failed" &&
          (job.logTail || []).some((line) => line.includes("invalid_image_file"))
        ) {
          job.error = "The image provider rejected the reference photo. Resume to retry with a normalized copy.";
          await saveJob(job);
        }
        if (
          job.status === "failed" &&
          (job.logTail || []).some((line) => line.includes("moderation_blocked"))
        ) {
          if ((job.progress || 0) >= 75) {
            job.stageLabel = "Generated portrait was blocked";
            job.error = "The image provider blocked its generated portrait. The model and moveset variants are saved; reroll only the portrait to continue.";
            job.retry.label = "Reroll portrait";
          } else {
            job.stageLabel = "Generated art was blocked";
            job.error = "The image provider blocked generated art. Retry to reroll the missing stage.";
            job.retry.label = "Reroll art";
          }
          await saveJob(job);
        }
        jobs.set(job.id, job);
        if (localExecution && job.status === "queued") queue.push(job.id);
      } catch (error) {
        console.warn(`Skipping fighter job '${job.id || "unknown"}': ${error.message}`);
      }
    }
    queue.sort((left, right) => jobs.get(left).createdAt.localeCompare(jobs.get(right).createdAt));
  }

  async function restoreCheckpoint(job) {
    for (const file of job.checkpoint?.files || []) {
      const destination = file.scope === "play"
        ? path.join(playRoot, file.name)
        : path.join(pipelineUiRoot, job.slug, file.name);
      await objectStore.getFile(file.key, destination);
    }
  }

  // Uploads every completed stage output to the private checkpoint prefix.
  // Runs after each expensive stage, on failure, and on SIGTERM; files whose
  // size and mtime match the previous checkpoint are not re-uploaded.
  async function saveCheckpoint(job) {
    const outputRoot = path.join(pipelineUiRoot, job.slug);
    const checkpointRoot = `characters/${job.slug}/checkpoints/${job.id}`;
    const candidates = [
      "character.json", "cost.json", "tpose.png", "tripo_tasks.json", "rigged.glb",
      "bundle.json", "portrait_raw.png", "stock_raw.png", "emblem_raw.png",
      `${job.slug}.osbui`, "announcer.wav",
    ];
    const previous = new Map(
      (job.checkpoint?.files || []).map((file) => [`${file.scope}/${file.name}`, file]),
    );
    const files = [];
    async function checkpointFile(scope, name, source) {
      let info;
      try {
        info = await stat(source);
      } catch {
        return; // Missing files simply mean that stage had not completed yet.
      }
      const fingerprint = `${info.size}:${Math.floor(info.mtimeMs)}`;
      const existing = previous.get(`${scope}/${name}`);
      if (existing?.fingerprint === fingerprint) {
        files.push(existing);
        return;
      }
      const artifact = await objectStore.putFile(
        `${checkpointRoot}/${scope}/${name}`, source, { public: false },
      );
      files.push({ ...artifact, scope, name, fingerprint });
    }
    for (const name of candidates) {
      await checkpointFile("output", name, path.join(outputRoot, name));
    }
    let bundles = [];
    try {
      bundles = (await readdir(playRoot))
        .filter((name) => name === `${job.slug}.osb6` ||
          ((name === `${job.slug}.osb` || name.startsWith(`${job.slug}-`)) && name.endsWith(".osb")));
    } catch {
      // The play directory may not exist if generation failed very early.
    }
    for (const name of bundles) {
      await checkpointFile("play", name, path.join(playRoot, name));
    }
    if (files.length) {
      job.checkpoint = { savedAt: new Date().toISOString(), files };
    }
  }

  function queueCheckpoint(job) {
    if (checkpointQueued) return checkpointChain;
    checkpointQueued = true;
    checkpointChain = checkpointChain.then(async () => {
      checkpointQueued = false;
      if (leaseLost) return;
      try {
        await saveCheckpoint(job);
        await saveJob(job);
      } catch (error) {
        if (error.code !== "LEASE_LOST") console.error("Could not checkpoint fighter progress:", error);
      }
    });
    return checkpointChain;
  }

  async function finishJob(job, code, signal, attemptLog = "") {
    if (code === 0) {
      try {
        const outputRoot = path.join(pipelineUiRoot, job.slug);
        await Promise.all([
          access(path.join(outputRoot, "portrait_raw.png")),
          access(path.join(engineRoot, "bundles", `${job.slug}.osb6`)),
          access(path.join(engineRoot, "bundles", `${job.slug}.osbui`)),
          access(path.join(engineRoot, "bundles", `${job.slug}.wav`)),
        ]);
        const metadata = JSON.parse(await readFile(path.join(outputRoot, "character.json"), "utf8"));
        let cost = null;
        try {
          cost = JSON.parse(await readFile(path.join(outputRoot, "cost.json"), "utf8"));
        } catch {
          // Cost reporting is helpful but not required to play the fighter.
        }
        job.displayName = metadata.display || job.name;
        job.short = metadata.short || job.displayName;
        job.costUsd = cost?.total_usd ?? null;
        // A retry publishes different immutable bytes, so it also gets a new
        // capability URL instead of reusing a potentially cached response.
        job.assetCapability = randomCapability();
        const version = `${job.id}-${job.attempt}`;
        const versionRoot = `characters/${job.slug}/versions/${version}`;
        const isPublic = job.visibility !== "private";
        const bundleRoot = path.join(engineRoot, "bundles");
        // One OSB6 holds every built target; record which so the client can
        // offer mesh overrides without probing for files.
        const targets = (await readOsb6Targets(path.join(bundleRoot, `${job.slug}.osb6`)))
          .filter((target) => target !== "mario")
          .sort();
        job.artifacts = {
          portrait: await objectStore.putFile(
            `${versionRoot}/portrait.png`,
            path.join(outputRoot, "portrait_raw.png"),
            { contentType: "image/png", public: isPublic },
          ),
          announcer: await objectStore.putFile(
            `${versionRoot}/announcer.wav`,
            path.join(bundleRoot, `${job.slug}.wav`),
            { contentType: "audio/wav", public: isPublic },
          ),
          bundle: await objectStore.putFile(
            `${versionRoot}/injection/${job.slug}.osb6`,
            path.join(bundleRoot, `${job.slug}.osb6`),
            { contentType: "application/octet-stream", public: isPublic },
          ),
          ui: await objectStore.putFile(
            `${versionRoot}/injection/${job.slug}.osbui`,
            path.join(bundleRoot, `${job.slug}.osbui`),
            { contentType: "application/octet-stream", public: isPublic },
          ),
          character: await objectStore.putJson(
            `${versionRoot}/character.json`,
            publicCharacterMetadata(metadata),
            { public: isPublic },
          ),
          targets,
        };
        for (const [key, fileName] of [
          ["stock", "stock_raw.png"], ["emblem", "emblem_raw.png"],
          ["portraitTile", "portrait_tile.png"], ["portraitMedium", "portrait_medium.png"],
        ]) {
          try {
            await access(path.join(outputRoot, fileName));
            job.artifacts[key] = await objectStore.putFile(
              `${versionRoot}/${key}.png`,
              path.join(outputRoot, fileName),
              { contentType: "image/png", public: isPublic },
            );
          } catch {
            // Optional art is omitted from the manifest if the pipeline did not produce it.
          }
        }
        const manifest = {
          protocolVersion: 1,
          character: {
            slug: job.slug,
            name: metadata.display || job.name,
            short: metadata.short || metadata.display || job.name,
          },
          visibility: job.visibility,
          uploader: job.ownerId ? { id: uploaderToken(job.ownerId) } : null,
          version,
          generatedAt: new Date().toISOString(),
          artifacts: job.artifacts,
        };
        job.artifacts.manifest = await objectStore.putJson(
          `${versionRoot}/manifest.json`, manifest, { public: isPublic },
        );
        job.artifacts.latest = await objectStore.putJson(
          `characters/${job.slug}/latest.json`,
          {
            protocolVersion: 1,
            slug: job.slug,
            version,
            manifest: job.artifacts.manifest,
            updatedAt: new Date().toISOString(),
          },
          { public: isPublic, immutable: false },
        );
        job.status = "complete";
        job.stage = "complete";
        job.stageLabel = "Fighter ready";
        job.progress = 100;
        job.completedAt = new Date().toISOString();
        job.retry.nextAttemptAt = null;
        job.error = null;
      } catch (error) {
        job.status = "failed";
        job.stage = "failed";
        job.stageLabel = "Generation finished without playable files";
        job.error = error.message;
      }
    } else {
      const failedStage = job.stage;
      job.status = "failed";
      job.stage = "failed";
      job.stageLabel = "Generation stopped";
      const joinedLog = attemptLog || (job.logTail || []).join("\n");
      if (joinedLog.includes("invalid_image_file")) {
        job.error = "The image provider rejected the reference photo. Resume to retry with a normalized copy.";
        job.retry.label = "Resume generation";
      } else if (joinedLog.includes("moderation_blocked")) {
        if (failedStage === "portrait") {
          job.stageLabel = "Generated portrait was blocked";
          job.error = "The image provider blocked its generated portrait. The model and moveset variants are saved; reroll only the portrait to continue.";
          job.retry.label = "Reroll portrait";
        } else {
          job.stageLabel = "Generated art was blocked";
          job.error = "The image provider blocked generated art. Retry to reroll the missing stage.";
          job.retry.label = "Reroll art";
        }
      } else {
        const lastUsefulLine = [...(job.logTail || [])].reverse().find((line) => /failed|error|runtime/i.test(line));
        job.error = lastUsefulLine || `Pipeline exited ${signal ? `after ${signal}` : `with code ${code}`}.`;
        job.retry.label = "Resume generation";
      }
    }
    if (job.status === "failed") {
      try {
        await saveCheckpoint(job);
      } catch (error) {
        job.logTail = [...(job.logTail || []), `checkpoint: ${error.message}`].slice(-24);
      }
    }
    job.lease = null;
    await saveJob(job);
  }

  function stageFromLine(line) {
    const normalized = line.toLowerCase();
    return STAGES.find((stage) => normalized.includes(stage.match.toLowerCase()));
  }

  // Stops the pipeline child (if any) and records why, so the close handler
  // records an interruption instead of a failure or a new attempt. Reasons:
  // "sigterm" (Cloud Run shutdown), "lease-lost" (another owner took the job),
  // "cancelled" (owner cancelled a locally running job).
  function abortCurrentRun(reason) {
    const run = currentRun;
    if (!run || run.abortReason) return;
    run.abortReason = reason;
    const child = run.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 3_000).unref();
    }
    if (run.retryTimer) {
      clearTimeout(run.retryTimer);
      run.retryTimer = null;
      void run.proceed();
    }
  }

  async function interruptJob(job, reason) {
    await checkpointChain;
    if (reason === "lease-lost" || leaseLost) return;
    if (reason === "cancelled") {
      job.lease = null;
      await saveJob(job);
      return;
    }
    try {
      await saveCheckpoint(job);
    } catch (error) {
      job.logTail = [...(job.logTail || []), `checkpoint: ${error.message}`].slice(-24);
    }
    job.status = "failed";
    job.stage = "interrupted";
    job.stageLabel = "Generation worker was stopped";
    job.error = "The worker was stopped before it finished. Resume to continue from its last saved checkpoint.";
    job.retry.label = "Resume generation";
    job.retry.nextAttemptAt = null;
    job.lease = null;
    await saveJob(job);
  }

  function endRun() {
    currentRun = null;
    workerBusy = false;
    void runNext();
  }

  async function runJob(job, { automatic = false } = {}) {
    workerBusy = true;
    const run = { job, child: null, abortReason: null, retryTimer: null, proceed: null };
    currentRun = run;
    job.attempt = (job.attempt || 0) + 1;
    job.status = "running";
    if (!automatic) {
      job.stage = "photo";
      job.stageLabel = "Preparing the reference photo";
      job.progress = 1;
    }
    job.startedAt ||= new Date().toISOString();
    job.error = null;
    job.retry.nextAttemptAt = null;
    await saveJob(job);

    const normalizedPhoto = path.join(jobRoot(job.id), "photo-normalized.png");
    try {
      await restoreCheckpoint(job);
      const localPhoto = path.join(jobRoot(job.id), job.photoFile);
      try {
        await access(localPhoto);
      } catch (error) {
        if (error.code !== "ENOENT" || !job.input?.key) throw error;
        await objectStore.getFile(job.input.key, localPhoto);
      }
      await execFileAsync(
        process.env.PYTHON || "python3",
        [normalizeImageScript, localPhoto, normalizedPhoto],
        { cwd: appRoot, timeout: 120_000, maxBuffer: 1024 * 1024 },
      );
      job.normalizedPhotoFile = path.basename(normalizedPhoto);
      if (!automatic) {
        job.stage = "starting";
        job.stageLabel = "Starting the fighter pipeline";
        job.progress = 2;
      }
      await saveJob(job);
    } catch (error) {
      if (error.code === "LEASE_LOST" || run.abortReason) {
        await interruptJob(job, run.abortReason || "lease-lost");
        endRun();
        return publicJob(job);
      }
      job.status = "failed";
      job.stage = "failed";
      job.stageLabel = "Could not prepare the reference photo";
      job.error = "That photo could not be converted into a standard RGB image.";
      job.logTail = [...(job.logTail || []), error.message].slice(-24);
      job.lease = null;
      await saveJob(job);
      endRun();
      return publicJob(job);
    }
    if (run.abortReason) {
      await interruptJob(job, run.abortReason);
      endRun();
      return publicJob(job);
    }

    const args = [
      pipelineScript, job.name,
      "--slug", job.slug,
      "--photo", normalizedPhoto,
      "--out", path.join(pipelineUiRoot, job.slug),
    ];
    if (job.emblem) args.push("--emblem", job.emblem);
    const child = spawn(process.env.PYTHON || "python3", args, {
      cwd: pipelineRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    run.child = child;
    const logPath = path.join(jobRoot(job.id), "run.log");
    let pending = "";
    let saveTimer = null;
    const attemptLines = [];

    function scheduleSave() {
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        saveJob(job).catch((error) => {
          if (error.code !== "LEASE_LOST") console.error("Could not save fighter progress:", error);
        });
      }, 150);
    }

    function consume(text) {
      appendFile(logPath, text).catch((error) => console.error("Could not append fighter log:", error));
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        attemptLines.push(line);
        if (attemptLines.length > 200) attemptLines.shift();
        const structuredStage = parseProgressEvent(line);
        if (!structuredStage) job.logTail = [...(job.logTail || []), line].slice(-24);
        const stage = structuredStage || stageFromLine(line);
        if (stage && stage.progress >= (job.progress || 0)) {
          const entered = job.stage !== stage.key;
          job.stage = stage.key;
          job.stageLabel = stage.label;
          job.progress = stage.progress;
          if (entered && CHECKPOINT_STAGES.has(stage.key)) queueCheckpoint(job);
        }
      }
      scheduleSave();
    }

    await new Promise((resolve) => {
      let spawnError = null;
      child.stdout.on("data", (chunk) => consume(chunk.toString()));
      child.stderr.on("data", (chunk) => consume(chunk.toString()));
      child.on("error", (error) => {
        spawnError = error;
      });
      child.on("close", async (code, signal) => {
        run.child = null;
        if (saveTimer) clearTimeout(saveTimer);
        if (pending.trim()) {
          const finalLine = pending;
          pending = "";
          consume(`${finalLine}\n`);
          if (saveTimer) clearTimeout(saveTimer);
        }
        if (run.abortReason) {
          await interruptJob(job, run.abortReason);
          endRun();
          resolve();
          return;
        }
        if (spawnError) {
          job.logTail = [...(job.logTail || []), spawnError.message].slice(-24);
          job.status = "failed";
          job.stage = "failed";
          job.stageLabel = "Could not start the pipeline";
          job.error = spawnError.message;
          job.lease = null;
          await saveJob(job);
          endRun();
          resolve();
          return;
        }
        const attemptLog = attemptLines.join("\n");
        const retryPlan = code === 0
          ? null
          : automaticRetryPlan(attemptLog, job.stage, job.retry.automaticCounts);
        if (retryPlan) {
          job.retry.automaticCounts[retryPlan.kind] += 1;
          job.status = "retrying";
          job.stageLabel = retryPlan.label;
          job.retry.nextAttemptAt = new Date(Date.now() + retryPlan.delayMs).toISOString();
          job.error = null;
          job.retry.label = null;
          await saveJob(job);
          run.proceed = async () => {
            run.retryTimer = null;
            if (run.abortReason) {
              await interruptJob(job, run.abortReason);
              endRun();
              resolve();
              return;
            }
            await runJob(job, { automatic: true });
            resolve();
          };
          run.retryTimer = setTimeout(run.proceed, retryPlan.delayMs);
          return;
        }
        await checkpointChain;
        await finishJob(job, code, signal, attemptLog);
        endRun();
        resolve();
      });
    });
    return publicJob(job);
  }

  async function runNext() {
    if (!localExecution || workerBusy || process.env.FIGHTER_WORKER_DISABLED === "1") return;
    while (queue.length) {
      const id = queue.shift();
      const job = jobs.get(id);
      if (job?.status === "queued") {
        await runJob(job);
        return;
      }
    }
  }

  async function dispatch(job) {
    if (localExecution) {
      queue.push(job.id);
      void runNext();
      return;
    }
    // Record the dispatch BEFORE contacting the worker. A warm worker claims
    // the job within milliseconds of accepting it, and a save after
    // acceptance would replace the stored record (lease included) with this
    // stale copy, so the worker lost its lease and stopped (2026-09-04).
    // The worker's lease.executionId is the durable record of who ran it;
    // executionName is kept in memory only.
    job.dispatch = {
      driver: dispatcher.driver,
      executionName: null,
      dispatchedAt: new Date().toISOString(),
    };
    job.stageLabel = "Generation worker scheduled";
    await saveJob(job);
    try {
      const result = await dispatcher.dispatch(job);
      job.dispatch.executionName = result.executionName;
    } catch (error) {
      job.status = "failed";
      job.stage = "dispatch";
      job.stageLabel = "Could not schedule generation";
      job.error = error.message;
      job.retry.label = "Retry scheduling";
      await saveJob(job);
      throw new HttpError(503, "Generation could not be scheduled. Retry this job.");
    }
  }

  async function reconcileStaleJobs() {
    if (localExecution) return;
    const now = Date.now();
    const dispatchTimeout = Number(process.env.FIGHTER_DISPATCH_TIMEOUT_SECONDS || 10 * 60) * 1000;
    const queueTimeout = Number(process.env.FIGHTER_QUEUE_TIMEOUT_SECONDS || 5 * 60) * 1000;
    for (const job of jobs.values()) {
      const leaseExpiry = Date.parse(job.lease?.expiresAt || "");
      const leaseExpired =
        (job.status === "running" || job.status === "retrying") &&
        (!Number.isFinite(leaseExpiry) || leaseExpiry < now);
      // A queued job either has a dispatch record whose worker never claimed
      // it, or no record at all because the API died between insert and
      // dispatch. Both must expire or the owner's active-job slot is stuck.
      const neverClaimed =
        job.status === "queued" &&
        (job.dispatch?.dispatchedAt
          ? Date.parse(job.dispatch.dispatchedAt) + dispatchTimeout < now
          : Date.parse(job.updatedAt || job.createdAt) + queueTimeout < now);
      if (!leaseExpired && !neverClaimed) continue;
      // The watch may lag or disconnect. Never overwrite a worker's newer
      // heartbeat/completion with an expired lease from this replica's cache.
      const interrupted = structuredClone(job);
      interrupted.status = "failed";
      interrupted.stage = "interrupted";
      interrupted.stageLabel = "Generation worker was interrupted";
      interrupted.error = "The worker stopped reporting progress. Resume to continue from its last saved checkpoint.";
      interrupted.retry.label = "Resume generation";
      interrupted.lease = null;
      interrupted.revision = (job.revision || 0) + 1;
      interrupted.updatedAt = new Date().toISOString();
      try {
        await jobDatabase.save(interrupted, { expectedRevision: job.revision || 0 });
        jobs.set(job.id, interrupted);
        events.emit(job.id, jobSnapshot(interrupted));
      } catch (error) {
        if (error.code !== "STALE_JOB") throw error;
        const current = await jobDatabase.get(job.id);
        if (current) jobs.set(job.id, current);
        else jobs.delete(job.id);
      }
    }
  }

  // Synchronous: checks the quota and reserves a slot before create() yields
  // to the upload, moderation, and object-store writes. Returns the release
  // function; the reservation ends once the job is in `jobs` (or on failure).
  function reserveCreation(ownerId) {
    if (!ownerId) throw new HttpError(401, "A validated ROM session is required.");
    try {
      assertQuota(quotaUsage(jobs.values(), ownerId, { pending }), limits);
    } catch (error) {
      throw httpErrorFrom(error);
    }
    pending.owners.set(ownerId, (pending.owners.get(ownerId) || 0) + 1);
    pending.global += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (pending.owners.get(ownerId) || 1) - 1;
      if (remaining > 0) pending.owners.set(ownerId, remaining);
      else pending.owners.delete(ownerId);
      pending.global = Math.max(0, pending.global - 1);
    };
  }

  function ownedJob(id, ownerId) {
    const job = jobs.get(id);
    return job && (!ownerId || job.ownerId === ownerId) ? job : null;
  }

  // A fresh random slug that no baked fighter, known job, or on-disk output
  // already uses. The Firestore slug reservation is the cross-instance check.
  async function allocateSlug(name) {
    const reserved = await reservedSlugs();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = uniqueSlugFor(name);
      if (reserved.has(candidate)) continue;
      if ([...jobs.values()].some((job) => job.slug === candidate)) continue;
      try {
        await access(path.join(pipelineUiRoot, candidate));
        continue;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return candidate;
    }
    throw new HttpError(503, "Could not allocate a fighter id. Try again.");
  }

  async function create(req, uploader) {
    const ownerId = uploader?.uid;
    const release = reserveCreation(ownerId);
    const id = randomUUID();
    const root = jobRoot(id);
    try {
      const { fields, photo } = await receiveForm(req, root);
      // Human check runs before moderation and the object store so a bot
      // never reaches the paid steps; the quota slot is released on failure.
      if (turnstile?.enabled) {
        const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
        try {
          await turnstile.verify(fields[TURNSTILE_FIELD], forwarded || req.socket?.remoteAddress || null);
        } catch (error) {
          throw new HttpError(error.status || 403, error.message);
        }
      }
      const name = String(fields.name || "").trim().replace(/\s+/g, " ");
      const emblem = String(fields.emblem || "").trim().replace(/\s+/g, " ");
      const { visibility } = submissionSettings(fields);
      if (!name || name.length > 80) throw new HttpError(400, "Enter a fighter name up to 80 characters.");
      if (emblem.length > 200) throw new HttpError(400, "Keep the emblem description under 200 characters.");
      if (!slugFor(name)) throw new HttpError(400, "The fighter name must contain at least one A–Z letter or number.");
      const slug = await allocateSlug(name);

      let moderation;
      try {
        moderation = await submissionModerator({
          name,
          emblem,
          photoPath: photo.path,
          mimeType: photo.mimeType,
        });
      } catch (error) {
        console.warn(JSON.stringify({
          event: "fighter.submission_rejected",
          uploaderId: ownerId,
          reason: error.status === 422 ? "moderation" : "moderation_unavailable",
          categories: error.details?.categories || [],
        }));
        throw error;
      }

      const now = new Date().toISOString();
      const input = await objectStore.putFile(
        `characters/${slug}/sources/${id}/photo${photo.type.extension}`,
        photo.path,
        { contentType: photo.mimeType, public: false },
      );
      // The upload now lives in the object store. Drop the local copy: on
      // Cloud Run the filesystem is in-memory, so keeping every accepted
      // photo (up to MAX_PHOTO_BYTES each) would eat the instance's RAM
      // one submission at a time. The worker re-fetches from job.input.key
      // when the file is absent (see runJob).
      await rm(photo.path, { force: true });
      const job = {
        protocolVersion: 1,
        id,
        ownerId,
        uploader: {
          uid: ownerId,
          displayName: uploader.displayName || null,
          email: uploader.email || null,
          provider: uploader.provider || null,
        },
        name,
        slug,
        assetCapability: randomCapability(),
        emblem,
        visibility,
        rightsAttestedAt: now,
        moderation,
        photoName: path.basename(photo.originalName).slice(0, 160),
        photoFile: path.basename(photo.path),
        photoMimeType: photo.mimeType,
        status: "queued",
        stage: "queued",
        stageLabel: workerBusy ? "Waiting for the current fighter" : "Queued for generation",
        progress: 0,
        createdAt: now,
        updatedAt: now,
        revision: 0,
        attempt: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        retry: {
          automaticCounts: { moderation: 0, transient: 0 },
          nextAttemptAt: null,
          label: null,
          manualRetriesAt: [],
        },
        input,
        logTail: [],
      };
      // Once in the map the job counts as active on its own; the database
      // insert re-checks the quota transactionally for multi-instance safety.
      jobs.set(id, job);
      release();
      try {
        await insertJob(job);
      } catch (error) {
        jobs.delete(id);
        if (error.code === "DUPLICATE_SLUG") {
          throw new HttpError(503, "Could not allocate a fighter id. Try again.");
        }
        throw httpErrorFrom(error);
      }
      await dispatch(job);
      return publicJob(job);
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    } finally {
      release();
    }
  }

  // Manual retries are capped per job and count against the owner's daily
  // limit. Automatic reroll/transient budgets carry over between attempts, so
  // a job can never exceed 1 + manual + automatic worker executions.
  async function retry(id, ownerId) {
    const job = ownedJob(id, ownerId);
    if (!job) throw new HttpError(404, "Fighter job not found.");
    if (ACTIVE_JOB_STATUSES.has(job.status)) throw new HttpError(409, "That fighter is already being generated.");
    if (job.status === "complete") throw new HttpError(409, "That fighter is already complete.");
    const manualRetriesAt = job.retry?.manualRetriesAt || [];
    if (manualRetriesAt.length >= maxManualRetries) {
      throw new HttpError(429, "This fighter has used all of its retries. Create a new fighter instead.");
    }
    try {
      assertQuota(quotaUsage(jobs.values(), job.ownerId, { pending }), limits);
    } catch (error) {
      throw httpErrorFrom(error);
    }
    job.status = "queued";
    job.stage = "queued";
    job.stageLabel = workerBusy ? "Waiting for the current fighter" : "Queued to resume";
    job.progress = 0;
    job.error = null;
    job.retry = {
      automaticCounts: job.retry?.automaticCounts || { moderation: 0, transient: 0 },
      nextAttemptAt: null,
      label: null,
      manualRetriesAt: [...manualRetriesAt, new Date().toISOString()],
    };
    job.completedAt = null;
    job.dispatch = null;
    job.lease = null;
    await saveJob(job);
    await dispatch(job);
    return publicJob(job);
  }

  // Cancelling clears the lease, so a worker still running the job fails its
  // next conditional write, stops the pipeline, and writes nothing further.
  async function cancel(id, ownerId) {
    const job = ownedJob(id, ownerId);
    if (!job) throw new HttpError(404, "Fighter job not found.");
    if (job.status === "complete") throw new HttpError(409, "That fighter is already complete.");
    if (job.status === "cancelled") return publicJob(job);
    job.status = "cancelled";
    job.stage = "cancelled";
    job.stageLabel = "Cancelled";
    job.error = null;
    job.retry.nextAttemptAt = null;
    job.retry.label = "Resume generation";
    job.lease = null;
    job.completedAt = null;
    await saveJob(job);
    if (currentRun?.job.id === job.id) abortCurrentRun("cancelled");
    return publicJob(job);
  }

  // Owner-initiated delete. Generating jobs must finish or fail first (the
  // worker holds the lease); afterwards the record and its slug reservation
  // go, which also revokes the /engine/bundles/<slug> gate. Stored artifacts
  // are content-addressed and left in place.
  async function updateSettings(id, ownerId, settings) {
    const job = ownedJob(id, ownerId);
    if (!job) throw new HttpError(404, "Fighter job not found.");
    if (job.status !== "complete") throw new HttpError(409, "Wait for this fighter to finish before changing its settings.");
    if (!availableFighterTargets(job.artifacts).some(({ value }) => value === settings?.retarget)) {
      throw new HttpError(400, "Choose a target available for this fighter.");
    }
    const updated = { ...job, retarget: settings.retarget };
    await saveJob(updated);
    jobs.set(id, updated);
    return publicJob(updated);
  }

  async function remove(id, ownerId) {
    const job = ownedJob(id, ownerId);
    if (!job) throw new HttpError(404, "Fighter job not found.");
    if (ACTIVE_JOB_STATUSES.has(job.status)) {
      throw new HttpError(409, "That fighter is still being generated. Wait for it to finish or fail first.");
    }
    try {
      await jobDatabase.delete(job.id);
    } catch (error) {
      throw httpErrorFrom(error);
    }
    jobs.delete(job.id);
    events.emit(job.id, { ...jobSnapshot(job), status: "deleted" });
    return { id: job.id, slug: job.slug };
  }

  return {
    async init({ loadAll = true } = {}) {
      if (loadAll) await loadJobs();
      stopDatabaseWatch = loadAll ? jobDatabase.watch((job, { removed = false } = {}) => {
        const current = jobs.get(job.id);
        if (removed) {
          // Deleted on another instance: drop it here too, or this replica
          // keeps listing the fighter and holding its slug until restart.
          if (!current) return;
          jobs.delete(job.id);
          events.emit(job.id, { ...jobSnapshot(current), status: "deleted" });
          return;
        }
        if (!current || (job.revision || 0) > (current.revision || 0)) {
          jobs.set(job.id, job);
          events.emit(job.id, jobSnapshot(job));
        }
      }) : null;
      if (loadAll && !localExecution) {
        await reconcileStaleJobs();
        setInterval(() => {
          reconcileStaleJobs().catch((error) => console.error("Stale job reconciliation failed:", error));
        }, 60_000).unref();
      }
      void runNext();
    },
    async create(req, uploader) {
      return create(req, uploader);
    },
    list(ownerId = null) {
      return [...jobs.values()]
        .filter((job) => !ownerId || job.ownerId === ownerId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(publicJob);
    },
    listVisible(ownerId = null) {
      return [...jobs.values()]
        .filter((job) => job.visibility !== "private" || job.ownerId === ownerId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((job) => ({
          ...publicJob(job),
          // Lets the roster float the viewer's own fighters to the top
          // without exposing the owner id itself.
          mine: Boolean(ownerId && job.ownerId === ownerId),
        }));
    },
    get(id, ownerId = null) {
      const job = ownedJob(id, ownerId);
      return job ? publicJob(job) : null;
    },
    isAccessible(id, ownerId = null) {
      return isJobAccessible(jobs.get(id), ownerId);
    },
    isSlugAccessible(slug, ownerId = null) {
      const job = [...jobs.values()].find((candidate) => candidate.slug === slug);
      return !job || job.visibility !== "private" || job.ownerId === ownerId;
    },
    isSlugPublic(slug) {
      const job = [...jobs.values()].find((candidate) => candidate.slug === slug);
      return Boolean(job && job.visibility !== "private");
    },
    async exportSource(id, ownerId) {
      const job=jobs.get(id);
      const result=await prepareSourceExport(job,ownerId,objectStore);
      job.sourceExport=result;await saveJob(job);
      return {url:`/engine/character-source/${result.capability}/manifest.json`};
    },
    sourceExport(capability, name) {
      const job=[...jobs.values()].find(j=>j.status==='complete' && j.sourceExport?.capability===capability);
      if(!job)return null;
      if(name==='manifest.json')return {manifest:sourceManifest(job)};
      return SOURCE_FILES.includes(name)?job.sourceExport.files[name]:null;
    },
    artifact(id, ownerId, name, variant = null) {
      const job = jobs.get(id);
      if (!isJobAccessible(job, ownerId)) return null;
      const artifact = variant
        ? job.artifacts?.variants?.[variant]
        : job.artifacts?.[name];
      return artifact ? { ...artifact, public: job.visibility !== "private" } : null;
    },
    capabilityArtifact(slug, capability, name) {
      const job = [...jobs.values()].find((candidate) =>
        candidate.status === "complete" &&
        candidate.slug === slug &&
        capabilityFor(candidate) === capability
      );
      const artifact = job?.artifacts?.[name];
      return artifact ? { ...artifact, public: job.visibility !== "private" } : null;
    },
    subscribe(id, ownerId, listener) {
      const job = ownedJob(id, ownerId);
      if (!job) return null;
      events.on(id, listener);
      listener(jobSnapshot(job));
      return () => events.off(id, listener);
    },
    async retry(id, ownerId) {
      return retry(id, ownerId);
    },
    updateSettings,
    async remove(id, ownerId) {
      return remove(id, ownerId);
    },
    async cancel(id, ownerId) {
      return cancel(id, ownerId);
    },
    async reconcile() {
      return reconcileStaleJobs();
    },
    async runSingle(id, executionId) {
      const claim = await jobDatabase.claim(id, executionId, leaseSeconds);
      if (!claim.claimed) return claim.job ? publicJob(normalizeStoredJob(claim.job)) : null;
      workerExecutionId = executionId;
      const job = normalizeStoredJob(claim.job);
      jobs.set(job.id, job);
      // Renew the lease on a clock, not on pipeline output: mesh polling can be
      // silent for longer than the lease, which used to look like a dead worker.
      const heartbeat = setInterval(() => {
        if (leaseLost || !job.lease?.executionId) return;
        saveJob(job).catch((error) => {
          if (error.code !== "LEASE_LOST") console.error("Could not renew the fighter lease:", error);
        });
      }, Math.max(1_000, Math.floor((leaseSeconds * 1000) / 3)));
      // Cloud Run sends SIGTERM shortly before killing the container. Stop the
      // pipeline, checkpoint every finished stage, and leave the job resumable.
      const onTerminate = () => {
        console.warn(`SIGTERM received; checkpointing fighter job '${job.id}' before shutdown.`);
        abortCurrentRun("sigterm");
      };
      process.once("SIGTERM", onTerminate);
      try {
        return await runJob(job);
      } finally {
        clearInterval(heartbeat);
        process.off("SIGTERM", onTerminate);
      }
    },
    portraitPath(id, ownerId = null) {
      const job = jobs.get(id);
      return isJobAccessible(job, ownerId)
        ? path.join(pipelineUiRoot, job.slug, "portrait_raw.png")
        : null;
    },
    announcerPath(id, ownerId = null) {
      const job = jobs.get(id);
      return isJobAccessible(job, ownerId)
        ? path.join(pipelineUiRoot, job.slug, "announcer.wav")
        : null;
    },
    HttpError,
  };
}
