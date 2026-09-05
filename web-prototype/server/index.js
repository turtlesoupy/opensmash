import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import { createFighterJobs } from "./fighter-jobs.js";
import { createTurnstileVerifier } from "./turnstile.js";
import { HandoffError, createHandoffRoomsFromEnv } from "./handoff-rooms.js";
import { createIceServerProvider } from "./handoff-ice.js";
import { createAuthService, isAuthHandlerPath } from "./auth.js";
import { createJobDatabase } from "./job-database.js";
import { createJobDispatcher } from "./job-dispatcher.js";
import { createObjectStore } from "./object-store.js";
import {
  cacheControlForEnvironment,
  edgeCacheHeaders,
  engineCacheControl,
} from "./cache-policy.js";
import { CREATION_DISABLED_MESSAGE, creationEnabled } from "./creation-switch.js";
import { withInitialState } from "./html-state.js";
import { withControllerRemap } from "./engine-html.js";
import { resolveProjectPaths } from "./project-paths.js";
import { assignRosterBases, bundleForBase, FIGHTERS, readOsb6Targets } from "./roster.js";
import { characterAssetKind, engineBundleAssetKind, loadRemoteBakedRoster } from "./baked-remote.js";
import { matchesCharacterSearch } from "../shared/character-search.js";
import { bakedRosterEntries } from "../shared/baked-roster.js";
import { ROMS_BY_SHA1, UNSUPPORTED_ROMS_BY_SHA1 } from "../shared/rom-catalog.js";
import { ACTIVE_JOB_STATUSES } from "./job-protocol.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  pipelineProjectRoot: PIPELINE_PROJECT_ROOT,
  engineRoot: ENGINE_ROOT,
  pipelineUiRoot: PIPELINE_UI_ROOT,
} = resolveProjectPaths(APP_ROOT);
const DIST_ROOT = path.join(APP_ROOT, "dist");
const APP_SHELL_PATHS = new Set([
  "/",
  "/create",
  "/create/",
  "/og-studio",
  "/og-studio/",
  "/index.html",
]);
const APP_SHELL_CACHE_CONTROL = "public, max-age=15";
const APP_SHELL_EDGE_CACHE_CONTROL =
  "public, max-age=30, stale-while-revalidate=300, stale-if-error=86400";
// Only explicit app pages are client-side routes; everything else under the
// outer app is a real file or a 404, so the shell is never served for
// /favicon.ico, /robots.txt, or typos.
const BASE_SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
});
// The outer app must never be framed (a framed /create could be clickjacked
// into a public submission). The engine is framed by the outer app itself.
const APP_SECURITY_HEADERS = Object.freeze({
  ...BASE_SECURITY_HEADERS,
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
});
const ENGINE_SECURITY_HEADERS = Object.freeze({
  ...BASE_SECURITY_HEADERS,
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
});

function securityHeaders(pathname) {
  return pathname.startsWith("/engine/") ? ENGINE_SECURITY_HEADERS : APP_SECURITY_HEADERS;
}
const PIPELINE_PLAY_ROOT = path.join(PIPELINE_PROJECT_ROOT, "play");
const OG_SPRITE_SCRIPT = path.join(PIPELINE_PROJECT_ROOT, "pipeline", "og_sprite.py");
const OG_SPRITE_ENGINE = process.env.OG_SPRITE_ENGINE
  || path.join(PIPELINE_PROJECT_ROOT, "..", "BattleShip", "build-us", "BattleShip");
// Boots run in parallel up to this many fighters (x2 chroma windows each);
// every job gets its own window tile so none is fully occluded (macOS
// throttles hidden windows and the frame-100 capture would crawl).
const OG_SPRITE_PARALLEL = Math.max(1, Number(process.env.OG_SPRITE_PARALLEL) || 3);
const ogSpriteSlots = Array.from({ length: OG_SPRITE_PARALLEL }, (_, index) => index);
const ogSpriteWaiters = [];
async function withOgSpriteSlot(task) {
  const slot = ogSpriteSlots.length
    ? ogSpriteSlots.shift()
    : await new Promise((resolve) => ogSpriteWaiters.push(resolve));
  try {
    return await task(slot);
  } finally {
    const next = ogSpriteWaiters.shift();
    if (next) next(slot);
    else ogSpriteSlots.push(slot);
  }
}
const SITE_ASSETS_ROOT = path.join(APP_ROOT, "visual", "assets");
const CHARACTERS_CONFIG = path.join(APP_ROOT, "config", "characters.json");
const BAKED_ASSETS_MANIFEST = path.join(APP_ROOT, "config", "baked-assets.json");
// Where the baked fighters' bytes live:
//  - local (default, development): play/ and play/ui/<slug> on this disk;
//  - remote (production): nothing on disk. The roster is built from the
//    checksum manifest and every asset request is answered with the
//    content-addressed object URL in the public bucket (server/baked-remote.js),
//    so the container image carries no fighters at all.
const BAKED_ASSET_SOURCE = process.env.BAKED_ASSET_SOURCE || "local";
if (!["local", "remote"].includes(BAKED_ASSET_SOURCE)) {
  throw new Error(`BAKED_ASSET_SOURCE must be 'local' or 'remote', got '${BAKED_ASSET_SOURCE}'`);
}
const BAKED_ASSETS_REMOTE = BAKED_ASSET_SOURCE === "remote";
const BAKED_ASSET_BASE_URL = (
  process.env.ASSET_BASE_URL ||
  (process.env.GCS_PUBLIC_BUCKET ? `https://storage.googleapis.com/${process.env.GCS_PUBLIC_BUCKET}` : "")
).replace(/\/+$/, "");
if (BAKED_ASSETS_REMOTE && !/^https?:\/\//.test(BAKED_ASSET_BASE_URL)) {
  throw new Error("BAKED_ASSET_SOURCE=remote needs ASSET_BASE_URL or GCS_PUBLIC_BUCKET");
}
// A redirect maps a mutable name (bundles/<slug>.osb6) to an immutable object
// URL. The target is cached for a year by construction; the redirect itself
// can only go stale when the roster is republished, and a deploy purges the
// edge, so an hour is safe.
const BAKED_REDIRECT_CACHE_CONTROL = "public, max-age=3600";
const objectStore = createObjectStore({ appRoot: APP_ROOT });
const dispatcher = createJobDispatcher();
const jobDatabase = createJobDatabase({
  jobsRoot: path.resolve(process.env.FIGHTER_JOBS_ROOT || path.join(APP_ROOT, "data", "fighter-jobs")),
});
const turnstile = createTurnstileVerifier();
const fighterJobs = createFighterJobs({
  appRoot: APP_ROOT,
  repoRoot: PIPELINE_PROJECT_ROOT,
  engineRoot: ENGINE_ROOT,
  pipelineUiRoot: PIPELINE_UI_ROOT,
  objectStore,
  jobDatabase,
  dispatcher,
  turnstile,
  reservedSlugs: async () => (await bakedRoster()).slugs,
});

