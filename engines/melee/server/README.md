# Melee in the website deployment

Melee runs in the **existing website container**, alongside Node as a loopback-only
Python child. It starts lazily on the first Melee asset/preparation request. The
existing website API owns authentication, routes and guest identities. No new
Cloud Run service, service account, queue or mounted volume is needed.

A costume is converted on demand, then stored in the existing **private** object
bucket. Other web instances reuse it. Their local `/tmp` workspace is disposable.
Character-select assets are also cached; imported source art, job results and
owner grants survive instance changes. Inputs and converter source hashes version
the conversion cache, so updates do not serve stale costumes. Existing per-fighter
locks and conversion behavior are retained; there is no new scheduling layer.

Versioned `/melee/api/native-fit/assets/<hash>/sources/*` URLs are bearer links:
anyone holding the exact URL can download the asset, including private characters.
Successful responses are public and immutable for one year in browsers and the CDN;
changing visibility does not revoke already issued links. Preparing a private
character and obtaining its source URL still requires owner access. Preparation,
errors, and other private API responses remain uncached. `deploy-edge.sh` installs
the source-asset cache rule; the backing bucket remains private.

## Publish inputs once, then use the normal website deploy

Use the verified conversion workspace, matching WASM build, and original character
library already used locally. Install the engine requirements and
`google-cloud-storage` in the publishing Python environment. From the repository root:

```sh
python3 engines/melee/tools/publish_web_inputs.py \
  --workspace /path/to/verified-melee-workspace \
  --browser /path/to/moderngekko-wasm \
  --characters /path/to/play/ui \
  --bucket YOUR_EXISTING_PRIVATE_BUCKET
```

The last line is the immutable `melee/inputs/<sha256>.json` object key. Export it as
`MELEE_INPUT_MANIFEST` when running the ordinary `web-prototype/infra/deploy.sh`.
That script enables `MELEE_EMBEDDED=1`, preserves the pinned manifest on subsequent
deploys, and uses the website's existing bucket permissions and cookie secret.
Without a pinned input release Melee stays unconfigured; the rest of the site
still deploys as before. The Docker build includes Python and converter code.

Publishing copies input files, **not prebuilt conversions**. Original character
sources are fetched one fighter at a time on first use. The boot inputs contain
the browser runtime plus a verified subset of private conversion templates; no
full ISO, original disc executable, stages or match audio is published by this command.
Template files remain private and are unavailable through the HTTP API. Existing
input object keys are content-addressed and can be reused across website deploys.

The gateway allows only runtime assets, character preparation/imports, and their
outputs. It strips website credentials before forwarding and derives an internal
token from `COOKIE_SECRET`. Disc setup, raw game files, debug and native-process
routes remain inaccessible. User ISO/GCM files stay in the browser.

## Local checks

`publish_web_inputs.py --local-store /path/to/objects` uses a local directory with
the same storage protocol, without contacting cloud services. Point
`MELEE_OBJECT_ROOT` there, set `MELEE_INPUT_MANIFEST` to the published object key,
and use `MELEE_EMBEDDED=1` with a local-only `COOKIE_SECRET`. `MELEE_WORKSPACE` can
select an isolated disposable workspace. Leave `MELEE_LOCAL_ORIGIN` and
`MELEE_SERVICE_ORIGIN` unset in embedded mode.

`tools/smoke_embedded.mjs` starts two independent website gateways/converter
processes against a local fixture. It checks a real costume conversion, asset
fetches, character-select output, second-instance cache reuse, and forbidden raw
game routes. The fixture directory contains `objects/` and `manifest-key.txt`.
Unit tests additionally cover gateway startup/restart,
empty prepare POSTs, owner isolation, archive traversal rejection, and cache
invalidation.

The older `serve_hosted.py` / `MELEE_SERVICE_ORIGIN` configuration remains available
for compatibility. It is not used by the integrated website deployment. Desktop
and local `MELEE_LOCAL_ORIGIN` launch paths are unchanged.

## Validation for this integration

The production website Docker image builds successfully. The two-instance smoke
also passes inside that image as a non-root user with a cold local object-store
fixture: Donald Trump/Falco conversion took approximately 2.3 seconds; the next
instance returned its cached preparation metadata in 5 ms and fetched the costume
and character-select binaries. These are local-container timings, not cloud
benchmarks. The website suite has 290 passing tests; six Python cache/access tests
cover persistence and isolation. Live GCS publication/deployment is a release step,
not performed by the smoke test.
