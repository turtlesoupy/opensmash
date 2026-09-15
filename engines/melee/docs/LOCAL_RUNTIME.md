# Local Melee runtime

The playable port lives in `web/` and uses a pinned MeleePad/ModernGekko runtime,
with Emscripten adaptations recorded in `runtime/patches/browser/`. The older
`browser-port/` skinning lab is a separate validation tool, not the game engine.
No hosting or deployment is needed.

## Run

From this project:

```sh
python3 tools/prepare_moderngekko.py --help
python3 tools/build_recomp_browser.py
python3 tools/serve_melee.py --iso "$MELEE_ISO"
npm install --prefix web
npm run dev --prefix web
```

Open http://127.0.0.1:5174 and select your USA 1.02 ISO in the browser. The browser
verifies its SHA-256, parses its file table, and reads game files directly from
the selected file through WORKERFS. The ISO is never uploaded. Only requested
file slices enter the runtime; the whole disc is not copied into Wasm memory.
Writable costume/menu slots overlay the read-only disc, preserving the original.
Select the ISO again after a page refresh. Returning to the roster and replaying
reuses the same verified File object without hashing the full disc again.

The asset service is still required for custom-costume conversion, menu artwork,
announcer clips and character imports. Its extracted game inputs are prepared by
the command above; selecting a browser ISO does not populate the server's files.
This is a local-disc browser trial, not a server-free static distribution.
`?disc=server` retains the previous extracted-file transport for comparisons.
Desktop disc setup continues to use its existing local installation flow.

Game files and generated costumes stay local and ignored by Git. Character selection converts the selected
OpenSmash source mesh into the assigned Melee costume, then boots the actual game.
One engine preboots while the roster is visible; measured warmed clicks reach
the match in about 1.4–2.4 seconds. See [STARTUP.md](STARTUP.md) for cold-launch
timings, the measurement boundary, and the verification loop.
For ROM-first Apple Silicon app builds, see [NATIVE.md](NATIVE.md).

## Browser changes

- Static PPC recompilation, with 256-instruction compilation regions to avoid
  pathological Wasm compiler time on large irreducible control-flow graphs.
- Hot-region entry specialization and deferred guest-PC stores, with original
  entry functions retained as correctness-tested fallbacks.
- Region chaining: cross-region calls, returns and branches continue directly
  into the target region under the run loop's own dispatch conditions instead
  of returning to C++ for every transfer.
- Guest memory access tests MEM1 before the (absent) Wii EXRAM range.
- WebGL 2 renderer with a separate capability-probe canvas; the real canvas moves
  directly to the CPU/GPU worker. Explicit ImageBitmap presentation lets the game
  retain its synchronous loop without blocking the browser UI.
- WebGL-compatible staging readbacks and live-size streaming uploads. Uploading
  into the desktop 48/64 MB stores caused approximately 700 ms GPU stalls on M5;
  using only live upload bytes reduced the measured commit to about 0.2 ms.
- Browser keyboard/gamepad input, verified-disc filesystem, bounded resource fetch
  concurrency, and runtime errors reported to the UI.
- Shared five-mode routing: immediate Free-for-All, VS Menu, VS character select,
  Classic character select and Full Boot. Four-port lineup, stage, rules and
  costume-color allocation are available under Launch settings.
- WebGL depth ranges, depth comparisons and regional clears use a consistent
  convention; VS/Classic menus and stage scenes are checked visually.

## Validation status

The browser runs actual Battlefield combat with custom characters, damage,
stocks, respawns, items and sound. The September 12 hot-entry build passed the
stock two-player and injected four-player 60 FPS/frame-time/audio gates on the
Apple M5, with replay checked.
All-stock four-player combat remains below target at roughly 54–56 FPS. See the
hot-entry measurements below for current build identities and lineup results.
An earlier skinning build passed all six movesets; [PERFORMANCE.md](PERFORMANCE.md)
records those historical per-character windows and effect-related dips. Neither
result certifies every mode, stage, roster combination or mobile device.

Browser keyboard taps and persisted save reuse were verified. The roster launch
unlocks fighters in the local virtual game so Luigi and Marth are available on a
fresh save. All-roster gameplay and remaining OpenSmash feature parity gates are
open. Native performance is separate and is not certified by the browser result.

