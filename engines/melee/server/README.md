# Melee in the website deployment

Melee runs in the **existing website container**, alongside Node as a loopback-only
Python child. It starts lazily on the first Melee asset/preparation request. The
existing website API owns authentication, routes and guest identities. No new
Cloud Run service, service account, queue or mounted volume is needed.

Browser characters use native WASM fitting. Moveset-independent source packages
are baked during generation or prepared lazily on first use; fitted browser
costumes are not persisted. Source packages, character-select assets and owner
grants use the existing private object store across API instances.

Versioned `/melee/api/native-fit/assets/<hash>/sources/*` URLs are bearer links:
anyone holding the exact URL can download the asset, including private characters.
Successful responses are public and immutable for one year in browsers and the CDN;
changing visibility does not revoke already issued links. Preparing a private
character and obtaining its source URL still requires owner access. Preparation,
errors, and other private API responses remain uncached. `deploy-edge.sh` installs
the source-asset cache rule; the backing bucket remains private.

## Normal website deployment prepares inputs automatically

`web-prototype/infra/deploy.sh` calls `tools/prepare_web_release.py` before image
rollout. It fingerprints the pinned engine, fitter and template-generation code,
roster catalog and source assets. A matching private release is reused without
building or publishing. Otherwise it builds the pinned engine and fitter, derives
target templates, publishes content-addressed inputs and pins the returned
manifest for this deploy. It never invokes a bulk character bake.

Install the engine requirements and `google-cloud-storage` in the deployment
Python environment. Optional deployment environment variables:

- `MELEE_BUILD_PYTHON`: Python with those dependencies (default `python3`).
- `MELEE_WORKSPACE`: verified extracted game workspace (default `engines/melee`).
- `MELEE_ISO`: original disc to verify that workspace when no receipt exists.
- `MELEE_CHARACTER_ROOT`: roster sources (default `play/ui`).
- `MELEE_PC_ROOT`: pinned engine checkout; `MELEE_BUILD_JOBS` defaults to 6.

A changed release needs the verified game inputs and engine build toolchain.
Missing inputs or a failed build stop deployment before image rollout. An optional
`MELEE_INPUT_MANIFEST` is only a reuse candidate: it cannot override a mismatched
fingerprint. Old manifests without fingerprints are rebuilt once. This also
means ordinary frontend-only deploys reuse the previous matching input release.

The lower-level `publish_web_inputs.py` remains available for manual bundles and
local smoke tests; it does not itself rebuild stale generated artifacts. To test
the automated release path without remote writes:

```sh
python3 engines/melee/tools/prepare_web_release.py \
  --workspace /path/to/verified-melee-workspace \
  --characters /path/to/play/ui --local-store /path/to/local/objects
```

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
