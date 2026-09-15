# Local browser performance — September 9, 2026

The optimized browser skinning path is the local play default. Six moveset samples passed the sustained two-fighter combat gate at 960×720 in Codex’s in-app browser on an Apple M5. The Fox sample is the largest source mesh in the 1,067-character audit: Rob Zombie, 3,670 vertices. This is not a mobile, four-player, all-stage or complete OpenSmash parity certificate.

## Measured combat windows

All observed 30-second-window FPS values are retained below, including failed windows. The last three windows of each run passed: FPS ≥58.5, p95 ≤20 ms, p99 ≤33.34 ms, zero audio underrun samples, and actual audio rendering for at least 95% of the expected 48 kHz samples. Only active CPU-versus-CPU benchmark runs without runtime errors qualify.

| Moveset / character | Every measured window (FPS) | Last-three worst p95 / p99 (ms) | Audio underruns | Result |
|---|---|---|---|---|
| Mario / Alan Turing | 58.46, 59.84, 59.71, 60.13, 59.84 | 18.08 / 21.52 | 0 | Pass |
| Luigi / 50 Cent | 59.93, 59.94, 59.9 | 17.89 / 20.43 | 0 | Pass |
| Captain Falcon / Abraham Lincoln | 59.93, 59.87, 59.87 | 17.75 / 21.86 | 0 | Pass |
| Fox / Rob Zombie | 60.0, 59.09, 59.0 | 19.66 / 24.96 | 0 | Pass |
| Marth / Alex Ovechkin | 59.94, 59.61, 59.84 | 19.05 / 21.29 | 0 | Pass |
| Link / Al Capone | 59.37, 58.43, 59.94, 59.74, 59.6, 59.81 | 18.14 / 23.45 | 0 | Pass |

Mario’s initial window and one Link effects-heavy window failed. Both later passed three consecutive windows. Brief first-use/effect stutters remain visible; the result should be described as near-60-FPS combat, not a perfect frame lock.

## What changed

The former custom costume layout emitted hundreds of GX draw batches (337 for Alan Turing). The browser now skins the same vertices and original blended weights once per draw using the live Melee joint transforms, then submits one batch for these meshes. Melee still runs animation, physics, collisions, camera, materials and projection. The original GX path remains available with `?skin=gx`.

Four live matrix comparisons per moveset (draws 1, 120, 600 and 1200) checked every weight envelope against the actual PPC matrix routines. Position matrices matched exactly; the largest normal-matrix error was about 0.000012. Measurement windows restart after the final comparison, so oracle work is excluded. Exact concat/FMA specializations also pass independent full-CPU-state and RAM regression oracles.

The longer tests found and fixed a lazy-FPU context-switch failure and fresh-save Luigi/Marth availability. The unoptimized GX combat path averaged roughly 33.5 FPS initially and 41–43 FPS after math/FIFO work; the one-batch browser layout supplied the larger improvement.

## Reproduce

Start the local asset server and Vite as described in [LOCAL_RUNTIME.md](LOCAL_RUNTIME.md). Open `http://127.0.0.1:5174/?profile=skin&benchmark=1`, choose a character, and keep the tab active with sound enabled. Do not run compilers during measurement. Wait for the four matrix checks followed by three complete 30-second windows. Normal play at the bare local URL uses a human first player, four stocks, and the same optimized renderer.

```sh
python3 tools/report_browser_fps.py --output build/moderngekko-validation/browser-fps-summary.json
python3 -m unittest discover -s tests
npm run build --prefix web
```

Raw evidence remains local: `build/moderngekko-validation/browser-trace.jsonl`, `browser-fps-summary.json`, and `browser-skin-oracle.json`. Historical failed development runs are intentionally retained.

## Build and session identities

- Mario / Alan Turing: Wasm `d2a7cd42236b5abd`, session `56383e4b-2d19-475d-8e35-ad58c44d33ee`.
- Luigi / 50 Cent: Wasm `33ce0b953e2bf704`, session `600d52fe-d12d-4e09-8915-61f36ffe9fb0`.
- Captain Falcon / Abraham Lincoln: Wasm `33ce0b953e2bf704`, session `2b6d372c-4b89-40a8-80f7-37b2c81f8745`.
- Fox / Rob Zombie: Wasm `33ce0b953e2bf704`, session `2e1dd73f-3b18-46d4-903e-6daf40b42e83`.
- Marth / Alex Ovechkin: Wasm `33ce0b953e2bf704`, session `c1e90e9e-15a4-4a87-9317-1a0a255817cd`.
- Link / Al Capone: Wasm `33ce0b953e2bf704`, session `54213466-e055-4e6c-91d1-b8751e1de678`.