Evidence is local in `build/moderngekko-validation/`. `browser-trace.jsonl`
contains startup failures and successive development runs as well as 30-second
frame summaries; do not treat it as one clean benchmark. The worker reports mean
FPS, p95/p99 frame intervals, frames over 33.34 ms, and the engine phase CSV.

## Combat performance loop (September 9)

The baseline optimized browser combat run averaged 33.53 FPS. Exact matrix
specialization, hot-function LTO and FIFO upload improvements brought repeated
combat windows to roughly 41–43 FPS. This still fails the 60 FPS gate.

`tools/report_browser_fps.py` groups 30-second combat windows by the actual Wasm
SHA-256 and character. In CPU-versus-CPU benchmark mode, three consecutive windows must each average at least 58.5 FPS,
with p95 <= 20 ms, p99 <= 33.34 ms and no audio underruns. Windows containing profiling work cannot pass. The skin oracle finishes after
draw 1200; a fresh measurement window starts only after its final comparison.
Audio must actually render at least 95% of the expected 48 kHz samples. Startup/menu frames are excluded. The live FPS display turns amber below
the target. Original geometry and skin weights have not been quantized.

The browser now defaults to the one-draw skinning layout. It keeps exact source
weights and fitted proportions. Developer-only `?profile=skin` compares every
envelope against the game's PPC matrix routines on several live poses. The
original GX layout remains available with `?skin=gx`.
Add `&benchmark=1` for a 20-stock CPU-versus-CPU stress match. Normal play uses
a human first player and four stocks. Do not benchmark during compiler builds.

Arithmetic regression commands:

```sh
python3 tools/validate_browser_math.py --wasm
python3 tools/validate_browser_math.py --wasm --scaled
python3 tools/validate_browser_fma.py
python3 tools/report_browser_fps.py
```

The concatenation oracle compares full CPU state and RAM across 12,000 cases;
the FMA oracle compares full CPU state across 960,000 cases against pinned,
unmodified runtime source. Reports stay in `build/moderngekko-validation/`.

## Local-disc validation and runtime delivery

The headed Chrome check uses a fresh profile, rejects `/api/setup` and `/api/game`
requests, and requires three consecutive passing 30-second combat windows, allowing up to
250 seconds for warm-up. It explicitly activates audio and records AudioContext state. It retains frame-time,
audio, network and screenshot evidence, including failed windows:

```sh
NODE_PATH=/path/to/playwright/node_modules node tools/validate_local_disc.cjs "$MELEE_ISO" build/local-disc-validation/two-player 2
NODE_PATH=/path/to/playwright/node_modules node tools/validate_local_disc.cjs "$MELEE_ISO" build/local-disc-validation/four-player 4
```

Set `MELEE_CHECK_INVALID=1` to test a truncated disc and a full-size corrupted
image before recovering with the valid ISO. `MELEE_REPLAY=1` also checks replay
without a repeated full-disc hash. `MELEE_LINEUP=default` uses Turing, stock Fox, Lincoln and Obama.
`MELEE_LINEUP=custom` uses Turing, Trump,
Lincoln and Obama instead of the mixed Turing/Fox/Link/Peach four-player case.
`MELEE_TEST_URL` selects another local server. For attribution only,
`MELEE_TRACE=1` with a URL containing `?benchmark=1&profile=phases` records a CPU
trace and phase counters; profiled runs cannot certify frame rate. Without
`profile=phases`, `MELEE_TRACE=1` records a V8 CPU profile of the normal build
from launch onward, kept even when the run fails. `MELEE_CHROME_ARGS` passes
diagnostic Chrome flags (for example `--js-flags=--no-liftoff`); such runs are
not acceptance evidence. `MELEE_BROWSER_PROFILE=<dir>` reuses a Chrome profile
across runs to measure a returning visitor with Chrome's WebAssembly code
cache; the default fresh profile measures a first visit.

The browser build produces gzip sidecars at build time. The local server serves
those to supporting clients with the original MIME type. Runtime URLs carry a
cache identity covering the Wasm and JavaScript files; matching versions are
immutable, while the build manifest remains uncached. Stale version requests
fail rather than mixing a new binary with old glue. The September 12 baseline
Wasm is 118,615,393 bytes uncompressed and 17,963,498 bytes over gzip (17.1 MiB).
Range reads retain the original uncompressed byte offsets.

The browser now follows native's compact texture policy when a match contains
three or more custom costumes. Preparation and download both select
`browser-compact` assets (256-pixel textures); source mesh geometry and weights
are retained. This prevents the guest heap allocation failure in the tested
Turing/Fox/Lincoln/Obama lineup.