const PORT = Number(process.env.PORT || 4174);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const authService = createAuthService({ isProduction: IS_PRODUCTION });
// Bump the cookie name whenever the validation contract changes. This also
// invalidates cookies created while the prototype was being exercised.
const COOKIE_NAME = "opensmash_rom_v4";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const COOKIE_SECRETS = [
  process.env.COOKIE_SECRET || "opensmash-local-development-only",
  process.env.COOKIE_SECRET_PREVIOUS,
].filter((secret, index, secrets) => secret && secrets.indexOf(secret) === index);
const MAX_JSON_BODY = 4096;
// WebRTC offers/answers run a few KiB; the room store caps each message again.
const MAX_HANDOFF_BODY = 32 * 1024;
const MAX_TRAILER_CAPTURE_BODY = 2 * 1024 * 1024 * 1024;
const TRAILER_CAPTURE_PATH = path.join(
  PIPELINE_PROJECT_ROOT,
  "artifacts",
  "trailer-captures",
  "intro-4x3-high.webm",
);

function finishTrailerCapture(inputPath, outputPath) {
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-fflags", "+genpts",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", "fps=60,scale=2560:1920:flags=neighbor",
    "-fps_mode", "cfr",
    "-c:v", "libvpx-vp9",
    "-pix_fmt", "yuv420p",
    "-b:v", "50M",
    "-deadline", "realtime",
    "-cpu-used", "8",
    "-row-mt", "1",
    "-threads", "8",
    "-c:a", "libopus",
    "-b:a", "192k",
    "-f", "webm",
    outputPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-64 * 1024);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Trailer finishing failed (ffmpeg ${code}): ${stderr.trim()}`));
    });
  });
}
// Memory locally, Firestore in production (follows JOB_DATABASE) so every API
// replica sees every room.
const handoffRooms = await createHandoffRoomsFromEnv();
// TURN relay credentials for the handoff (STUN-only when unconfigured).
const handoffIce = createIceServerProvider();
const ROM_VALIDATION_WINDOW_MS = 15 * 60 * 1000;
const ROM_VALIDATION_LIMIT = Number(process.env.ROM_VALIDATION_LIMIT || 10);
const romValidationAttempts = new Map();

const ROMS = ROMS_BY_SHA1;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
};

function redirectToBakedAsset(res, pathname, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": BAKED_REDIRECT_CACHE_CONTROL,
    "Cloudflare-CDN-Cache-Control": BAKED_REDIRECT_CACHE_CONTROL,
    ...securityHeaders(pathname),
  });
  res.end();
}

const gzip = promisify(gzipCallback);
const COMPRESS_MIN_BYTES = 1024;

// Cloudflare compresses toward browsers but pulls from the origin as-is, so
// the 1.4 MB roster shell and /api/characters crossed to the edge (and
// counted as Cloud Run egress) uncompressed. Only the handful of large
// text responses use this; small JSON replies stay on json().
async function compressed(req, res, status, body, headers) {
  const accepts = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
  let payload = body;
  const extra = { Vary: "Accept-Encoding" };
  if (accepts && body.length >= COMPRESS_MIN_BYTES) {
    payload = await gzip(body);
    extra["Content-Encoding"] = "gzip";
  }
  res.writeHead(status, { ...headers, ...extra, "Content-Length": payload.length });
  if (req.method === "HEAD") res.end();
  else res.end(payload);
}

async function jsonCompressed(req, res, status, data, headers = {}) {
  return compressed(req, res, status, Buffer.from(JSON.stringify(data)), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...BASE_SECURITY_HEADERS,
    ...headers,
  });
}

function json(res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...BASE_SECURITY_HEADERS,
    ...headers,
  });
  res.end(body);
}

// Live job progress. Streams end on their own once the job is terminal (the
// client only opens them for active jobs and also polls every 15 s), after a
// bounded lifetime (the browser reconnects transparently), and are capped per
// instance: a full instance answers with a long retry hint instead of holding
// the connection, so SSE can never crowd out ordinary requests.
const MAX_EVENT_STREAMS = Number(process.env.MAX_EVENT_STREAMS || 200);
const EVENT_STREAM_MAX_MS = Number(process.env.EVENT_STREAM_MAX_SECONDS || 20 * 60) * 1000;
let openEventStreams = 0;

function streamJobEvents(req, res, id, ownerId) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  if (openEventStreams >= MAX_EVENT_STREAMS) {
    res.end("retry: 30000\n\n");
    return;
  }
  openEventStreams += 1;

  let unsubscribe = null;
  let keepAlive = null;
  let lifetime = null;
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    openEventStreams -= 1;
    clearInterval(keepAlive);
    clearTimeout(lifetime);
    unsubscribe?.();
    if (!res.writableEnded) res.end();
  }
  unsubscribe = fighterJobs.subscribe(id, ownerId, (event) => {
    if (finished) return;
    res.write(`id: ${event.job.revision}\nevent: job\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.status === "deleted" || !ACTIVE_JOB_STATUSES.has(event.job.status)) finish();
  });
  if (!unsubscribe) {
    finish();
    return;
  }
  if (finished) {
    unsubscribe();
    return;
  }
  keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  lifetime = setTimeout(finish, EVENT_STREAM_MAX_MS);
  req.on("close", finish);
}