The newer build differs from the Mario performance build only by initializing the local roster’s character-unlock mask before character select. Both use the same validated skinning code. Builds use the fast O1 link; compiled game/runtime functions retain their configured optimizations. No claims are inferred from a different optimized-link build.

## Normal-play check

After enabling the optimized default, a bare-URL Alan Turing/Mario match launched
with a human P1, four stocks and the host skinning path (Wasm `33ce0b953e2bf704`).
Keyboard Enter visibly opened and closed P1 Pause. Jump and special inputs were
sent; P1 moved onto a platform and Peach’s damage rose from 0% to 6%. The visible
FPS readout was around 60. This interaction check is separate from the automated
CPU-versus-CPU performance gate. The match was closed back to the local roster.

## Startup optimization regression

Build `89141b6f6fb549b5` adds sized bulk file reads, fast-disc mode, startup-only
unthrottling, and one parked engine. It restores normal pacing at the first
combat callback. See [STARTUP.md](STARTUP.md) for click timings and cold/warm
definitions. All six movesets reached actual matches through the new slot path.

The live matrix oracle passed through pose 1200 for Luigi, Link, Captain Falcon,
Fox and Marth after slot padding. The independent archive check also preserves
all original data bytes, relocations and symbols for every tested slot. Mario's
human session had a passing 59.36 FPS window and working pause input.

The largest mesh, Rob Zombie/Fox, recorded 59.97, **58.03 (failed)**, 60.03,
58.52 and 59.03 FPS. The final three windows passed the existing gate, with zero
audio underruns. Alex Ovechkin/Marth recorded 59.94, 59.93 and 59.97 FPS, also
with zero underruns. These completed windows preceded the native compiler work;
the browser match was closed before the larger native build started. As before,
occasional effect-related stalls remain and this is not a locked-60 guarantee.

Regression sessions:

- Mario: `856160c7-6a1c-4ae1-bead-f5692cb8616c` (human).
- Luigi: `1d1ce66e-7cda-4d62-99dd-0fab659f85c8` (oracle).
- Link: `ef146338-5fa0-40f8-bc25-af8079f8d3b3` (oracle and one passing window).
- Captain Falcon/Achilles: `d99f2ce8-35fc-487f-81e9-22c14006648c` (first conversion and oracle).
- Fox: `8032ef7f-a41d-4a19-9f3d-b571b4027117` (oracle and sustained gate).
- Marth: `fd64a686-71be-4215-a68a-16772e1078b8` (oracle and sustained gate).

The earlier full six-moveset sustained runs remain the broader coverage;
this startup change did not repeat three clean windows for every character.

## Five-mode renderer build (September 9)

Build `649124c7433b0adb` (O3) corrects WebGL depth handling and adds launch modes,
four-port lineups and independent costume slots. The four-player Battlefield
sample (Alan Turing, Abraham Lincoln, standard Mario, Achilles) recorded
46.19, 46.77, 46.16 and 48.19 FPS over four consecutive 30–31-second windows.
All had zero audio underruns, but this **fails sustained 60 FPS**. Its warmed
multi-costume click took 3.90 seconds. Do not apply the older two-player FPS/startup
results to this four-player case.

Native four-player custom combat was approximately 31–34 FPS in isolated GUI
samples. Reducing internal resolution did not remove the CPU bottleneck;
bounded GPU threading varied around 32–42 FPS and did not meet the target.

Current trace and report: `browser-trace.jsonl` and `launch-mode-fps-all.json`
under `build/moderngekko-validation/`. Launch-mode functionality is implemented;
four-player performance parity is still open in both builds.

The final two-player Alan Turing/Peach comparison recorded 59.73, 57.13 and
60.03 FPS. The middle window had p95 24.61 ms and 256 audio-underrun samples;
therefore the final renderer also does **not** receive a sustained-60 pass for
that run. The earlier six-moveset results remain historical evidence, not a
certificate for this changed renderer. These failures are retained in
`launch-modes-browser-performance.json`.


