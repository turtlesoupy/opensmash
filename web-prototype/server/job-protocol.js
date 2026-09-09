import { CHARACTER_MESHES } from "../shared/fighter-targets.js";
import { createHash } from "node:crypto";

export const JOB_PROTOCOL_VERSION = 1;

export const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "retrying"]);
export const TERMINAL_JOB_STATUSES = new Set(["complete", "failed", "cancelled"]);

const CAPABILITY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function legacyCapability(jobId) {
  const digest = createHash("sha256")
    .update(`opensmash-asset-capability-v1:${jobId}`)
    .digest()
    .subarray(0, 16);
  let value = BigInt(`0x${digest.toString("hex")}`) % (62n ** 16n);
  let encoded = "";
  for (let index = 0; index < 16; index += 1) {
    encoded = CAPABILITY_ALPHABET[Number(value % 62n)] + encoded;
    value /= 62n;
  }
  return encoded;
}

export function capabilityFor(job) {
  return /^[A-Za-z0-9]{16}$/.test(job.assetCapability || "")
    ? job.assetCapability
    : legacyCapability(job.id);
}

export function publicJob(job) {
  const visibility = job.visibility || "private";
  const assetRoot = `/api/fighters/${encodeURIComponent(job.id)}/assets`;
  const result = {
    protocolVersion: JOB_PROTOCOL_VERSION,
    id: job.id,
    revision: job.revision || 0,
    name: job.name,
    slug: job.slug,
    emblem: job.emblem,
    visibility,
    uploader: job.uploader?.displayName ? { displayName: job.uploader.displayName } : null,
    status: job.status,
    stage: job.stage,
    stageLabel: job.stageLabel,
    progress: job.progress,
    attempt: job.attempt || 0,
    retry: job.retry || {
      automaticCounts: { moderation: 0, transient: 0 },
      nextAttemptAt: null,
      label: null,
    },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    error: job.error || null,
    logTail: job.logTail || [],
    photoName: job.photoName,
  };

  if (job.status === "complete") {
    const artifacts = job.artifacts || {};
    const capability = capabilityFor(job);
    const bundleRoot = `/engine/bundles/${encodeURIComponent(job.slug)}-${capability}`;
    const assetRoot = `/engine/fighters/${encodeURIComponent(job.slug)}-${capability}`;
    result.artifacts = artifacts;
    result.character = {
      slug: job.slug,
      name: job.displayName || job.name,
      short: job.short || job.name,
      // The grid draws `portrait` (tile-sized when the worker produced one);
      // `portraitMedium` is for thumbnails and `portraitFull` the 1024 art.
      portrait: artifacts.portraitTile?.url || artifacts.portrait?.url || `${assetRoot}/portrait-tile.png`,
      portraitMedium: artifacts.portraitMedium?.url || artifacts.portrait?.url || `${assetRoot}/portrait-medium.png`,
      portraitFull: artifacts.portrait?.url || `${assetRoot}/portrait.png`,
      announcer: artifacts.announcer?.url || `${assetRoot}/announcer.wav`,
      bundleUrl: artifacts.bundle?.url || `${bundleRoot}.osb6`,
      uiUrl: artifacts.ui?.url || `${bundleRoot}.osbui`,
      voiceUrl: artifacts.announcer?.url || `${bundleRoot}.wav`,
      manifestUrl: artifacts.manifest?.url || `${assetRoot}/manifest.json`,
      // Skeleton targets built into the single OSB6 bundle (legacy jobs
      // that uploaded one file per target expose the same list).
      variants: artifacts.targets || Object.keys(artifacts.variants || {}),
      visibility,
      uploader: result.uploader,
      base: job.retarget || "mario",
      fkind: CHARACTER_MESHES.find(({ value }) => value === job.retarget)?.fkind ?? 0,
      bundle: `${job.slug}.osb6`,
      specials: job.specials?.target === (job.retarget || "mario") ? job.specials : null,
    };
    result.costUsd = job.costUsd ?? null;
  }
  return result;
}

export function jobSnapshot(job) {
  return {
    protocolVersion: JOB_PROTOCOL_VERSION,
    type: "job.snapshot",
    emittedAt: new Date().toISOString(),
    job: publicJob(job),
  };
}
