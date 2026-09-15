# Direct-C implementation and validation

## Result

A separate, runnable backend now implements the existing browser launcher's game
paths using Melee C/HSD code compiled directly to WASM. Select `?engine=direct-c`.
It includes custom characters and presentation, four-player matches, menus,
Classic entry, full boot, local-disc verification, audio, input and browser saves.
The work is isolated on `codex/melee-direct-c`, forked from `1afb48b`; it does not
include the concurrent mobile-performance work on `codex/melee-integration`.

This is a feature-complete integration of the tested launcher paths, **not proof
of bit-exact parity with Dolphin or the console**. The separate GX renderer and AX
mixer have accuracy differences described below. The measured performance gates,
including failures, are reported without relaxing their thresholds.

## Validate locally

Open **http://127.0.0.1:5189/?engine=direct-c** and select your USA 1.02 disc.
The normal character picker, settings and controls are available. Useful checks:

1. Play a custom character against a CPU; exercise attacks, grabs and held items.
2. Select four different custom characters and inspect their intro, stock art,
   models, names and results portraits.
3. Open character select or VS menus, choose a stage, finish a match and rematch.
4. Enter Classic or full boot using the existing launch settings.

Build/server/test commands are in [README.md](README.md). The separate diagnostic
UI is at http://127.0.0.1:5188/. It is useful for controlled stock-game tests;
it is not the shared launcher. No game disc or generated game assets are committed.

## What changed