## Native play correction (September 9)

The native build now shares the browser's single-batch custom skinning and its
verified PSMTXConcat / HSD_MtxScaledAdd specializations. It also marks the floating
game and controller bridge as active work and gives the frame worker an explicit
interactive scheduling class on macOS. The matrix optimizations passed 12,000
full-CPU-state and RAM comparisons each; concatenation was 8.25× faster in the
isolated oracle. Four live native skinning poses matched Melee position matrices
exactly, with maximum normal-matrix error approximately 0.000012.

A final Lincoln/Falcon-versus-Peach CPU-combat run at 960×720 with Metal and Cubeb,
with capture disabled, passed three independent 30-second windows after warm-up:

| Window | FPS | p95 ms | p99 ms |
|---|---:|---:|---:|
| 1 | 59.939 | 17.221 | 17.771 |
| 2 | 59.939 | 17.268 | 17.742 |
| 3 | 59.939 | 17.226 | 17.784 |

Evidence: `build/native-play-review/sustained-math/result.json`, including engine,
module and costume hashes; the installed app's engine and full-resolution Lincoln
costume match those exact artifacts. This is a two-player native frame-time pass,
not an all-character/four-player FPS or audio-underrun certificate. Failed earlier
runs are retained in `sustained/` and `sustained-active/` in the same review folder.

All five launch modes and a mixed four-player lineup passed the final functional
checks. The three-custom loading failure also reproduced in the previous app:
full-resolution costumes exceeded Melee's preload arena. Large lineups now use
256px variants, while one/two-custom lineups retain 512px. Positions, normals and
weights are byte-identical across the full/compact variants for all eight customs.
Four-player sustained performance still needs its own benchmark.


## Chrome first-visit reproduction (September 9)

A headed Chrome 152 run using a new, empty user-data directory reproduced the
reported startup slowdown. The test clicked Donald Trump/Fox immediately after
the roster appeared, against default CPU Peach on Battlefield. It used the normal
local URL, host skinning, audio enabled, and Wasm build `673eaa564ee77c23`.
Only the browser profile was cold; the local server already had converted assets.

The first visit showed 0 FPS at 16–17 seconds after the click, 5 FPS at 18–19
seconds, 25–30 FPS at 20–22 seconds, and 52 FPS at 24 seconds. The reported
click-to-match time was 17.17 seconds; the first measured 31-second combat window
averaged 45.61 FPS. A repeat visit in that same profile reached the match in
7.17 seconds and its first combat intervals were approximately 17, 47, 59, and
60 FPS. This confirms a cold-start performance problem, but does not isolate
Wasm compilation versus shader compilation or other first-use costs.

Audio rendered during the measurement and the first full combat window recorded
zero ring-buffer underruns. That counter alone does not certify glitch-free
sound during multi-second startup stalls. Sustained 60 FPS remains unproven.

Local reproduction script, per-second UI samples, screenshots, and runtime traces:
`build/browser-cold-start/`. Startup telemetry now retains the first 30 combat
intervals and browser identity, so long averages no longer hide this failure.


## First-scene preparation changes and remaining failure

Browser build `e19e66da26b11aa1` seeds a portable Dolphin pipeline UID cache,
compiles it locally, and holds the default free-for-all scene using Melee's
scheduler pause bits while checking rendered frame intervals. Release restores
the original flags. The clock and CPUs cannot advance behind this preparation
screen. Other launch modes retain their previous startup behavior; native code
paths are unchanged. This is not comprehensive shader coverage for every fighter
and stage.

The audio worklet connects when the scene is presented, primes with 1,024 samples,
and the producer queues 3,072 frames (64 ms at 48 kHz). Startup audio is drained
while held. Three Node tests cover readiness and audio priming/underrun counting;
the web production build and 51 Python tests passed.

This is a partial mitigation, **not a passing browser performance fix**. A fresh,
headed, focused Chrome profile with Alan Turing/Mario on Battlefield still took
27.83 seconds to its first displayed FPS sample, which was 11 FPS. Preparation
held combat at frame 2; the first screenshot confirms 8:00, full stocks and the
Ready countdown. The first 30-second combat window averaged 27.57 FPS and counted
5,376 missing audio samples. The same profile's repeat visit started in 9.24
seconds and its measured windows averaged 44.68 and 53.74 FPS, with zero ring
underruns. Neither passes the 60 FPS criterion. Machine load was not controlled;
visibility and focus were recorded throughout. Zero ring underruns alone does
not certify perceptually clean game audio.