function parseCookies(req) {
  const entries = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return separator === -1
        ? [part, ""]
        : [part.slice(0, separator), part.slice(separator + 1)];
    });
  return Object.fromEntries(entries);
}

function signatureFor(payload, secret = COOKIE_SECRETS[0]) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function makeSession(hash, subject = randomUUID()) {
  const payload = Buffer.from(
    JSON.stringify({ version: 2, subject, hash, expires: Date.now() + COOKIE_MAX_AGE_SECONDS * 1000 }),
  ).toString("base64url");
  return `${payload}.${signatureFor(payload)}`;
}

function readSession(req) {
  const value = parseCookies(req)[COOKIE_NAME];
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator === -1) return null;

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const signatureBuffer = Buffer.from(signature);
  const validSignature = COOKIE_SECRETS.some((secret) => {
    const expectedBuffer = Buffer.from(signatureFor(payload, secret));
    return signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer);
  });
  if (!validSignature) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.version === 2 &&
      typeof session.subject === "string" &&
      /^[a-f0-9-]{36}$/.test(session.subject) &&
      ROMS.has(session.hash) &&
      session.expires > Date.now()
      ? session
      : null;
  } catch {
    return null;
  }
}

function validSession(req) {
  return Boolean(readSession(req));
}

function mutationOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return !IS_PRODUCTION;
  const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  const requestProtocol = String(
    req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http"),
  )
    .split(",")[0]
    .trim();
  const ownOrigin = requestHost ? `${requestProtocol}://${requestHost}` : null;
  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return origin === ownOrigin || configured.includes(origin);
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function romValidationAllowed(req) {
  const address = clientAddress(req);
  const cutoff = Date.now() - ROM_VALIDATION_WINDOW_MS;
  const attempts = (romValidationAttempts.get(address) || []).filter((time) => time >= cutoff);
  if (attempts.length >= ROM_VALIDATION_LIMIT) return false;
  attempts.push(Date.now());
  romValidationAttempts.set(address, attempts);
  return true;
}

function safeFile(root, relativePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath).replace(/^[/\\]+/, "");
  } catch {
    return null;
  }
  const resolved = path.resolve(root, decoded);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

