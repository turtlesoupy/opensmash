# Native fitting in the main shell

Open **http://127.0.0.1:4174/melee**, or select Melee in the main shell.
Native fitting is the default; no query flag is required. Settings use the
ordinary `melee-launch-v1` store. An explicit `?moveset=link` remains available
for targeted validation; it is cleared when settings are changed.

## Pipeline

1. Character generation calls `bake_native_sources.py` after geometry and identity
   artwork exist. It writes `melee-source.json`, `.rgba8`, `.identity.dat`, and a
   completion receipt beside the character. This source-only step uses Python.
2. At selection, the browser worker fits source geometry to the selected rig in
   C++/WASM and assembles the host-skin costume in JS. Stature and attachment rules
   match the existing converter. Nothing fitted is persisted.
3. Older characters without a current source package use the same preparation
   function lazily. Preparation is limited to two concurrent jobs, duplicate
   requests share work, and each request has a 60-second deadline. Workers have
   a 30-second timeout and terminate when the player leaves preparation.

The package contains generated character data only, with no chosen moveset or
Nintendo assets. Private generation checkpoints and owner-authorized source
exports carry it; exports without the optional package remain compatible.
Native imports retain source assets and skip the old per-moveset Python build.
Content checks rebuild stale source inputs. There is no fitted-result cache.

Reusable target templates are derived once from the locally supplied game by
`prepare_native_fit_local.py`. They cover all 27 rigs and 127 costume slots,
including Nana. They stay in ignored build output and must not go into GitHub.

## Start or rebuild

From the `pipeline` repository root:

```sh
python3 engines/melee/tools/build_native_fit.py \
  --emsdk /absolute/path/to/emsdk --native
python3 engines/melee/tools/prepare_native_fit_local.py
python3 engines/melee/tools/serve_melee.py --upstream \
  --import-origin http://127.0.0.1:4174 --iso /absolute/path/to/Melee.iso
```

The existing Melee PC browser runtime and extracted game files are prerequisites.
In another terminal:

```sh
cd web-prototype
MELEE_LOCAL_ORIGIN=http://127.0.0.1:8781 FIGHTER_WORKER_DISABLED=1 VITE_HMR=0 npm run dev
```

Bake a source, or run a sequential, resumable bulk bake:

```sh
python3 engines/melee/tools/bake_native_sources.py play/ui/barackobama
python3 engines/melee/tools/bake_native_sources.py --all
```

The bulk command continues past individual invalid sources and exits nonzero if
any failed. It never fits every character/moveset combination. A production
backfill has not been run or deployed as part of this local work.

## Validation

- 81 reference comparisons: Obama, Rob Zombie and Gandhi across all 27 rigs.
  Geometry, normals, envelopes and round-body clearance match the Python oracle
  within the checked numerical tolerances.
- 127 actual browser-worker costumes for Obama: exact stored float32 native
  geometry/envelopes, required exports, stature, retained attachments, Bowser/Yoshi
  forms, and the engine's 2 MiB slot limit checked independently in Python.
- Seven mixed four-player matches through the main shell cover all selectable
  movesets and companion preparation. Each passed 1,100 engine frames, with no
  legacy `/api/prepare/` calls or unexpected page errors. Screenshots/logs live in
  `build/native-fit/gameplay-parity`. This is smoke coverage, not exhaustive
  animation testing of all characters, attacks and costume combinations.
- Native AddressSanitizer/UndefinedBehaviorSanitizer checks; source-build reuse,
  concurrency/invalidation/timeout tests; source import/export tests; presentation,
  form, launcher and generation-job regressions.

Reproduce the asset checks:

```sh
python3 engines/melee/tools/validate_native_parity.py \
  --source play/ui/barackobama --source play/ui/robzombie --source play/ui/mahatmagandhi
PLAYWRIGHT_MODULE=/path/to/playwright \
  node engines/melee/tools/validate_native_roster_browser.mjs
python3 engines/melee/tools/check_native_roster.py
PLAYWRIGHT_MODULE=/path/to/playwright \
  node engines/melee/tools/validate_native_gameplay.mjs /absolute/path/to/Melee.iso
```

The native fitting change does not address renderer pipeline compilation or
engine startup. Frame drops remain a separate engine issue; fitting benchmarks
must not be presented as click-to-play or frame-pacing measurements.

## Hosted release preparation (no deployment)

Build the pinned engine and fitter with `tools/build_upstream.py`. Derive all
reusable target templates with `tools/prepare_native_fit_local.py` from the
verified local game. Publish the new input bundle before deploying the website:

```sh
python3 engines/melee/tools/publish_web_inputs.py \
  --workspace engines/melee --characters play/ui \
  --iso /absolute/path/to/Melee.iso --bucket EXISTING_PRIVATE_BUCKET
```

For a dry run, replace `--bucket` with `--local-store /path/to/local/store`.
The bundle contains only the Melee PC game runtime, its audio consumer, the
native fitter, and derived target assets. Old moderngekko runtime artifacts are
not required. Generated game assets remain outside Git. Existing baked source
packages are included when present; missing packages fill lazily.

Set `MELEE_INPUT_MANIFEST` to the returned manifest when releasing. The service
rejects old manifests without native fitting assets rather than shipping a
broken default. Publishing and deployment are separate actions.

Source packages are served through owner-authorized `/api/native-fit` routes,
with `no-store` browser responses and the existing private source store for
cross-instance retrieval. Static fitter/target files use versioned engine URLs.
No character-by-moveset fitted output is cached. Python remains necessary for
source baking, desktop conversion, and the numerical reference tests.