Paused rendering readiness does not establish readiness of the complete running
simulation. Further profiling must include resumed gameplay and its first-use
work, rather than extending the paused-render loading gate or treating this as
only a first-visit issue.

Reproduce with Playwright installed and available to Node:

```sh
node tools/validate_browser_startup.cjs build/browser-startup-validation "Alan Turing"
```

The script creates an isolated profile, clicks immediately, measures first and
repeat visits, and closes its own browser. It never clears the user's profile.
On macOS with AeroSpace, `OPENSMASH_FOCUS_TEST_WINDOW=1` focuses the test window
without modifying configuration. Local evidence: `build/browser-startup-fix/turing-final/`.

## Runtime hook lookup investigation (September 9)

A matching optimized Wasm build (`f66d784d75389014`) and Chrome CPU trace
identified the bridge's `host_call` and `host_call_contains` lambdas as the
largest individual self-time contributors: 2.566 and 1.481 seconds respectively
in a 30-second sampling interval. That is about 13.5% of sampled wall time on
the emulation thread, not a claim of an equivalent end-to-end speedup. The last
900 instrumented frames averaged 107,739 native dispatches per frame, 20.52 ms
per frame, 0.43 ms presentation, and 0.006 ms throttle sleep. Profiler overhead
and uncontrolled machine load limit direct comparisons with unprofiled runs.

The bridge now builds a read-only 128 KiB instruction-membership bitmap before
starting emulation. Misses avoid scanning all patches/hooks; actual hits retain
the original callbacks, ordering, register restoration, and patch behavior.
Out-of-text addresses and range queries use the sorted address list. Once normal
pacing is restored, callbacks also stop querying destination readiness. This
changes browser bridge overhead only, not game timing or character geometry.

Optimized browser builds now emit `opensmash-web.js.symbols` for Chrome's numeric
Wasm stack frames. Always retain the map with the exact profiled build: adding
the map changed function numbering, so older traces cannot use the new map.
Local named profile evidence: `build/browser-runtime-profile/named/`.

The lookup test checks every aligned instruction across the bitmap, duplicates,
unaligned and out-of-range addresses, empty indexes, and exclusive range ends:

```sh
c++ -std=c++17 -O2 tests/browser_hook_index.cpp -o /tmp/opensmash-hook-index-test
/tmp/opensmash-hook-index-test
```

The unprofiled retest of build `92217e510d206c5d`, using a fresh headed and
focused Chrome profile with Turing/Mario against Peach on Battlefield, passed
all four recorded combat windows:

| Visit | Window | FPS | p95 ms | p99 ms | Audio underrun samples |
| --- | --- | --- | --- | --- | --- |
| First | 1 | 59.63 | 18.160 | 26.084 | 0 |
| First | 2 | 59.93 | 16.820 | 17.360 | 0 |
| Repeat | 1 | 59.80 | 16.900 | 17.159 | 0 |
| Repeat | 2 | 59.90 | 16.829 | 18.625 | 0 |

The first displayed FPS arrived 10.22 seconds after clicking on the first visit
and 5.10 seconds on repeat. The first complete startup interval measured 57.31
FPS with zero underruns; the repeat began at 59.95 FPS. The first screenshot
confirms a full-stock match at 8:00. The test closed its isolated browser afterward.
Evidence, including per-second samples, screenshots, build identity in runtime
traces and summarized windows: `build/browser-runtime-profile/lookup-validation/`.
This validates this two-player matchup on this machine, not every roster/stage,
four-player performance, or a perceptual audio certification. Only browser
profile storage was cold; server assets and driver caches were not reset.


## Browser local ISO and native performance comparison (September 12)

The browser now reads a user-selected ISO locally, with no `/api/setup` or
`/api/game` transport. A fresh Chrome profile on the Apple M5 (32 GB) verified
and initialized the selected ISO in approximately 6.57 seconds. This measures
local selection through engine readiness, with converted server assets already
cached; it is not an internet first-download benchmark. Runtime gzip transfer
was reduced from 113.1 MiB to 17.1 MiB without changing the Wasm bytes.

