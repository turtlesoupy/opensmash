# Independent WASM performance pass

Prepared September 13, 2026. Start with reproduction, not another optimization.
The pass that followed this handoff, its diagnosis and the retained region
chaining change are in [WASM_REGION_CHAINING.md](WASM_REGION_CHAINING.md).
The target is sustained real emulation and presentation at 60 FPS with correct
gameplay and audio, including custom and vanilla fighters. Do not change the ISO,
skip emulated work, loosen the gates, or discard failing startup windows.

## Checkout and cleanup state

Repository: `/Users/tdimson/projects/opensmash-melee`, branch `main`.
HEAD: `b85c95e` (the previous 126-region optimization commit). Follow-up runtime,
validation and documentation changes are **uncommitted** in this working tree.
Do not reset the tree to HEAD: that would also remove successful subsequent work.
The `.gitignore` addition `/.claude/` belongs to the user and must be preserved.

The retained runtime is `f60b3f3bbd856e7f`, WASM SHA-256:
`f60b3f3bbd856e7fbbb4ac102823df00918af567fbd2561f92c54543ee55c3db`.
Normal output: `build/moderngekko-wasm/`. Frozen control:
`build/wasm-robust/fifo-fast-runtime/`. The source patches reverse-check against
`build/browser-engine/moderngekko-web/vendor/dolphin`; the normal binary hash
matches the control. The build has 512 specialized integer regions and CPU-loop
re-entry, GPU canvas transfer, sparse idle payload polling, FIFO cache-line
separation and static FIFO writes with limited LTO. These last optimizations have
package-level evidence, not clean isolated attribution for every component.

Failed experiments are absent from the build: floating-point PC deferral,
extra GPU payload batches, immediate empty-queue sleeping, load-before-CAS idle
guard, redundant watermark-store suppression, longer preparation gating, and
whole GPU polling-loop re-entry. In particular, there is no `0005` patch, no
`RunBatch` implementation in BlockingLoop, and no extra GPU batch export.
Their reports remain under `build/wasm-robust/`; historical mentions are evidence,
not active switches. CPU-loop re-entry is intentionally retained: it had a direct
same-game-code comparison showing improvement.

The current shader seed contains 833 portable pipeline descriptions, SHA-256
`12c3e2c5ad35b6cf7970bef842b63c72b2b21984b59a3320d435f90ce1fdad1b`.
Older measurements used 96 descriptions. Worker JS and shader seed are served
live even when the WASM binary comes from a snapshot; a binary ID alone does not
identify the entire experiment. Keep these assets constant for comparisons.

## What is actually known

Machine: Apple M5, Mac17,2, 32 GB, macOS, headed Google Chrome 152. No special V8
flags. Each value below is a consecutive approximately 30-second window.

| Test on retained f60 runtime | FPS | Evidence under build/wasm-robust |
| --- | --- | --- |
| Four-player default injected lineup, Battlefield, older 96 seed | 59.90, 59.93, 59.97; all gates passed | fifo-fast-injected |
| Full 26-stock-fighter sweep, older 96 seed | Five of seven matchups passed | fifo-matrix/summary.json |
| Ice Climbers/Peach/Samus/Puff, Dream Land, 833 seed | 59.83, 59.42, 59.86; all passed | roster-warm-climbers |
| Heavy stock lineup, Fountain, 833 seed, earlier repeat | 58.80, 59.63, 59.32, 59.94, 57.57, 58.84; four passed | final-fountain |
| Same Fountain configuration after user resource cleanup | 42.00, 46.36, 47.84, 48.73, 50.61, 46.29; none passed | quiet-fountain |

All these runs had clean audio and completed replay. The latest custom matchup
has **not** been rerun after the unexplained slowdown. Do not infer a custom
regression from the Fountain results. The f60 WASM bytes served over HTTP were
verified during investigation. After user cleanup, memory pressure and thermal
state were normal and other previously busy apps were gone, but FPS stayed low.
The cause is unresolved; background contention alone is not an established answer.