- The pinned [MeleeRecomp source port](https://github.com/avak1an/MeleeRecomp/tree/b99e9eac893197b867425f83d95397e6ff866cf6)
  is compiled to WASM, including roughly 1,000 game/HSD compilation units.
  Game calls execute directly; original PowerPC addresses serve only as keys
  for adapting existing presentation helpers to native globals.
- Browser implementations replace Windows devices: local ISO reads, WebGL2,
  four controller ports, 60 Hz pacing, audio output and persistent saves.
- Portability fixes remove assumptions about adjacent globals, negative array
  indexing, big-endian packed fields, projection-buffer sizes and recursive
  display-object loading. These fixed concrete failures in Peach, Game & Watch,
  Flat Zone, Fourside, Mute City, Venom, Classic entry and results presentation.
- Existing OSUI/OSSK/OSCS custom assets work through the normal preparation API.
  Native skinning uses live Melee joint matrices and stored weights, with an HSD
  matrix oracle checking initial draws (observed maximum error about 1.9e-6).
- The full local disc hash is checked with streaming SHA-256 before game startup.
  The game executable also receives the source port's exact SHA-1 check.
- Audio playback uses a separate 11.5 KB Sonic WASM module on the audio consumer.
  It can adjust tempo while the game/GL worker stalls, preserving pitch. The
  queue target is 128 ms, plus Sonic lookahead and device buffering; the fallback
  ScriptProcessor adds a 1024-sample callback. This trades audio latency and
  temporary tempo variation for continuity. Normal simulation remains 60 Hz.
  After the deterministic stall/recovery test, the ring held 123 ms with
  128-frame callbacks and 186 ms with 1024-frame callbacks; those figures exclude
  the processor lookahead and audio device buffering.
- Benchmark telemetry includes actual submitted bitmap rate, frame-time tails,
  audio consumption, underruns and direct-C ring overruns. Reprime silence now
  counts as missing audio instead of escaping the measurement.

## Functional coverage

| Check | Result | Evidence under `engines/melee/build/direct-c/` |
|---|---:|---|
| Stock fighters, stages and four-player simulation | 56/56 at 8,000 frames each | `coverage-final/report.json` |
| Repeat stock simulation coverage | 56/56 at 2,400 frames each | `coverage-release/report.json` |
| Actual WebGL rendering: 26 fighters and 29 stages | 55/55 | `render-release/report.json` and screenshots |
| Custom character on all 26 moveset targets | 26/26 at over 1,200 rendered simulation frames | `custom-matrix/report.json` and screenshots |
| Menu, CSS, stage, match, results, rematch, Classic, boot and input checks | 7/7 scenarios | `flows/report.json` |
| Browser custom results, return to CSS/save, and Classic combat | 2/2 | `ui-flows/report.json` and screenshots |
| Four custom intro names and voice order | Passed | `intro-final-labels/` |
| Invalid disc rejection followed by valid-disc recovery | Passed | `disc-final/` |
| SHA-1 and streaming SHA-256 reference vectors | 6 each passed | `support-check.json` |
| Native stereo time-stretch pitch/duration checks | 3 speeds passed | `support-check.json` |
| Independent audio clock with 200 ms producer stall | 128- and 1024-frame callbacks passed, zero missing/dropped samples | `audio-consumer-check.json` |
| Reproducing four-character fixtures through the normal API | All 8 files byte-identical | `fixture-reproduction/` |
| Shared frontend typecheck and production build | Passed | `npm --prefix engines/melee/web run build` |

Screenshots: [four-player combat](../../build/direct-c/benchmarks-consumer-contention/direct-4/combat.png),
[custom results](../../build/direct-c/ui-flows/custom-results.png),
[return to character select](../../build/direct-c/ui-flows/return-css.png).

The long simulation sweep ran while fixes were being completed; the repeat sweep
and rendering/custom suites cover the resulting fixes. Simulation checks require
finite, changing combat state and the expected fighter identity. Rendering checks
require actual browser frames and no runtime errors. They do not compare every
pixel or every move against a console recording. Classic coverage establishes
entry and combat, not every later round and ending.

## Performance method

Apple M5 (10 CPU cores, 32 GiB), macOS 26.5.2, headed Chrome 152.0.7977.83,
960×720 game framebuffer. Each backend/workload uses a fresh Chrome profile and
three consecutive 30-second combat windows. Cases run sequentially, without our own
concurrent coverage suites or builds. Compiler activity from the other worktree
is recorded separately and contended runs are not used to claim a speedup. Normal launcher assets and level-9 CPU
combat are used; two-player cases also exercise the replay path. The backends use
the same character/stage settings, but these are independent CPU matches rather
than synchronized, frame-exact input replays.

Two-player workload: custom Alan Turing plus stock Fox. Four-player workload:
custom Alan Turing, Donald Trump, Abraham Lincoln and Barack Obama, using the
same launcher selection for both backends. Existing-backend results use the
fixed artifact available when this worktree was created, not the other agent's
unfinished mobile build. Background OS/browser activity can still affect timing.

Acceptance gate per window: FPS ≥58.5; p95 ≤20 ms; p99 ≤33.34 ms; zero audio
underruns; audio clock coverage ≥95%. Direct-C also reports ring overruns and
requires zero. The existing backend does not report that counter; absence is not
proof of zero overruns. Case acceptance requires all three windows to pass.

<!-- FINAL_BENCHMARKS -->
### Measured results

| Backend / players | Window | FPS | p95 ms | p99 ms | Max ms | Audio missing / dropped frames | Gate |
|---|---:|---:|---:|---:|---:|---:|---|
| direct-2 | 1 | 59.68 | 19.79 | 23.20 | 183.88 | 0 / 0 | Pass |
| direct-2 | 2 | 59.99 | 19.71 | 22.04 | 31.39 | 0 / 0 | Pass |
| direct-2 | 3 | 60.00 | 19.60 | 21.87 | 29.74 | 0 / 0 | Pass |
| ppc-2 | 1 | 59.93 | 18.65 | 19.20 | not recorded | 0 / not recorded | Pass |
| ppc-2 | 2 | 59.94 | 18.57 | 19.04 | not recorded | 0 / not recorded | Pass |
| ppc-2 | 3 | 59.94 | 18.59 | 19.07 | not recorded | 0 / not recorded | Pass |
| direct-4 | 1 | 59.12 | 21.48 | 28.18 | 211.61 | 0 / 0 | Fail |
| direct-4 | 2 | 59.97 | 20.57 | 24.15 | 32.35 | 0 / 0 | Fail |
| direct-4 | 3 | 59.99 | 20.33 | 23.03 | 32.08 | 0 / 0 | Fail |
| ppc-4 | 1 | 59.61 | 18.26 | 24.75 | not recorded | 0 / not recorded | Pass |
| ppc-4 | 2 | 59.93 | 17.70 | 18.15 | not recorded | 0 / not recorded | Pass |
| ppc-4 | 3 | 59.94 | 17.79 | 18.39 | not recorded | 0 / not recorded | Pass |

The clean direct-C two-player case passes all three windows. Four-player direct C
sustains approximately 60 FPS after the first window, but misses the p95 gate in
all three windows. Its first combat window includes a 211.61 ms worst frame.
All six direct-C windows have zero audio underruns and ring overruns. The
submitted bitmap rate equals the measured simulation rate in these windows.

The four-player baseline row uses the earlier quiet run of the same WASM artifact.
The newest attempt was affected by external compiler activity and is excluded
from the comparison; its raw results are retained in the JSON report.

**Conclusion:** this port demonstrates a working direct-C path, but does not
demonstrate an overall performance improvement over the existing backend. The
baseline has tighter frame pacing in this workload. The direct game WASM is
87,495,678 bytes versus 110,184,995 bytes (20.6% smaller, uncompressed),
plus an 11,536-byte audio module.

### Unpaced rendering diagnostic

These runs disable audio and remove the 60 Hz pacing limit. They use stock
Mario/Peach and a compact four-custom-character fixture (three Mario movesets
and one Fox), so they are separate workloads from the shared-launcher comparison.
Bitmap rate means delivered bitmaps, not the physical display refresh rate.

| Workload | Simulation FPS | Delivered bitmap FPS | Compiler contention |
|---|---:|---:|---|
| two-stock | 81.18 | 81.18 | Yes |
| four-custom | 64.03 | 64.03 | Yes |

Compiler activity occurred during this diagnostic. These figures are lower-bound
observations under that host load, not measurements of an idle-machine ceiling.

Unpaced FPS measures a faster-running game. It is not evidence of hundreds of
players, a higher gameplay simulation rate, or better mobile performance.

### Build identity

- Direct game: `37cb910687d1253d965e68d2c22eac18af5f280639888227c9cc325d048c1ebe`
- Direct audio: `155278ced0e72b2a9b6c77abd0419754671d9f07d54149a418e8862c584bd210`
- Existing baseline: `7536a908125a5ac3fa9436699c83ef68697435b4821c3f2b22a18c27d80ba91e`

Complete timings, build metadata, compiler-contention flags and the retained
attempts are in [validation/benchmarks.json](validation/benchmarks.json). Raw browser
events, network traces, 1-second samples and screenshots remain under
`engines/melee/build/direct-c/benchmarks/`; the isolated baseline retry is under
`benchmark-ppc4-repeat/`, and unpaced events are under `headroom/`.
<!-- END_FINAL_BENCHMARKS -->

## Accuracy and scope limits

Machine-readable coverage and audio results are committed in [validation/coverage.json](validation/coverage.json).
Earlier tuning and contention measurements are retained in [validation/benchmark-history.json](validation/benchmark-history.json).
The first two history sets use producer-side audio adjustment; their audio counters
are not interchangeable with the final consumer-side implementation. The first
history set also predates complete reprime-silence and ring-overrun accounting.

The direct-C build preserves the tested launcher features, but uses the source
port's renderer/mixer rather than Dolphin's. In this pinned port, destination
alpha and fog range adjustment are unimplemented; AX interaural delay and low-pass
filtering are ignored, and sample-rate conversion differs from the console DSP.
Floating-point/paired-single rounding is not matched. Save data uses the source
port's native layout in separate IndexedDB storage, not Dolphin/GCI interchange.
These are material reasons not to describe the result as bit-exact full parity.

Validation covers desktop Chrome and up to four active player ports. It does not
establish mobile performance, networking, hundreds of players, all Adventure/
All-Star content, or every late Classic sequence. An unpaced result above 60 FPS
means the game runs faster than real time; it does not turn Melee into a higher
simulation-rate game. Keeping the original backend selectable makes the result
available for direct comparison without replacing the concurrent mobile work.