The original optimized runtime `b81810e5f9fc8124`, using Turing/Mario versus
original Fox on Battlefield, passed three consecutive 30-second CPU-combat
windows with rendered audio and zero audio underruns:

| Window | FPS | p95 ms | p99 ms |
|---|---:|---:|---:|
| 1 | 59.266 | 18.195 | 28.054 |
| 2 | 59.967 | 17.260 | 17.665 |
| 3 | 59.732 | 17.239 | 22.094 |

Evidence: `build/local-disc-validation/two-player-fixed/`. A later fresh-profile
repeat (`two-player-replay-final/`) measured 50.29–57.13 FPS with rendered audio
and zero underruns; replay succeeded without rehashing or uploading the ISO.
It fell below the target, so the earlier pass
is not a repeatable performance certificate. The same runtime with
Turing and original Fox, Link and Peach achieved only 45.94, 44.81 and 44.58 FPS
(`four-player/`). These results do not certify all lineups or machines.

Two isolated compiler experiments did not solve four-player performance:
1024-instruction regions (`d74b371e37bd8691`) measured 37.43, 35.52 and 35.52 FPS;
expanded hot-function LTO (`6809b0641b5b8f73`) measured 24.36, 39.03 and 42.84 FPS.
The default optimized 256-instruction runtime remains selected. The four exact
math specialization headers were byte-identical across region sizes. CPU traces
in `four-profile/` attribute substantial time to dispatch and game execution;
profiled windows are excluded from certification.

Native's compact texture policy now also applies to browser matches with three
or more custom costumes. This fixes the guest preload-heap assertion for
Turing/Fox/Lincoln/Obama. A silent run briefly approached 60 FPS, but rendered zero
audio samples and therefore failed validation (`four-compact/`). Explicit audio
activation is now part of the test, and the runtime's pass flag requires both
frame timing and audio health. The repeat with audio produced 40.10–47.03 FPS in complete audio-rendering
windows, with a later audio-underrun failure (`four-compact-audio/`).
Four-player sustained 60 FPS remains unmet.

The September 11 native ARM64/x86 JIT improvement is relevant to the CPU bottleneck,
but its machine-code emitter cannot execute in WebAssembly. The browser retains
static recompilation. Increasing region size or compiler inlining is not equivalent
to porting that JIT. Further browser CPU optimization is required before claiming
native four-player performance parity.


## Solana Saga browser endurance (September 15)

The synchronous GPU worker must periodically return to its browser event loop.
Chromium posts transferred ImageBitmap resource-release callbacks back to the
originating worker. Consuming each bitmap on the page does not reclaim those
resources while that worker remains inside its native loop. A four-player run
reached 8.6 GB of GPU allocations and Android killed the foreground renderer;
a separate two-player run reproduced rapid allocation growth. Calling gl.finish
did not resolve it.

Browser patch 0008 yields the GPU worker every 50 ms. Asyncify follows direct
call paths and explicitly includes the outer dynCall_ii pthread entry. SDL's
automatic Asyncify delays remain disabled to preserve synchronous CPU behavior.
`python3 tools/validate_browser_gpu_event_loop.py` checks real Wasm pthread
callbacks, argument preservation, SDL configuration and joined shutdown using
the production linker flags and bootstrap.

An eight-minute USB Saga test in Chrome 152 used build `85ae9537d5186762`,
Donald Trump/Falco versus original Fox, Final Destination, two CPU players and
20 stocks. GPU allocation stayed approximately 400–500 MB through the end,
with the full platform, both fighters and HUD visible. The run survived without
a renderer kill. Evidence is local in `/tmp/opensmash-mobile-test/`:
`gpu-yield-auto-gpu.jsonl`, `gpu-yield-auto-result.json` and
`gpu-yield-auto-combat.png`; trace session
`e8cb5ec0-94c3-4b66-a7ad-e78b6fa1baea`.

This is a stability fix, not a 60 FPS result. Thirteen warm combat windows
measured 37.32–42.81 FPS after the initial 32.42 FPS interval. One later window
reported 256 audio-underrun samples. Sustained mobile 60 FPS remains unmet.
