#!/usr/bin/env bash
set -euo pipefail

required=(PROJECT_ID REGION PUBLIC_ORIGIN FIREBASE_API_KEY FIREBASE_APP_ID)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 2
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BATTLESHIP_ROOT="$WORKSPACE_ROOT/BattleShip"
SERVICE_NAME="${SERVICE_NAME:-opensmash-web}"
WORKER_SERVICE="${WORKER_SERVICE:-opensmash-worker}"
# The previous Job-per-fighter worker; kept deployable for rollback
# (FIGHTER_EXECUTION_MODE=cloud-run on the API switches back to it).
WORKER_JOB="${WORKER_JOB:-opensmash-fighter-worker}"
# Warm fighter workers: each instance runs one fighter at a time and stays
# resident, so a create starts in seconds instead of the 1-4 minutes a Cloud
# Run Job execution spent provisioning. Idle minimum instances bill at the
# always-allocated rate (about $0.09/h each for 4 vCPU / 8 GiB).
WORKER_MIN_INSTANCES="${WORKER_MIN_INSTANCES:-2}"
WORKER_MAX_INSTANCES="${WORKER_MAX_INSTANCES:-10}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-opensmash}"
PRIVATE_BUCKET="${PRIVATE_BUCKET:-${PROJECT_ID}-fighter-sources}"
PUBLIC_BUCKET="${PUBLIC_BUCKET:-${PROJECT_ID}-fighter-assets}"
ASSET_BASE_URL="${ASSET_BASE_URL:-https://storage.googleapis.com/${PUBLIC_BUCKET}}"
API_SERVICE_ACCOUNT="${API_SERVICE_ACCOUNT:-opensmash-api}"
WORKER_SERVICE_ACCOUNT="${WORKER_SERVICE_ACCOUNT:-opensmash-worker}"
API_IDENTITY="${API_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_IDENTITY="${WORKER_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"
# Serve Firebase's sign-in helper from our own domain (the API proxies /__/auth/*
# to ${PROJECT_ID}.firebaseapp.com). Requires https://${DOMAIN}/__/auth/handler
# as a return URL on the Apple Services ID and the Google OAuth client.
FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-${PUBLIC_ORIGIN#https://}}"
IMAGE_ROOT="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}"
VERSION="${VERSION:-$(date -u +%Y%m%d-%H%M%S)}"
API_IMAGE="${IMAGE_ROOT}/web:${VERSION}"
WORKER_IMAGE="${IMAGE_ROOT}/worker:${VERSION}"
COOKIE_SECRET_NAME="${COOKIE_SECRET_NAME:-opensmash-cookie-secret}"
COOKIE_SECRET_PREVIOUS_NAME="${COOKIE_SECRET_PREVIOUS_NAME:-opensmash-cookie-secret-previous}"
DOMAIN="${DOMAIN:-${PUBLIC_ORIGIN#https://}}"
DOMAIN="${DOMAIN%/}"

assert_clean_source() {
  local repo="$1"
  local label="$2"
  shift 2
  local changes
  changes="$(git -C "$repo" status --porcelain --untracked-files=normal -- "$@")"
  if [[ -n "$changes" ]]; then
    echo "$label has source changes that are not committed:" >&2
    printf '%s\n' "$changes" >&2
    echo "Commit or stash them before deploying so Cloud Build receives a reproducible tree." >&2
    exit 2
  fi
}

# Cloud Build uploads the local filesystem, so fail before any remote mutation
# if a file included by either Docker context could differ from a commit.
assert_clean_source "$WORKSPACE_ROOT/pipeline" pipeline \
  web-prototype pipeline skels assets/portrait_style_refs assets/tpose_style_ref
assert_clean_source "$BATTLESHIP_ROOT" BattleShip web scripts port/css_icons torch decomp

# The engine package no longer ships the ROM-derived archive; the browser
# builds it with Torch compiled to wasm (BattleShip/docs/web_rom_extraction.md).
# Build that module from the committed torch submodule + port sources so the
# image never ships a stale one. Needs an activated emsdk (emcmake on PATH),
# same as the engine's own build-wasm.
if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake not found: activate emsdk (source emsdk/emsdk_env.sh) before deploying." >&2
  exit 2
fi
"$BATTLESHIP_ROOT/scripts/build_torch_wasm.sh"

# Rebuild the engine itself before packaging. package_web.sh only copies
# whatever build-wasm holds, so without this a deploy after a decomp bump
# shipped whichever wasm was last built by hand (seen 2026-09-03: the VS card
# change missed a deploy). The configured build tree is required; ninja is a
# no-op when nothing changed.
if [[ ! -f "$BATTLESHIP_ROOT/build-wasm/build.ninja" ]]; then
  echo "BattleShip/build-wasm is not configured; see BattleShip/docs/web_dev_harness.md." >&2
  exit 2
fi
ninja -C "$BATTLESHIP_ROOT/build-wasm" BattleShip.js

# Always regenerate the complete engine package. package_web.sh derives one
# version from every runtime input and preserves separately built bundles.
# It exits non-zero if the Torch module is missing, so a deploy can never
# produce an engine with no way to obtain BattleShip.o2r.
"$BATTLESHIP_ROOT/scripts/package_web.sh" \
  "$BATTLESHIP_ROOT/build-wasm" "$BATTLESHIP_ROOT/web-dist"
for required in torch/torch.wasm torch/recipe.json rom-extract.js torch-worker.js; do
  if [[ ! -f "$BATTLESHIP_ROOT/web-dist/$required" ]]; then
    echo "web-dist is missing $required; the engine could not build its assets in the browser." >&2
    exit 2
  fi
done
if [[ -f "$BATTLESHIP_ROOT/web-dist/files/BattleShip.o2r" ]]; then
  echo "web-dist/files/BattleShip.o2r is present: refusing to deploy a package that ships ROM-derived assets." >&2
  exit 2
fi

gcloud config set project "$PROJECT_ID"
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com

gcloud firestore databases describe --database='(default)' >/dev/null
# ROM-handoff signalling rooms live in Firestore so every API replica can serve
# either side of a handoff; a TTL policy on expireAt sweeps stale rooms.
gcloud firestore fields ttls update expireAt \
  --collection-group=handoffRooms --enable-ttl --quiet >/dev/null 2>&1 || true

if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
    --location "$REGION" --repository-format docker
fi

for bucket in "$PRIVATE_BUCKET" "$PUBLIC_BUCKET"; do
  if ! gcloud storage buckets describe "gs://${bucket}" >/dev/null 2>&1; then
    gcloud storage buckets create "gs://${bucket}" \
      --location "$REGION" --uniform-bucket-level-access
  fi
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${API_IDENTITY}" --role roles/firebaseauth.admin >/dev/null

# Bucket CORS is set further down, once the baked manifest has been checked.
gcloud storage buckets add-iam-policy-binding "gs://${PUBLIC_BUCKET}" \
  --member allUsers --role roles/storage.objectViewer

for account in "$API_SERVICE_ACCOUNT" "$WORKER_SERVICE_ACCOUNT"; do
  if ! gcloud iam service-accounts describe "${account}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account"
  fi
done

for identity in "$API_IDENTITY" "$WORKER_IDENTITY"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${identity}" --role roles/datastore.user >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://${PRIVATE_BUCKET}" \
  --member "serviceAccount:${API_IDENTITY}" --role roles/storage.objectAdmin >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${PRIVATE_BUCKET}" \
  --member "serviceAccount:${WORKER_IDENTITY}" --role roles/storage.objectAdmin >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${PUBLIC_BUCKET}" \
  --member "serviceAccount:${WORKER_IDENTITY}" --role roles/storage.objectAdmin >/dev/null
for bucket in "$PRIVATE_BUCKET" "$PUBLIC_BUCKET"; do
  for identity in "$API_IDENTITY" "$WORKER_IDENTITY"; do
    gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
      --member "serviceAccount:${identity}" --role roles/storage.bucketViewer >/dev/null
  done
done

for secret in "$COOKIE_SECRET_NAME" opensmash-openai-api-key opensmash-tripo-api-key opensmash-fal-key opensmash-minimax-voice-id; do
  gcloud secrets describe "$secret" >/dev/null
done
if ! gcloud secrets describe "$COOKIE_SECRET_PREVIOUS_NAME" >/dev/null 2>&1; then
  gcloud secrets create "$COOKIE_SECRET_PREVIOUS_NAME" --replication-policy=automatic >/dev/null
  gcloud secrets versions access latest --secret "$COOKIE_SECRET_NAME" | \
    gcloud secrets versions add "$COOKIE_SECRET_PREVIOUS_NAME" --data-file=- >/dev/null
fi
gcloud secrets add-iam-policy-binding "$COOKIE_SECRET_NAME" \
  --member "serviceAccount:${API_IDENTITY}" --role roles/secretmanager.secretAccessor >/dev/null
gcloud secrets add-iam-policy-binding "$COOKIE_SECRET_PREVIOUS_NAME" \
  --member "serviceAccount:${API_IDENTITY}" --role roles/secretmanager.secretAccessor >/dev/null
# Optional TURN relay for the ROM handoff (see infra/README.md "TURN relay").
# When both Cloudflare TURN secrets exist they are mounted into the API; without
# them the handoff is STUN-only and works on shared networks only.
API_TURN_SECRETS=""
if gcloud secrets describe opensmash-cloudflare-turn-key-id >/dev/null 2>&1 && \
   gcloud secrets describe opensmash-cloudflare-turn-key-token >/dev/null 2>&1; then
  for secret in opensmash-cloudflare-turn-key-id opensmash-cloudflare-turn-key-token; do
    gcloud secrets add-iam-policy-binding "$secret" \
      --member "serviceAccount:${API_IDENTITY}" --role roles/secretmanager.secretAccessor >/dev/null
  done
  API_TURN_SECRETS=",CLOUDFLARE_TURN_KEY_ID=opensmash-cloudflare-turn-key-id:latest,CLOUDFLARE_TURN_KEY_API_TOKEN=opensmash-cloudflare-turn-key-token:latest"
  echo "TURN relay: Cloudflare credentials found; mounting into the API."
else
  echo "TURN relay: no Cloudflare TURN secrets; handoff will be STUN-only."
fi
# Turnstile human check on fighter creation (server/turnstile.js). The site
# key is public; the secret lives in Secret Manager. Production refuses to
# start without the secret, so the deploy fails here rather than at boot.
TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY:-0x4AAAAAAEnMDLVYxIQ7B3Q-}"
if ! gcloud secrets describe opensmash-turnstile-secret >/dev/null 2>&1; then
  echo "Secret opensmash-turnstile-secret is missing; create it from the Turnstile widget for ${DOMAIN}." >&2
  exit 2
fi
gcloud secrets add-iam-policy-binding opensmash-turnstile-secret \
  --member "serviceAccount:${API_IDENTITY}" --role roles/secretmanager.secretAccessor >/dev/null
gcloud secrets add-iam-policy-binding opensmash-openai-api-key \
  --member "serviceAccount:${API_IDENTITY}" --role roles/secretmanager.secretAccessor >/dev/null
for secret in opensmash-openai-api-key opensmash-tripo-api-key opensmash-fal-key opensmash-minimax-voice-id; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member "serviceAccount:${WORKER_IDENTITY}" --role roles/secretmanager.secretAccessor >/dev/null
done

# The baked roster is never copied into the image. The API serves it from the
# committed config/baked-assets.json manifest (BAKED_ASSET_SOURCE=remote) and
# browsers fetch the content-addressed objects straight from the public
# bucket, so check the manifest is the current schema and matches
# config/characters.json before anything is built.
(cd "$WORKSPACE_ROOT/pipeline/web-prototype" && node --input-type=module -e '
import { readFile } from "node:fs/promises";
import { bakedRosterSlugs } from "./shared/baked-roster.js";
import { validateBakedAssetManifest } from "./shared/baked-assets.js";
const slugs = bakedRosterSlugs(JSON.parse(await readFile("config/characters.json", "utf8")));
const manifest = validateBakedAssetManifest(JSON.parse(await readFile("config/baked-assets.json", "utf8")), slugs);
console.log(`Baked manifest: ${manifest.characters.length} fighters pinned by digest.`);
')
# The engine fetches bundles/<slug>.osb6 relative to /engine/ and follows the
# API'"'"'s redirect to the bucket, which makes it a cross-origin request.
# Origins already on the bucket (older site domains) are kept.
cors_file="$(mktemp)"
trap 'rm -f "$cors_file"' EXIT
gcloud storage buckets describe "gs://${PUBLIC_BUCKET}" --format=json \
  | PUBLIC_ORIGIN="$PUBLIC_ORIGIN" DOMAIN="$DOMAIN" node -e '
let raw = ""; process.stdin.on("data", (d) => raw += d).on("end", () => {
  const existing = (JSON.parse(raw).cors_config || []).flatMap((rule) => rule.origin || []);
  const origins = [...new Set([...existing, process.env.PUBLIC_ORIGIN, `https://www.${process.env.DOMAIN}`,
    "http://localhost:4174", "http://localhost:4180"])];
  console.log(JSON.stringify([{ origin: origins, method: ["GET", "HEAD"],
    responseHeader: ["Content-Type", "Content-Length", "Range", "Cache-Control", "ETag"], maxAgeSeconds: 3600 }]));
});' > "$cors_file"
gcloud storage buckets update "gs://${PUBLIC_BUCKET}" --cors-file="$cors_file"

cd "$WORKSPACE_ROOT"
# The two images share nothing, so submit both builds and wait for both.
# Each submit still uploads its own context synchronously (small now).
API_BUILD_ID="$(gcloud builds submit . --async --format='value(id)' \
  --ignore-file pipeline/web-prototype/docker/api.Dockerfile.dockerignore \
  --config pipeline/web-prototype/infra/cloudbuild-api.yaml \
  --substitutions "_IMAGE=${API_IMAGE}")"
WORKER_BUILD_ID="$(gcloud builds submit . --async --format='value(id)' \
  --ignore-file pipeline/web-prototype/docker/worker.Dockerfile.dockerignore \
  --config pipeline/web-prototype/infra/cloudbuild-worker.yaml \
  --substitutions "_IMAGE=${WORKER_IMAGE}")"
echo "Cloud Build: api=${API_BUILD_ID} worker=${WORKER_BUILD_ID}"

wait_for_builds() {
  local pending=("$@")
  local failed=0
  while ((${#pending[@]})); do
    local still=()
    for id in "${pending[@]}"; do
      local status
      status="$(gcloud builds describe "$id" --format='value(status)')"
      case "$status" in
        SUCCESS) echo "Build ${id}: SUCCESS" ;;
        FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)
          echo "Build ${id}: ${status}" >&2
          echo "  gcloud builds log ${id}" >&2
          failed=1 ;;
        *) still+=("$id") ;;
      esac
    done
    pending=("${still[@]+"${still[@]}"}")
    ((${#pending[@]})) && sleep 15
  done
  return "$failed"
}
wait_for_builds "$API_BUILD_ID" "$WORKER_BUILD_ID"

gcloud run deploy "$WORKER_SERVICE" \
  --image "$WORKER_IMAGE" \
  --region "$REGION" \
  --service-account "$WORKER_IDENTITY" \
  --no-allow-unauthenticated \
  --ingress all \
  --port 8080 --cpu 4 --memory 8Gi --concurrency 1 --no-cpu-throttling --cpu-boost \
  --min-instances "$WORKER_MIN_INSTANCES" --max-instances "$WORKER_MAX_INSTANCES" --timeout 3600 \
  --set-env-vars "JOB_DATABASE=firestore,OBJECT_STORE=gcs,FIGHTER_JOBS_ROOT=/tmp/fighter-jobs,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCS_PRIVATE_BUCKET=${PRIVATE_BUCKET},GCS_PUBLIC_BUCKET=${PUBLIC_BUCKET},ASSET_BASE_URL=${ASSET_BASE_URL}" \
  --set-secrets "OPENAI_API_KEY=opensmash-openai-api-key:latest,TRIPO_API_KEY=opensmash-tripo-api-key:latest,FAL_KEY=opensmash-fal-key:latest,MINIMAX_ANNOUNCER_VOICE_ID=opensmash-minimax-voice-id:latest"

# Only the API may hand work to the worker (Cloud Run checks the API's
# identity token; the worker itself has no application-level auth).
gcloud run services add-iam-policy-binding "$WORKER_SERVICE" \
  --region "$REGION" \
  --member "serviceAccount:${API_IDENTITY}" \
  --role roles/run.invoker >/dev/null
WORKER_URL="$(gcloud run services describe "$WORKER_SERVICE" --region "$REGION" --format 'value(status.url)')"
if [[ -z "$WORKER_URL" ]]; then
  echo "Could not resolve the ${WORKER_SERVICE} URL." >&2
  exit 2
fi

# Fighter-creation killswitch. --set-env-vars replaces the whole environment,
# so a deploy would otherwise silently reopen a lab that was paused with
# `gcloud run services update`. Export CREATION_ENABLED=0 for this deploy to
# keep it closed.
gcloud run deploy "$SERVICE_NAME" \
  --image "$API_IMAGE" \
  --region "$REGION" \
  --service-account "$API_IDENTITY" \
  --allow-unauthenticated \
  --ingress internal-and-cloud-load-balancing \
  --port 8080 --cpu 2 --memory 2Gi --concurrency 500 --no-cpu-throttling --cpu-boost \
  --min-instances 3 --max-instances 6 --timeout 3600 \
  --set-env-vars "JOB_DATABASE=firestore,OBJECT_STORE=gcs,FIGHTER_JOBS_ROOT=/tmp/fighter-jobs,FIGHTER_EXECUTION_MODE=cloud-run-service,FIGHTER_WORKER_URL=${WORKER_URL},CLOUD_RUN_REGION=${REGION},CLOUD_RUN_WORKER_JOB=${WORKER_JOB},BAKED_ASSET_SOURCE=remote,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCS_PRIVATE_BUCKET=${PRIVATE_BUCKET},GCS_PUBLIC_BUCKET=${PUBLIC_BUCKET},ASSET_BASE_URL=${ASSET_BASE_URL},ALLOWED_ORIGINS=${PUBLIC_ORIGIN},FIREBASE_AUTH_ENABLED=1,FIREBASE_PROJECT_ID=${PROJECT_ID},FIREBASE_API_KEY=${FIREBASE_API_KEY},FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN},FIREBASE_APP_ID=${FIREBASE_APP_ID},FIREBASE_AUTH_PROVIDERS=google|apple|email,FIGHTER_MODERATION_ENABLED=1,CREATION_ENABLED=${CREATION_ENABLED:-1},TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY}" \
  --set-secrets "COOKIE_SECRET=${COOKIE_SECRET_NAME}:latest,COOKIE_SECRET_PREVIOUS=${COOKIE_SECRET_PREVIOUS_NAME}:latest,OPENAI_API_KEY=opensmash-openai-api-key:latest,TURNSTILE_SECRET_KEY=opensmash-turnstile-secret:latest${API_TURN_SECRETS}"

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  DOMAIN="$DOMAIN" "$SCRIPT_DIR/deploy-edge.sh"
else
  echo "Cloudflare credentials not provided; leaving existing DNS and Cache Rules unchanged."
fi

echo "Deployed ${SERVICE_NAME} and ${WORKER_SERVICE} at version ${VERSION}."