An additional whole-GPU-loop re-entry candidate measured 44–53 FPS, failing all
six windows despite correct wakeup tests. It was removed and f60 restored.
Detailed chronology: [WASM_RUNLOOP_TIERING.md](WASM_RUNLOOP_TIERING.md).
Machine-readable aggregate: `build/wasm-robust/summary.json`.

## Reproduce the baseline first

All commands run from the repository root. These paths already exist on this
machine. Use a new output directory for each run and keep every result.

```sh
export NODE_PATH=/tmp/opensmash-browser-validation/node_modules
export MELEE_ISO='/Users/tdimson/Downloads/Super Smash Bros. Melee (USA) (En,Ja) (v1.02).iso'
export MELEE_TEST_URL='http://127.0.0.1:8787/?benchmark=1'
unset MELEE_TRACE MELEE_STOCK_CHARACTERS MELEE_KEEP_BROWSER_PROFILE
```

The retained normal-build server was left running on port 8787. Port 8788 serves
the frozen f60 control. Check before starting duplicate servers. If 8787 needs
restarting, use a separate terminal:

```sh
OPENSMASH_WEB_DIST=build/wasm-next/web-dist \
  python3 tools/serve_melee.py --port 8787
```

This uses the existing frozen frontend and current runtime assets. Standard
frontend setup/rebuild instructions are in `docs/LOCAL_RUNTIME.md`. If frontend
changes are needed, rebuild the frontend deliberately and record its identity;
do not unknowingly compare stale distribution files with changed source.

First repeat the exact successful injected configuration (the harness calls it
`default`; this is a mixed injected/stock lineup, not four identical customs):

```sh
MELEE_LINEUP=default MELEE_STAGE=31 MELEE_WINDOWS=3 \
MELEE_STRICT_WINDOWS=1 MELEE_REPLAY=1 \
node tools/validate_local_disc.cjs "$MELEE_ISO" build/independent-custom-bf-01 4
```

Then the original vanilla Battlefield case and difficult Fountain case, serially:

```sh
MELEE_LINEUP=all-stock MELEE_STOCK_CHARACTERS=8,2,0,6 MELEE_STAGE=31 \
MELEE_WINDOWS=3 MELEE_STRICT_WINDOWS=1 MELEE_REPLAY=1 \
node tools/validate_local_disc.cjs "$MELEE_ISO" build/independent-stock-bf-01 4

MELEE_LINEUP=all-stock MELEE_STOCK_CHARACTERS=5,1,4,13 MELEE_STAGE=2 \
MELEE_WINDOWS=6 MELEE_STRICT_WINDOWS=1 MELEE_REPLAY=1 \
node tools/validate_local_disc.cjs "$MELEE_ISO" build/independent-heavy-fountain-01 4
```

To separate stage cost from fighter cost, repeat **the same** `5,1,4,13` lineup
on stage 31 (Battlefield), and repeat the default injected lineup on stage 2
(Fountain). For an injection-only comparison, inspect the effective launch data
and use matching underlying vanilla movesets; arbitrary different fighter IDs
are not a controlled injection comparison. IDs come from
`runtime/launch-options.json`; do not guess them from the matchup names.

Repeat A/B/A in fresh browser profiles before attributing an improvement to code.
The harness uses a new isolated Chrome profile for each invocation and removes
it afterward; it saves the pipeline cache before closing. Match randomness is
not fixed, so workloads are not bit-identical between runs. Compare multiple
windows and repeat configurations rather than declaring a winner from one run.
Keep the seed fixed. A fresh profile measures seeded startup, not an existing
user's accumulated cache or an explicitly precompiled browser code cache.

Run only one performance test at a time. Finish compilation, hashing, trace
analysis and asset conversion before measuring. Keep Chrome visible and focused;
record AC/low-power state, pressure and background CPU load. Do not kill the
user's unrelated applications. Do not run repeated ISO hashing or heavy system
inspection during timing. Small routine observation is sufficient.

## Acceptance and evidence

`MELEE_STRICT_WINDOWS=1` requires **every requested window** to satisfy:

- FPS >= 58.5 (the existing tolerance for nominal 60 Hz).
- p95 <= 20 ms and p99 <= 33.34 ms.
- Zero audio-underrun samples.
- Rendered audio samples >= durationMs * 48 * 0.95.