// Every static file carries a validator so "no-cache" policies cost a 304
// instead of a re-download. Size + mtime is enough: deploys rebuild the image
// (new mtimes) and purge the edge, so a validator never outlives its bytes.
function etagFor(info) {
  return `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
}

function notModified(req, etag) {
  const header = req.headers["if-none-match"];
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === etag || value === `W/${etag}`;
  });
}

async function serveFile(req, res, filePath, cacheControl = "no-store", extraHeaders = {}) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const pathname = new URL(req.url, "http://localhost").pathname;
    const etag = etagFor(info);
    const headers = {
      "Cache-Control": cacheControlForEnvironment(cacheControl, IS_PRODUCTION),
      ETag: etag,
      "Last-Modified": new Date(info.mtimeMs).toUTCString(),
      ...securityHeaders(pathname),
      ...extraHeaders,
    };
    if (notModified(req, etag)) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": info.size,
      ...headers,
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      createReadStream(filePath).pipe(res);
    }
    return true;
  } catch {
    return false;
  }
}

async function serveEngineIndex(req, res, filePath, cacheControl, extraHeaders = {}) {
  try {
    const source = await readFile(filePath, "utf8");
    const body = withControllerRemap(source);
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": cacheControlForEnvironment(cacheControl, IS_PRODUCTION),
      ...ENGINE_SECURITY_HEADERS,
      ...extraHeaders,
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") res.end();
    else res.end(body);
    return true;
  } catch {
    return false;
  }
}

// Engine caching policy. package_web.sh stamps one content-derived build
// version (?v=) onto every runtime URL it controls, and the rules below make
// a stale/new mismatch impossible rather than merely unlikely:
//  - versioned and matching the deployed build: immutable for a year;
//  - versioned for any other build: 404 (engineBuildVersion). The origin
//    used to ignore ?v and would hand out new bytes under an old immutable
//    URL after a deploy, which is how a cached JS glue could meet a fresh
//    wasm;
//  - unversioned (index.html, manifest.json, and any file a future change
//    forgets to stamp): always revalidate. serveFile answers 304 to a
//    matching ETag;
//  - baked bundles served from disk (local mode): public and revalidated,
//    since their URLs carry no version. In remote mode they are a cacheable
//    302 to a content-addressed object instead (redirectToBakedAsset).
//    Anything else under bundles/ may be owner-scoped and is private/no-store.
const BAKED_BUNDLE_CACHE_CONTROL = "public, no-cache";

// The deployed engine build version, read from the ?v= the package stamped
// into manifest.json. null when the package is unversioned (no manifest).
let engineVersionCache = { mtime: null, version: null };

async function engineBuildVersion() {
  const manifestPath = path.join(ENGINE_ROOT, "manifest.json");
  let mtime;
  try {
    mtime = (await stat(manifestPath)).mtimeMs;
  } catch {
    return null;
  }
  if (engineVersionCache.mtime !== mtime) {
    let version = null;
    try {
      const match = (await readFile(manifestPath, "utf8")).match(/[?&]v=([A-Za-z0-9._-]+)/);
      version = match ? match[1] : null;
    } catch {
      // Unreadable manifest: treat the package as unversioned.
    }
    engineVersionCache = { mtime, version };
  }
  return engineVersionCache.version;
}

async function readJsonBody(req, limit = MAX_JSON_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function configuredCharacters(query = "", user = null) {
  const result = [...(await bakedRoster()).characters];
  const configuredSlugs = new Map(result.map((character, index) => [character.slug, index]));
  for (const job of fighterJobs.listVisible(user?.uid)) {
    if (job.status !== "complete" || !job.character) continue;
    if (configuredSlugs.has(job.slug)) {
      // A baked fighter the viewer generated still counts as theirs.
      if (job.mine) {
        const index = configuredSlugs.get(job.slug);
        result[index] = { ...result[index], mine: true };
      }
      continue;
    }
    result.push({ ...job.character, generated: true, mine: Boolean(job.mine) });
  }

  return result.filter((character) => matchesCharacterSearch(character, query));
}

async function bakedCharacterConfig() {
  return (await bakedRoster()).entries;
}

// The baked roster is computed once and reused by every request. It walks
// play/ and play/ui/<slug> (readdir, OSB6 header, character.json, access
// checks per character), which at 1000 fighters is thousands of fs ops, so
// it must never run per request. The cache is rebuilt when
// config/characters.json changes (one stat per request to notice that).
let bakedRosterCache = null;
let bakedRosterBuild = null;

async function bakedRoster() {
  let mtime = 0;
  const inputs = BAKED_ASSETS_REMOTE ? [CHARACTERS_CONFIG, BAKED_ASSETS_MANIFEST] : [CHARACTERS_CONFIG];
  for (const input of inputs) {
    try {
      mtime = Math.max(mtime, (await stat(input)).mtimeMs);
    } catch {
      // A missing manifest means an empty baked roster; keep any prior cache.
    }
  }
  if (bakedRosterCache && bakedRosterCache.mtime === mtime) return bakedRosterCache;
  bakedRosterBuild ||= buildBakedRoster(mtime).finally(() => { bakedRosterBuild = null; });
  return bakedRosterBuild;
}

async function buildBakedRoster(mtime) {
  const started = Date.now();
  const entries = bakedRosterEntries(JSON.parse(await readFile(CHARACTERS_CONFIG, "utf8")));
  if (BAKED_ASSETS_REMOTE) {
    const remote = await loadRemoteBakedRoster({
      manifestPath: BAKED_ASSETS_MANIFEST,
      entries,
      assetBaseUrl: BAKED_ASSET_BASE_URL,
    });
    bakedRosterCache = { mtime, ...remote };
    console.log(`Baked roster (remote): ${remote.characters.length} characters in ${Date.now() - started} ms`);
    return bakedRosterCache;
  }
  const roster = await scanEngineRoster(entries);
  const characters = [];
  for (const character of roster) {
    const { slug } = character;
    const fighterName = character.base || "mario";
    const fkind = FIGHTERS.indexOf(fighterName);
    if (fkind === -1) continue;
    const characterRoot = path.join(PIPELINE_UI_ROOT, slug);
    try {
      await access(path.join(characterRoot, "portrait_raw.png"));
      const bundle = bundleForBase(slug);
      await access(path.join(PIPELINE_PLAY_ROOT, bundle));
      // Small derivatives (pipeline/portrait_tiles.py); the grid draws the
      // 90x86 tile and thumbnails use the 256, so a 1000-fighter home page
      // is a few MB, not a gigabyte. Fall back to the raw portrait for a
      // character published before the derivatives existed.
      const derivative = async (name) => {
        try {
          await access(path.join(characterRoot, name));
          return `/character-assets/${slug}/${name}`;
        } catch {
          return `/character-assets/${slug}/portrait.png`;
        }
      };
      characters.push({
        slug,
        name: character.display,
        // Roster entry as requested (e.g. "Wolfgang Amadeus Mozart"); the
        // site's search and find-in-page text match on it.
        nameFull: character.nameFull || null,
        short: character.short,
        portrait: await derivative("portrait_tile.png"),
        portraitMedium: await derivative("portrait_medium.png"),
        portraitFull: `/character-assets/${slug}/portrait.png`,
        announcer: character.voice ? `/character-assets/${slug}/announcer.wav` : null,
        base: fighterName,
        fkind,
        bundle,
        variants: character.variants,
        ui: character.ui,
        voice: character.voice,
      });
    } catch (error) {
      console.warn(`Skipping staged character '${slug}': ${error.message}`);
    }
  }
  bakedRosterCache = {
    mtime,
    entries,
    roster,
    characters,
    slugs: new Set(roster.map((character) => character.slug)),
  };
  console.log(`Baked roster: ${characters.length} characters in ${Date.now() - started} ms`);
  return bakedRosterCache;
}

async function engineRoster() {
  return (await bakedRoster()).roster;
}

async function scanEngineRoster(entries) {
  const files = new Set(await readdir(PIPELINE_PLAY_ROOT));
  const characters = [];

  for (const entry of entries) {
    const { slug } = entry;
    if (!files.has(`${slug}.osb6`)) {
      console.warn(`Skipping baked character '${slug}': play/${slug}.osb6 is missing`);
      continue;
    }
    let variants;
    try {
      variants = (await readOsb6Targets(path.join(PIPELINE_PLAY_ROOT, `${slug}.osb6`)))
        .filter((target) => target !== "mario")
        .sort();
    } catch (error) {
      console.warn(`Skipping baked character '${slug}': ${error.message}`);
      continue;
    }
    let metadata = {};
    try {
      metadata = JSON.parse(await readFile(path.join(PIPELINE_UI_ROOT, slug, "character.json"), "utf8"));
    } catch {
      // Bundle-only characters still work with generated labels.
    }
    const display = entry.name || metadata.display || slug;
    let uiFiles = new Set();
    try {
      uiFiles = new Set(await readdir(path.join(PIPELINE_UI_ROOT, slug)));
    } catch {
      // configuredCharacters reports the missing required portrait clearly.
    }
    characters.push({
      slug,
      display,
      // the roster entry as requested (e.g. "Wolfgang Amadeus Mozart" when
      // display is the announcer-length "Mozart"); search matches on it too
      nameFull: metadata.name_full || null,
      short: entry.short || metadata.short || display.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10),
      base: entry.base ?? metadata.base ?? null,
      preferredBases: entry.preferredBases || metadata.preferred_bases,
      variants,
      ui: uiFiles.has(`${slug}.osbui`),
      voice: uiFiles.has("announcer.wav"),
    });
  }

  return assignRosterBases(characters);
}

// Remote mode: the immutable object URL for bundles/<slug>.<osb6|osbui|wav>.
async function bakedEngineRedirect(relative) {
  if (!BAKED_ASSETS_REMOTE) return null;
  const match = relative.match(/^bundles\/([^/]+)$/);
  const parsed = match && engineBundleAssetKind(match[1]);
  if (!parsed) return null;
  return (await bakedRoster()).assetUrl(parsed.slug, parsed.kind);
}

async function bakedEngineFile(relative) {
  if (BAKED_ASSETS_REMOTE) return null;
  const match = relative.match(/^bundles\/([a-z0-9]+)\.(osb6|osbui|wav)$/);
  if (!match) return null;
  const [, slug, extension] = match;
  if (!(await bakedRoster()).slugs.has(slug)) return null;

  if (extension === "osb6") {
    return path.join(PIPELINE_PLAY_ROOT, `${slug}.osb6`);
  }
  return path.join(
    PIPELINE_UI_ROOT,
    slug,
    extension === "osbui" ? `${slug}.osbui` : "announcer.wav",
  );
}

async function serveAppShell(req, res) {
  const shellPath = path.join(DIST_ROOT, "index.html");
  let html;
  try {
    html = await readFile(shellPath, "utf8");
  } catch {
    return false;
  }

  // This response is cached and shared by Cloudflare, so it must never contain
  // cookie-derived or private fighter data. Public Firestore fighters are
  // intentionally resolved on each edge cache miss rather than at startup.
  // If roster discovery fails, omit the seed and let the client fall back to
  // the no-store API instead of caching an authoritative empty roster.
  let initialState = {};
  try {
    initialState = { characters: await configuredCharacters("", null) };
  } catch (error) {
    console.warn(`Could not embed the public character roster: ${error.message}`);
  }
  const body = Buffer.from(withInitialState(html, initialState));
  await compressed(req, res, 200, body, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": cacheControlForEnvironment(APP_SHELL_CACHE_CONTROL, IS_PRODUCTION),
    ...edgeCacheHeaders(APP_SHELL_EDGE_CACHE_CONTROL, IS_PRODUCTION),
    ...APP_SECURITY_HEADERS,
  });
  return true;
}

async function handleRequest(req, res, vite) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;
  // Firebase's hosted sign-in helper, served from our origin (see auth.js).
  // It carries no cookies either way and is never edge-cached.
  if (isAuthHandlerPath(pathname)) {
    if (!authService.enabled || !authService.handlerOrigin) return json(res, 404, { error: "Not found" });
    return authService.proxyHandler(req, res);
  }
  const romSession = readSession(req);
  let user = await authService.readUser(req, {
    checkRevoked: req.method === "POST" && pathname.startsWith("/api/fighters"),
  });
  if (!authService.enabled && romSession) {
    user = {
      uid: `local-${romSession.subject}`,
      displayName: "Local developer",
      email: null,
      provider: "local",
    };
  }

  if (
    req.method === "GET" &&
    (pathname === "/livez" || pathname === "/healthz" || pathname === "/readyz")
  ) {
    return json(res, 200, {
      ok: true,
      database: jobDatabase.driver,
      objectStore: objectStore.driver,
      dispatcher: dispatcher.driver,
      handoffRooms: handoffRooms.driver,
      handoffIce: handoffIce.driver,
    });
  }

  if (req.method === "POST" && pathname.startsWith("/api/") && !mutationOriginAllowed(req)) {
    return json(res, 403, { error: "Request origin is not allowed" });
  }

  if (req.method === "GET" && pathname === "/api/auth/config") {
    return json(res, 200, authService.publicConfig());
  }

  if (req.method === "POST" && pathname === "/api/auth/session") {
    try {
      const body = await readJsonBody(req);
      const result = await authService.createSession(body.idToken);
      return json(res, 200, { user: result.user }, { "Set-Cookie": result.cookie });
    } catch (error) {
      return json(res, error.status || 401, { error: error.message || "Could not sign in." });
    }
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    return json(res, 200, { signedOut: true }, { "Set-Cookie": authService.clearCookie() });
  }

  if (req.method === "GET" && pathname === "/api/session") {
    return json(res, 200, {
      authorized: Boolean(romSession),
      authenticated: Boolean(user),
      creationEnabled: creationEnabled(),
      turnstileSiteKey: turnstile.siteKey,
      user,
    });
  }

  if (pathname.startsWith("/api/fighters")) {
    if (!romSession) return json(res, 401, { error: "ROM validation required" });
    if (!user) return json(res, 401, { error: "Sign in to use the fighter lab." });
  }

  if (req.method === "POST" && pathname === "/api/dev/clear-rom") {
    const cookie = [
      `${COOKIE_NAME}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0",
      IS_PRODUCTION ? "Secure" : null,
    ]
      .filter(Boolean)
      .join("; ");
    return json(res, 200, { cleared: true }, { "Set-Cookie": cookie });
  }

  if (req.method === "POST" && pathname === "/api/dev/trailer-capture") {
    if (IS_PRODUCTION) return json(res, 404, { error: "Not found" });
    if (!String(req.headers["content-type"] || "").startsWith("video/webm")) {
      return json(res, 415, { error: "Expected a WebM trailer capture." });
    }
    const uploadPath = `${TRAILER_CAPTURE_PATH}.upload.part.webm`;
    const finishedPath = `${TRAILER_CAPTURE_PATH}.finish.part.webm`;
    let captureFile;
    let bytes = 0;
    try {
      await mkdir(path.dirname(TRAILER_CAPTURE_PATH), { recursive: true });
      captureFile = await open(uploadPath, "w");
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_TRAILER_CAPTURE_BODY) {
          throw new Error("Trailer capture exceeded the 2 GB local limit.");
        }
        await captureFile.write(chunk);
      }
      await captureFile.close();
      captureFile = null;
      await finishTrailerCapture(uploadPath, finishedPath);
      await rename(finishedPath, TRAILER_CAPTURE_PATH);
      await unlink(uploadPath).catch(() => {});
      const finishedBytes = (await stat(TRAILER_CAPTURE_PATH)).size;
      return json(res, 201, {
        path: TRAILER_CAPTURE_PATH,
        bytes: finishedBytes,
        sourceBytes: bytes,
        width: 2560,
        height: 1920,
        framesPerSecond: 60,
      });
    } catch (error) {
      await captureFile?.close().catch(() => {});
      await unlink(uploadPath).catch(() => {});
      await unlink(finishedPath).catch(() => {});
      return json(res, 500, { error: error.message || "Could not save trailer capture." });
    }
  }

  // Open Graph studio, dev only: in-engine fighter cutout rendered by the
  // native build (pipeline/og_sprite.py boots the VS card twice over chroma
  // clears and difference-mattes). Cached on disk per slug+body; boots are
  // serialised because each one owns the game window.
  if (req.method === "GET" && pathname === "/api/og-sprite") {
    const slug = url.searchParams.get("slug") || "";
    const fkind = Number(url.searchParams.get("fkind"));
    if (!/^[a-z0-9]+$/.test(slug) || !Number.isInteger(fkind) || fkind < 0 || fkind > 11) {
      return json(res, 400, { error: "slug and fkind (0-11) required" });
    }
    if (!(await bakedRoster()).slugs.has(slug)) return json(res, 404, { error: "Unknown fighter" });
    const out = path.join(PIPELINE_UI_ROOT, slug, `og_sprite_fk${fkind}.png`);
    if (url.searchParams.get("force") === "1") await unlink(out).catch(() => {});
    try {
      await access(out);
    } catch {
      try {
        await access(OG_SPRITE_ENGINE);
      } catch {
        return json(res, 404, { error: "In-engine renders need the native BattleShip build on this machine" });
      }
      const run = (slot) => new Promise((resolve, reject) => {
        // Stagger inside the screen: a window pushed off the bottom gets
        // shrunk by macOS and the capture stops being 4:3.
        const win = `${20 + slot * 90},${40 + slot * 70}`;
        const child = spawn("python3", [OG_SPRITE_SCRIPT, slug, "--fkind", String(fkind), "--out", out, "--win", win], {
          cwd: PIPELINE_PROJECT_ROOT,
          env: { ...process.env, EVAL_BUILD: path.dirname(OG_SPRITE_ENGINE) },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let log = "";
        child.stdout.on("data", (chunk) => { log += chunk; });
        child.stderr.on("data", (chunk) => { log += chunk; });
        const timer = setTimeout(() => child.kill("SIGKILL"), 180000);
        child.on("error", reject);
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`og_sprite.py exited ${code}: ${log.trim().split("\n").pop()}`));
        });
      });
      try {
        await withOgSpriteSlot(run);
      } catch (error) {
        return json(res, 500, { error: error.message });
      }
    }
    if (await serveFile(req, res, out, "no-store")) return;
    return json(res, 500, { error: "Sprite missing after render" });
  }

  if (req.method === "GET" && pathname === "/api/characters") {
    return jsonCompressed(req, res, 200, {
      characters: await configuredCharacters(url.searchParams.get("q") || "", user),
    });
  }

  if (req.method === "GET" && pathname === "/api/fighters") {
    return json(res, 200, { jobs: fighterJobs.list(user.uid) });
  }

  // The killswitch is enforced here, not only in the UI: a paused lab must
  // also turn away a form posted from a tab that was open before the flip.
  if (
    req.method === "POST" &&
    (pathname === "/api/fighters" || /^\/api\/fighters\/[a-f0-9-]+\/retry$/.test(pathname)) &&
    !creationEnabled()
  ) {
    return json(res, 503, { error: CREATION_DISABLED_MESSAGE, creationDisabled: true });
  }

  if (req.method === "POST" && pathname === "/api/fighters") {
    try {
      return json(res, 202, { job: await fighterJobs.create(req, user) });
    } catch (error) {
      return json(res, error.status || 400, { error: error.message || "Could not create fighter." });
    }
  }

  const fighterEventsMatch = pathname.match(/^\/api\/fighters\/([a-f0-9-]+)\/events$/);
  if (req.method === "GET" && fighterEventsMatch) {
    if (!fighterJobs.get(fighterEventsMatch[1], user.uid)) {
      return json(res, 404, { error: "Fighter job not found." });
    }
    return streamJobEvents(req, res, fighterEventsMatch[1], user.uid);
  }

  const fighterMatch = pathname.match(/^\/api\/fighters\/([a-f0-9-]+)$/);
  if (req.method === "GET" && fighterMatch) {
    const job = fighterJobs.get(fighterMatch[1], user.uid);
    return job
      ? json(res, 200, { job })
      : json(res, 404, { error: "Fighter job not found." });
  }

  const fighterDeleteMatch = pathname.match(/^\/api\/fighters\/([a-f0-9-]+)$/);
  if (req.method === "DELETE" && fighterDeleteMatch) {
    try {
      return json(res, 200, { deleted: await fighterJobs.remove(fighterDeleteMatch[1], user.uid) });
    } catch (error) {
      return json(res, error.status || 400, { error: error.message || "Could not delete fighter." });
    }
  }

  const fighterRetryMatch = pathname.match(/^\/api\/fighters\/([a-f0-9-]+)\/retry$/);
  if (req.method === "POST" && fighterRetryMatch) {
    try {
      return json(res, 202, { job: await fighterJobs.retry(fighterRetryMatch[1], user.uid) });
    } catch (error) {
      return json(res, error.status || 400, { error: error.message || "Could not retry fighter." });
    }
  }

  const fighterCancelMatch = pathname.match(/^\/api\/fighters\/([a-f0-9-]+)\/cancel$/);
  if (req.method === "POST" && fighterCancelMatch) {
    try {
      return json(res, 200, { job: await fighterJobs.cancel(fighterCancelMatch[1], user.uid) });
    } catch (error) {
      return json(res, error.status || 400, { error: error.message || "Could not cancel fighter." });
    }
  }

  // ROM handoff signalling (shared/rom-handoff.js, server/handoff-rooms.js).
  // Only SDP and ICE candidates pass through here; the ROM streams
  // peer-to-peer between the player's own devices.
  if (req.method === "GET" && pathname === "/api/handoff/ice") {
    return json(res, 200, await handoffIce.iceServers(), { "Cache-Control": "no-store" });
  }

  const handoffMatch = pathname.match(/^\/api\/handoff\/rooms(?:\/([A-Za-z0-9]{1,12})\/(join|messages|close))?$/);
  if (handoffMatch) {
    const [, code, verb] = handoffMatch;
    try {
      if (!code && req.method === "POST") {
        // Hosting requires a validated ROM session: the host is about to
        // stream the ROM it already proved it holds.
        if (!romSession) return json(res, 401, { error: "Validate your ROM on this device before sending it to another." });
        return json(res, 200, await handoffRooms.create({ address: clientAddress(req) }));
      }
      if (code && verb === "join" && req.method === "POST") {
        return json(res, 200, await handoffRooms.join(code));
      }
      if (code && verb === "messages" && req.method === "POST") {
        const body = await readJsonBody(req, MAX_HANDOFF_BODY);
        return json(res, 200, await handoffRooms.post(code, {
          role: String(body.role || ""),
          key: String(body.key || ""),
          message: body.message,
          messages: body.messages,
        }));
      }
      if (code && verb === "messages" && req.method === "GET") {
        return json(res, 200, await handoffRooms.poll(code, {
          role: String(url.searchParams.get("role") || ""),
          key: String(url.searchParams.get("key") || ""),
          after: Number(url.searchParams.get("after") || 0),
        }), { "Cache-Control": "no-store" });
      }
      if (code && verb === "close" && req.method === "POST") {
        const body = await readJsonBody(req);
        return json(res, 200, await handoffRooms.close(code, { role: String(body.role || ""), key: String(body.key || "") }));
      }
      return json(res, 405, { error: "Method not allowed" });
    } catch (error) {
      if (error instanceof HandoffError) return json(res, error.status, { error: error.message });
      return json(res, 400, { error: error.message || "Invalid request" });
    }
  }

  if (req.method === "POST" && pathname === "/api/validate-rom") {
    try {
      if (!romValidationAllowed(req)) {
        return json(res, 429, { error: "Too many ROM validation attempts. Try again later." });
      }
      const body = await readJsonBody(req);
      const hash = String(body.hash || "").toLowerCase();
      if (body.algorithm !== "SHA-1" || !/^[a-f0-9]{40}$/.test(hash) || !ROMS.has(hash)) {
        const known = UNSUPPORTED_ROMS_BY_SHA1.get(hash);
        if (known) {
          return json(res, 422, {
            error: `That is the ${known.region} release, which this port cannot run yet. Only the USA (NALE) ROM is supported.`,
          });
        }
        return json(res, 422, { error: "That file is not a supported Super Smash Bros. 64 ROM. Only the USA (NALE) release works." });
      }
      const rom = ROMS.get(hash);
      if (Number(body.size) !== rom.size) {
        return json(res, 422, { error: "The ROM has the right hash but an unexpected file size." });
      }

      const cookie = [
        `${COOKIE_NAME}=${makeSession(hash, romSession?.subject)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
        IS_PRODUCTION ? "Secure" : null,
      ]
        .filter(Boolean)
        .join("; ");
      return json(res, 200, { valid: true, rom: rom.name }, { "Set-Cookie": cookie });
    } catch (error) {
      return json(res, 400, { error: error.message || "Invalid request" });
    }
  }

  if (pathname === "/engine") {
    res.writeHead(302, { Location: "/engine/" });
    return res.end();
  }

  if (pathname.startsWith("/engine/")) {
    const relative = pathname.slice("/engine/".length) || "index.html";
    const capabilityMatch = relative.match(
      /^bundles\/([a-z0-9]+)-([A-Za-z0-9]{16})\.(osb6|osbui|wav)$/,
    );
    const capabilityAssetMatch = relative.match(
      /^fighters\/([a-z0-9]+)-([A-Za-z0-9]{16})\/(portrait|portrait-tile|portrait-medium|announcer|manifest)\.(png|wav|json)$/,
    );
    if (capabilityMatch || capabilityAssetMatch) {
      const [, slug, capability, requestedName, requestedType] = capabilityMatch || capabilityAssetMatch;
      const artifactName = capabilityMatch
        ? requestedName === "osb6" ? "bundle" : requestedName === "osbui" ? "ui" : "announcer"
        : ({
            portrait: "portrait",
            "portrait-tile": "portraitTile",
            "portrait-medium": "portraitMedium",
            announcer: "announcer",
            manifest: "manifest",
          })[requestedName];
      if (capabilityAssetMatch) {
        const expectedType = requestedName === "announcer" ? "wav" : requestedName === "manifest" ? "json" : "png";
        if (requestedType !== expectedType) return json(res, 404, { error: "Engine file not found" });
      }
      const artifact = fighterJobs.capabilityArtifact(slug, capability, artifactName);
      if (!artifact) return json(res, 404, { error: "Engine file not found" });
      let object;
      try {
        object = await objectStore.readStream(artifact.key, { public: artifact.public });
      } catch {
        return json(res, 404, { error: "Engine file not found" });
      }
      res.writeHead(200, {
        "Content-Type": artifact.contentType || "application/octet-stream",
        "Content-Length": object.size,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cloudflare-CDN-Cache-Control": "public, max-age=31536000, immutable",
        ...ENGINE_SECURITY_HEADERS,
      });
      if (req.method === "HEAD") {
        object.stream.destroy();
        return res.end();
      }
      object.stream.on("error", (error) => {
        console.error(`Capability asset stream failed for ${artifact.key}:`, error);
        res.destroy();
      });
      return object.stream.pipe(res);
    }
    const bundleMatch = relative.match(/^bundles\/([a-z0-9]+)(?:-|\.)/);
    if (!bundleMatch && url.searchParams.has("v")) {
      const current = await engineBuildVersion();
      if (current && url.searchParams.get("v") !== current) {
        return json(res, 404, { error: "That engine file belongs to a different build. Reload the page." });
      }
    }
    const bakedFile = bundleMatch ? await bakedEngineFile(relative) : null;
    const bakedRedirect = bundleMatch ? await bakedEngineRedirect(relative) : null;
    const visibleDynamicBundle = bundleMatch && fighterJobs
      .listVisible(user?.uid)
      .some((job) => job.slug === bundleMatch[1]);
    if (bundleMatch && !bakedFile && !bakedRedirect && !visibleDynamicBundle) {
      return json(res, 404, { error: "Engine file not found" });
    }
    if (bakedRedirect) return redirectToBakedAsset(res, pathname, bakedRedirect);
    if (bakedFile) {
      if (await serveFile(req, res, bakedFile, BAKED_BUNDLE_CACHE_CONTROL)) return;
      return json(res, 404, { error: "Engine file not found" });
    }
    const filePath = safeFile(ENGINE_ROOT, relative);
    const cacheControl = engineCacheControl(relative, url.searchParams);
    if (relative === "index.html" && filePath && (await serveEngineIndex(
      req,
      res,
      filePath,
      cacheControl,
      edgeCacheHeaders(cacheControl, IS_PRODUCTION),
    ))) return;
    if (filePath && (await serveFile(
      req,
      res,
      filePath,
      cacheControl,
      edgeCacheHeaders(cacheControl, IS_PRODUCTION),
    ))) return;
    return json(res, 404, { error: "Engine file not found" });
  }

  if (pathname === "/bundles.json" || pathname === "/roster.json") {
    if (pathname === "/bundles.json") {
      const names = (await engineRoster()).flatMap((character) => [
        `${character.slug}.osb6`,
        ...(character.ui ? [`${character.slug}.osbui`] : []),
        ...(character.voice ? [`${character.slug}.wav`] : []),
      ]).sort();
      return jsonCompressed(req, res, 200, names, { "Cache-Control": "public, no-cache" });
    }
    return jsonCompressed(req, res, 200, await engineRoster(), { "Cache-Control": "public, no-cache" });
  }

  if (pathname.startsWith("/character-assets/")) {
    const match = pathname.match(
      /^\/character-assets\/([a-z0-9]+)\/(portrait\.png|portrait_tile\.png|portrait_medium\.png|announcer\.wav)$/,
    );
    if (!match) return json(res, 404, { error: "Character asset not found" });
    if (!(await bakedRoster()).slugs.has(match[1])) {
      return json(res, 404, { error: "Character asset not found" });
    }
    if (BAKED_ASSETS_REMOTE) {
      const location = (await bakedRoster()).assetUrl(match[1], characterAssetKind(match[2]));
      if (!location) return json(res, 404, { error: "Character asset not found" });
      return redirectToBakedAsset(res, pathname, location);
    }
    const fileName = match[2] === "portrait.png" ? "portrait_raw.png" : match[2];
    const filePath = path.join(PIPELINE_UI_ROOT, match[1], fileName);
    if (await serveFile(req, res, filePath, "public, max-age=3600")) return;
    return json(res, 404, { error: "Character asset not found" });
  }

  if (pathname.startsWith("/site-assets/")) {
    const filePath = safeFile(SITE_ASSETS_ROOT, pathname.slice("/site-assets/".length));
    if (filePath && (await serveFile(req, res, filePath, "public, max-age=300"))) return;
    return json(res, 404, { error: "Site asset not found" });
  }

  // Runtime media remains under a stable path; executable visual modules are
  // part of Vite's hashed production build.
  if (pathname.startsWith("/assets/")) {
    const filePath = safeFile(SITE_ASSETS_ROOT, pathname.slice("/assets/".length));
    if (filePath && (await serveFile(req, res, filePath, "public, max-age=300"))) return;
    return json(res, 404, { error: "Site asset not found" });
  }

  if (pathname.startsWith("/objects/") && objectStore.driver === "local") {
    const objectKey = pathname.slice("/objects/".length);
    const objectMatch = objectKey.match(/^characters\/([a-z0-9]+)\/(?:versions\/[a-f0-9-]+-\d+\/|latest\.json$)/);
    const isVersioned = /^characters\/[a-z0-9]+\/versions\/[a-f0-9-]+-\d+\//.test(objectKey);
    const isLatest = /^characters\/[a-z0-9]+\/latest\.json$/.test(objectKey);
    if (!isVersioned && !isLatest) {
      return json(res, 404, { error: "Object not found" });
    }
    if (!objectMatch || !fighterJobs.isSlugPublic(objectMatch[1])) {
      return json(res, 404, { error: "Object not found" });
    }
    const filePath = objectStore.localPath(objectKey);
    const cacheControl = isLatest
      ? "public, max-age=60"
      : "public, max-age=31536000, immutable";
    if (await serveFile(req, res, filePath, cacheControl)) return;
    return json(res, 404, { error: "Object not found" });
  }

  if (vite) {
    return vite.middlewares(req, res, () => json(res, 404, { error: "Not found" }));
  }

  if (APP_SHELL_PATHS.has(pathname)) {
    if (await serveAppShell(req, res)) return;
    return json(res, 404, { error: "Frontend build not found. Run pnpm build first." });
  }

  const relative = pathname.slice(1);
  const filePath = safeFile(DIST_ROOT, relative);
  const cacheControl = pathname.startsWith("/app-assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300";
  if (filePath && (await serveFile(req, res, filePath, cacheControl))) return;
  return json(res, 404, { error: "Not found" });
}

let vite = null;
if (!IS_PRODUCTION) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    root: APP_ROOT,
    appType: "spa",
    server: {
      middlewareMode: true,
      // Dev only: extra hostnames allowed to reach the Vite middleware, e.g.
      // an ngrok tunnel for phone testing (VITE_ALLOWED_HOSTS=.ngrok-free.app).
      ...(process.env.VITE_ALLOWED_HOSTS
        ? { allowedHosts: process.env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean) }
        : {}),
    },
  });
}

if (IS_PRODUCTION && process.env.COOKIE_SECRET === undefined) {
  throw new Error("COOKIE_SECRET must be set in production.");
}

// Cloud Run runs a single instance; an unhandled rejection anywhere would
// otherwise exit the process and take the whole site down with it.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

const server = http.createServer((req, res) => {
  handleRequest(req, res, vite).catch((error) => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: "Internal server error" });
    else res.destroy();
  });
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

await objectStore.init();
await jobDatabase.init();
await dispatcher.init();
await authService.init();
await fighterJobs.init();
await bakedRoster().catch((error) => console.warn(`Baked roster unavailable at boot: ${error.message}`));
server.listen(PORT, HOST, () => {
  console.log(`OpenSmash web: http://${HOST}:${PORT}`);
});