### Performance measurements

The failed larger-region, expanded-LTO, SIMD128, and manual GPR-cache experiments
have been removed from the build tools and active candidate outputs. The CPU/GPU threading prototype
was also removed after its earlier benefit failed to reproduce. The normal
build retains 256-instruction regions and the proven exact math specializations.
Historical measurements below record rejected configurations, not available flags.

For a fixed-length comparison, `MELEE_WINDOWS=4` collects four 30-second combat
windows and still fails if the final three do not meet the existing gate.



September 12 controlled-lineup measurements on the Apple M5 in headed Chrome:

| Runtime | All-stock fighters | Three injected costumes + Fox |
| --- | --- | --- |
| Scalar, single CPU/GPU thread | 37.4–38.8 FPS | 44.2–47.1 FPS |
| Scalar, bounded CPU/GPU threads | 39.5–43.7 FPS | 47.3–51.3 FPS (two runs) |
| SIMD128, bounded CPU/GPU threads | 40.9–41.9 FPS | 45.1–47.9 FPS |
| SIMD128, single CPU/GPU thread | Not measured | 44.0–46.4 FPS |

Each run contains four approximately 30-second combat windows with audio and no
recorded underruns. All fail the 60 FPS/frame-time gate. CPU-controlled matches
vary; these results suggest a modest threading benefit, not a deterministic
speedup certificate. Removing the GPU lead bound gave 48.2–51.4 FPS in the
injected lineup, without a clear advantage over bounded threading. Threaded
replay was checked in the injected scalar and SIMD runs. Normal runtime defaults
remain scalar and single-threaded.

`MELEE_LINEUP=all-stock` selects Mario, Fox, Captain Falcon and Link, matching the
underlying fighters in `default`; it also rejects injected-asset preparation
requests. The older `stock` label retains its mixed Turing/stock-opponent test
and must not be described as all-stock. All-stock screenshots and network records
confirm original fighters and no costume/character-select asset preparation.
The slowdown is therefore not confined to injection. The stock CPU trace
attributed 17.54 of 29.22 sampled seconds to game dispatch (inclusive); profiling
clock overhead means this trace is attribution evidence, not a frame-rate run.
Raw windows and build identities: `build/wasm-next/summary.json`; stock profile:
`build/wasm-next/stock-profile/`. SIMD arithmetic validation passed 12,000 concat,
12,000 scaled-matrix and 960,000 FMA full-state comparisons. SIMD was rejected and its build option removed.

### Rejected direct LLVM backend screen

A private wasm32 port of the pinned native LLVM backend replaced 24 profiled C
regions. It passed a 49-field ABI layout check, 13 instruction fixtures and
16,000 full-state probes covering MEM1/MEM2, MMIO, memory aliases, journaling and
exact FMA flags. The probe reference uses interpreter helpers for double
add/subtract because the C generator omits their FPSCR updates.

The resulting four-player windows were 26.97, 32.07, 26.52, 27.87 FPS with stock fighters and 44.42, 44.23, 43.83, 44.84 FPS with injected costumes. Audio stayed active with zero recorded underruns, and no runtime errors were reported. Stock performance regressed substantially; the candidate was rejected and its private source, objects and runtime were removed. Evidence: `build/wasm-codegen/summary.json`.

### Threading recheck

A fresh scalar all-stock run produced 43.45, 45.27 and 45.37 FPS. The earlier
threaded binary then produced 23.67, 23.13 and 22.20 FPS with a one-million-cycle
GPU lead, and 23.26, 23.07 and 22.55 FPS with a ten-million-cycle lead. A newly
linked default-threading candidate also regressed (22.74–31.33 FPS), including
preconfigured and saved-single-thread settings. Moving configuration timing did
not explain the regression. Neither threading nor a larger GPU lead was promoted;
the GPU-worker canvas-transfer prototype and harness overrides were removed.
The normal browser remains single-threaded. Raw evidence is in
`build/wasm-thread-default/summary.json`. These current measurements supersede
the earlier suggestion of a reproducible threading benefit on this machine.

### Rejected size-optimized link

A private `-Os` link reduced the binary from 118,615,393 to 118,478,817 bytes
(0.12%), with a 17,952,360-byte gzip transfer. Stock combat windows were 38.81, 37.19, 38.63 FPS. No useful frame-rate gain was established, so its runtime was removed and the
standard `-O3` link restored. Evidence: `build/wasm-size/summary.json`.