Also require no runtime errors, successful replay, and normal unprofiled mode
(`profile: "0"`). The harness verifies the ISO stays local and all-stock tests
do not call injected-asset preparation endpoints. It records `events.json`
(session/build and performance windows), `run.json`, `samples.json` (visibility,
focus and audio state), `errors.json`, `network.json`, screenshots and UID cache.
A failed FPS gate returns exit 1 even if the game and replay worked. Empty
`errors.json` alone does not mean the performance test passed.

These counters are measured game/presentation events, not merely the screen's
refresh rate. They still do not prove every image differs or every game behavior
is correct. Inspect combat/replay screenshots and actual gameplay for freezes,
rendering regressions or animation errors; add explicit distinct-image checks if
needed. A seven-matchup sweep covers all fighters but not every fighter/stage
combination or long-session behavior.

After baseline reproduction and any successful targeted change, run the broad
stock sweep and the injected test again:

```sh
python3 tools/validate_wasm_roster.py "$MELEE_ISO" \
  --output build/independent-roster-01 --windows 3
```

The sweep is serial, output must be new, and any failed/incomplete case fails the
command. It takes roughly 15–20 minutes including setup. Use six-window targeted
repeats for sustained behavior; do not hide late degradation behind averages.

## Profile only after finding a reproducible slow case

```sh
MELEE_TEST_URL='http://127.0.0.1:8787/?benchmark=1&profile=phases' \
MELEE_TRACE=1 MELEE_LINEUP=all-stock MELEE_STOCK_CHARACTERS=5,1,4,13 \
MELEE_STAGE=2 node tools/validate_local_disc.cjs "$MELEE_ISO" \
  build/independent-fountain-profile-01 4
```

Tracing saves `trace.json`, `phases.csv` and the symbol map after one window.
Profile mode exits before the normal FPS/replay acceptance path; success here
means collection succeeded, **not** 60 FPS. Profiling perturbs runtime.
If serving a different snapshot, set `MELEE_BROWSER_BUILD` for both server and
harness so symbols match. Partial final CSV rows must be discarded when parsing.

Existing `quiet-profile/` shows similar guest work to an earlier faster profile:
about 5.14 million cycles, 267k dispatches and 71k primitives/frame, with no newly
created vertex/pixel shaders in the sampled tail. GPU root-frame self time is
not automatically useful graphics work: polling and waiting can be included.
For Binaryen call graphs, defined-function ordinals exclude imported functions;
symbol-map indices include them (382 imports in the last candidate). Resolve
indices before asserting a function boundary survived optimization.

## Build and correctness checks

```sh
python3 tools/build_recomp_browser.py
python3 tests/test_browser_entries.py
node --test tests/shader_warmup.test.mjs
python3 -m unittest tests.test_browser_fps_report
python3 tools/validate_browser_gpu_wakeup.py
node --check tools/validate_local_disc.cjs
git diff --check
```

Build first, then benchmark. Never leave candidate source paired with a restored
control binary without documenting the mismatch. Patches are applied to the
prepared engine by the build script; avoid overlapping patches. If removing a
patch, reverse it in prepared source too, or regenerate a clean prepared tree.

The expanded generated-game oracle previously passed 1,835,008 cases:
`build/wasm-robust/integer-expanded-correctness.json`. Archive SHA-256:
`3795dda14b5e571f2c24836f91a17d326034542c00817d361d58bfa9c1c4d23b`.
If generated entries or their helpers change, rebuild and rerun:

```sh
python3 tools/validate_browser_entries.py --skip-build
```

It compares guest CPU state, test memory and callbacks across entry PCs and 14
scenarios, including unusual FPSCR and disabled FP state. It does not validate
GPU scheduling, rendering or all possible guest states. The separate GPU test
checks 200,000 wakeups plus 20 timed polls and shutdown using real BlockingLoop.
Keep the fixed self-branch PC-store bug fix: only remove a store at the beginning
of a generated entry body, never a matching nested branch-exit store.

Do not commit or push new experiments as proven wins. Preserve the baseline and
evidence, remove failed implementations, and explain remaining uncertainty.
