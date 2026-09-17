# Native character fitting

This module fits decoded custom source geometry against reusable Melee rig data.
It does not use Python, SciPy, previously solved profiles, pre-fitted character
vertices, or cached hand offsets. Python prepares moveset-independent source assets at build time (or lazy fill)
and serves as the offline reference oracle. It does not fit selected movesets.
This is the default browser character path in the shared smash.fun shell.
See [setup and hosted packaging](LOCAL_TEST.md). Desktop conversion and the
offline reference oracle still use the Python converter.

Implemented and measured:

- `fit_humanoid`: ordinary anatomical fitting, source head-proportion solve,
  terminal hand/foot refinement, vertex/normal conformation, envelope merging.
  Validated across all 25 non-round rigs, including Mario’s distinct body scale
  and the roster’s collapsed-joint and second head-refinement rules. The ordinary algorithm receives
  source-only smoothed normals; smoothing is not measured as native fitting.
- `fit_round`: round-body construction, head and hand convex hulls, pose-space
  sample construction, both bounded hand solves, final mesh/normals/envelopes.
  Validated for Kirby and Jigglypuff. This path does not need the old humanoid
  profile solve before round-body fitting; it uses five semantic target joints.
- `native-fit.mjs`: validated array/length boundary, allocation, dispatch, result
  copy, and deterministic release of native allocations. Intended for a worker.

`fit_round` has the reference's 100-iteration limit per Powell start plus a
30,000-objective-evaluation cap per hand. Degenerate hulls, singular rigs, and
budget exhaustion return an error; they do not silently substitute a lower-
quality fit. The browser validation harness also terminates a worker after a
30-second timeout. The main shell terminates its fitting worker on cancellation.

## Why it is faster

The head hull and posed hand samples are built once per fit. During optimization,
the current supporting plane is tried first. If any plane already certifies the
sample has at least the 0.18 clearance used by the objective, its penalty is zero
and remaining planes need not be evaluated. Otherwise the maximum is computed.
This early exit is exact for the penalty, not an approximation or a reduction in
pose coverage. Final minimum clearance is evaluated without that early exit.

The optimizer retains two initial guesses, the same bounds, tolerances and
objective, with a native bounded Brent/Powell implementation. Its attribution is
in `SCIPY-LICENSE.txt`, which the build tool includes with the output.

## Input boundary

Both modes take decoded source positions, normals, four source influences per
vertex, and source rig metadata. These source assets can be prepared once without
choosing a Melee moveset. They are not final per-target fits.

Round mode also takes source semantic flags/origins, five target-joint indices,
target inverse binds and sampled target pose matrices. The source semantic flags
are documented above `fit_round`; pose data is reusable per target and contains
no custom character. The benchmark derives this data locally from the existing
verified assets/calibrations. No game-derived data is committed with this module.

Humanoid mode takes a source semantic slot per rig joint, the 39 slot origins in
the `Bone` enum order, and target anchors/anatomical mapping indexed by the
existing Mario anatomical indices. This is rig metadata, not a solved character
profile. A local worker adapter assembles the existing host-skin costume format;
source GLB decoding is a shared build/lazy-fill step.
All 27 rigs and 127 costume slots have reference/assembly coverage, and all
selectable movesets have main-shell gameplay smoke coverage. See LOCAL_TEST.md
for the exact validation limits.

## Build and validate

From the OpenSmash repository root:

```sh
python3 engines/melee/tools/build_native_fit.py --emsdk /absolute/path/to/emsdk --native

python3 engines/melee/tools/validate_native_round.py \
  --library engines/melee/build/native-fit/fit.dylib \
  --source play/ui/abrahamlincoln --source play/ui/alanturing \
  --source play/ui/robzombie --source play/ui/50cent \
  --source play/ui/donaldtrump --source play/ui/mahatmagandhi

PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
  node engines/melee/tools/benchmark_native_fit_browser.mjs engines/melee/build/native-fit

clang++ -std=c++17 -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer \
  engines/melee/runtime/fitting/round_fit.cpp engines/melee/runtime/fitting/humanoid_fit.cpp \
  engines/melee/tests/native_fit_sanitizer.cpp -o engines/melee/build/native-fit/sanitizer
engines/melee/build/native-fit/sanitizer
```

Linux uses `fit.so` instead of `fit.dylib`. Native host tests require the existing
converter's Python dependencies. Browser execution requires only the compiled
WASM, JS wrapper, and local fixture data—no Python runtime or converter service.
Fixture data stays under ignored `build/native-fit/fixtures`.

## Validation limits

The test oracle checks native body output with the native offsets against the
Python geometry implementation, separately checks offsets/clearance against the
original SciPy solve, then checks WASM output against the validated host output.
All eighteen cases use six distinct source characters and three targets.

Native input origins are doubles. NumPy's original float32 source-bind arrays
round some collar thresholds early. Tests check both precision-normalized parity
and bounded error against the original path; tolerances are not bitwise equality
across that representation change. Joint mappings and stored weights are checked
explicitly. Browser and native-host outputs matched exactly in the recorded run.

This establishes fitting correctness/performance for the tested assets. It is
not visual gameplay validation, a mobile benchmark, a GLB decoder, a DAT writer,
or full-roster launcher acceptance. Disc verification, downloads, shader
compilation and GPU upload are separate from these fitting measurements.