These later measurements ran on a shared development Mac. Substantial background
indexing and Apple compiler-service CPU use was observed; host process snapshots
accompany the size-link run. The measurements do not establish clean-machine
maximum performance. No rejected candidate was substituted for the normal runtime. The retained
hot-entry optimization below was evaluated afterward.


### Hot-entry specialization and deferred PC stores

The browser build specializes 512 profiled regions. Their entry switches contain
19,717 common addresses instead of 131,072; all other addresses fall back to the
original generated functions. Reviewed integer instructions also defer 96,345
redundant guest-PC stores. RAM accesses use the same endian,
range and reservation logic; MMIO callbacks materialize the original instruction
PC first. Exceptions, write journaling and overlapping CPU/RAM storage select
the original path. Floating-point arithmetic, cycle charges, branch destinations
and idle/throttle behavior are unchanged.

`tools/browser_entry_points.json` pins the DOL and each source hash. The hints
select fast paths, not permissible guest control flow. Regenerated source that
changes those hashes requires renewed validation. The generated copies and
CMake manifest live under the build directory, keeping the original regions
available for differential testing:

```sh
python3 tools/validate_browser_entries.py
python3 tools/build_recomp_browser.py
```

The oracle passes 1,835,008 cases against the actual browser game archive, comparing complete CPU state,
RAM/EXRAM, and callback state/order with retained originals at every instruction
entry in the selected regions. Its report includes the archive hash.

The deferral now also covers the 3,281 regions without entry hints (full entry
switches kept; `generated/deferred/`). Their originals live in a test-only
`opensmash-game-reference` archive that the oracle links, so the game module
does not carry them: 101.6 MB versus 129.0 MB. The oracle covers all 3,793
regions, 13,594,112 cases, about 15 minutes on eight shards.

Private-candidate measurements on the same Apple M5, three 30-second windows:

| Configuration | All-stock four-player FPS |
| --- | --- |
| Repeat original baseline | 46.76, 47.23, 48.10 |
| Smaller entry switches, 25 regions | 48.90, 48.58, 50.35 |
| Deferred PC stores, 25 regions | 50.33, 51.61, 51.60 |
| Deferred PC stores, 126 regions | 54.00, 55.74, 54.74 |

The 25-region candidate passed the full stock two-player frame-time/audio gate
at 59.81, 59.94 and 59.93 FPS. This is not a measured improvement over a fresh
two-player baseline. The 126-region injected four-player candidate reached
59.06, 59.94 and 59.93 FPS with no audio underruns or runtime errors; the first
window narrowly failed the 20 ms p95 gate at 20.11 ms. Neither four-player result
certifies sustained 60 FPS for general play. Evidence lives in `build/wasm-entry/`,
`build/wasm-pc/` and `build/wasm-pc128/`.

Additional rejected screens: `-O3` on 26 hot regions, separate functions for
895 entry addresses, and separate-storage compiler assumptions showed no
repeatable gain. A uniform-buffer ring regressed presentation and failed scene
preparation. A SIMD endian-load microbenchmark was slower than scalar loads.
Their private implementation and runtime files were removed; summaries/logs
remain in `build/wasm-o3/`, `build/wasm-clones/`, `build/wasm-pc-alias/`,
`build/wasm-uniform/` and `build/wasm-endian/`. These are not build options.

The previous 126-region build reproduced candidate `ec8ce7069ed4439a` byte-for-byte (Wasm SHA
`ec8ce7069ed4439a361673aca5a1e361fb46fb4d7527b4be99710532b65bff1c`).
It is 121,159,860 bytes uncompressed and 18,384,658 bytes over gzip, approximately
2.1% larger uncompressed than the original baseline. Its fresh stock two-player
run passed all three windows at 59.74, 59.93 and 59.97 FPS; p95 was 17.82–18.05 ms,
p99 was 18.08–23.53 ms, audio had zero underruns, and replay reused the verified
ISO. Evidence: `build/wasm-final/stock-two-player/` and
`build/wasm-final/correctness.json`.

A fresh normal-build injected four-player repeat passed all four windows at
59.26, 59.80, 60.07 and 59.97 FPS, including the existing frame-time/audio gate;
replay also passed. Evidence: `build/wasm-final/injected-four-player/`.
This supersedes the initial injected run's narrow frame-pacing failure, but does
not remove the all-stock four-player shortfall. Summary and exact window values:
`build/wasm-final/summary.json`. Superseded private generated sources and runtimes
were removed after the normal build reproduced their measured binary; evidence
and build identities remain.


### Broader stock validation and CPU/GPU scheduling

The current follow-up returns from the browser CPU loop after 64 complete timing
slices, allowing V8 to use newly optimized code on re-entry. A four-stock
Battlefield run passed three windows at 59.16, 59.93 and 59.94 FPS. Coverage of all
26 stock fighters across five stages then exposed harder cases, especially
Fountain of Dreams; this is not yet a general 60 FPS result.

The browser now transfers its canvas to Dolphin's GPU thread and uses separate
FIFO cache lines plus a static FIFO write path without dynamic-JIT profiling.
The latest Fountain test improved to 57.63, 59.16 and 59.60 FPS, but still failed
the first window. Injected Battlefield passed at 59.90, 59.93 and 59.97 FPS.
See [the detailed measurements and rejected experiments](research/WASM_RUNLOOP_TIERING.md).

Use `MELEE_STOCK_CHARACTERS=5,1,4,13 MELEE_STAGE=2` with
`MELEE_LINEUP=all-stock` to exercise Fountain with the heavy stock lineup.
`MELEE_WINDOWS=3 MELEE_STRICT_WINDOWS=1` requires every measured window to pass
the existing FPS, frame-time and audio gates. No stage or fighter is exempted.


For the complete stock sweep (seven four-player matchups, all 26 fighters):

```sh
NODE_PATH=/path/to/node_modules MELEE_TEST_URL='http://127.0.0.1:5174/?benchmark=1' \
  python3 tools/validate_wasm_roster.py /path/to/Melee.iso --output build/stock-roster-run
```

The output directory must be new. Run this without a concurrent build or another
emulator benchmark. The report retains each runtime identity, individual window,
and replay result; a single failed case makes the command fail.


The full-roster repeat passed five of seven cases on the FIFO runtime. Expanding
the shader warmup from 96 to 833 portable pipeline descriptions then made the
Ice Climbers/Peach/Samus/Jigglypuff case pass all three windows at 59.83, 59.42
and 59.86 FPS. Existing users receive these entries through a merge that keeps
locally learned pipelines. The descriptions contain no game assets or driver
binaries. Fountain still fails the strict sustained-performance gate.

`tools/validate_browser_gpu_wakeup.py` checks the browser GPU wakeup protocol.
The disc harness saves `GALE01.uidcache` alongside timing evidence, and
`tools/merge_browser_shader_cache.py` can merge complete version-8 captures into
a warmup JSON file. Temporary Chrome profiles are removed after each test unless
`MELEE_KEEP_BROWSER_PROFILE=1` is set.

### Region chaining

`tools/chain_browser_chunks.py` runs after entry specialization and writes
chained copies of every region under `generated/chained/`. A static or dynamic
region exit calls the target region directly when the run loop would have
re-dispatched it: same guest context, no pending exception, within the cycles
left in the CoreTiming slice (capped at the 256-cycle loop budget, with at
least one cycle charged per transfer), target not a host-call or idle-loop
address, target region verified and not forced to the interpreter. Chains end
at the first transfer after the slice expires, the boundary per-region dispatch
already used, so interrupt delivery points are unchanged. Patch 0005 publishes
the run loop's state and checks the generated region table against the module.

```sh
python3 tools/validate_browser_chain.py
python3 tools/validate_browser_entries.py --skip-build
```

The chain oracle compares one chained dispatch with the unchained sequence
under the same rule: 91,032 cases (58,100 chained, longest chain 251) over
every region. The entries oracle still passes on the chained archive. Alternating
runs against the frozen `f60b3f3bbd856e7f` control on the heavy Fountain lineup
measured a median 19.3 ms of CPU-thread time per frame versus 22.7 ms (49.3
versus 40.9 FPS on an evening machine state where neither passed the strict
gate). Details, failed variants and evidence paths are in
[WASM_REGION_CHAINING.md](research/WASM_REGION_CHAINING.md).

For the current cleanup state, exact reproduction commands, acceptance gates and
known measurement limitations, see the [independent performance handoff](research/WASM_INDEPENDENT_HANDOFF.md).
