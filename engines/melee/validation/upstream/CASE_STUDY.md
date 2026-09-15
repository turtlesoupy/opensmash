# Custom fighter quality and stalls: September 15 case study

## Residual stalls: final results

| Two-minute case | FPS across 30-second windows | Worst frame | Frames over 33 ms | Audio underrun samples |
|---|---:|---:|---:|---:|
| Before, direct presentation | 59.43–60.00 | 162.64 ms | 12 | 0 |
| Final, fresh browser storage | 59.98–60.00 | 30.03 ms | 0 | 0 |
| Final, returning browser storage | 60.00 | 21.93 ms | 0 | 0 |

Both final runs pass the normal FPS/p95/p99/audio checks and a stricter **33.34 ms maximum-frame gate**. The returning run checks every window. Click-to-match was 4.43 seconds fresh and 4.10 seconds returning; replay passed without rehashing the disc. Screenshots after measurement confirm rendering and replay. Default-launcher keyboard movement, attack, and release passed, along with the staging, frame transport, and browser session unit tests and the TypeScript/Vite build. Browser storage was fresh for the fresh run; OS/GPU caches were not purged. These are measured results for the focused lineup on this machine, not a guarantee for all browsers, stages, or system loads.

Raw measurements and final artifact hash: [residual-stalls.json](residual-stalls.json). Failed intermediate runs remain in `build/residual-*`; the report includes the pre-remapping version that eliminated large stalls but narrowly failed p95, rather than treating it as a passing result.

To reproduce the stricter check, add `MELEE_WINDOWS=4 MELEE_TIMING_ONLY=1 MELEE_MAX_FRAME_MS=33.34` to the command below. Add `MELEE_BROWSER_PROFILE=/path/to/profile MELEE_STRICT_WINDOWS=1` for returning visits. No diagnostic Chrome flags are used in either final run.

## Residual stalls: implementation

The longer two-minute reproduction found additional 163 ms frames beyond the previous one-minute window. The browser now uses one set of separate GPU staging buffers, preserving all native pool capacities while mapping only the per-pool high-water ranges. Remapping starts after submission and completes during normal VI pacing. Ready buffers copy synchronously; a larger frame grows its mapping safely. Quiet frames retain the established mapping capacity so a later effect burst does not have to remap behind shader compilation. This replaces synchronous queue uploads and removes the five combined 87 MiB staging allocations from the browser path.

Two large effect dispatchers also perform a guarded, side-effect-free call during loading to trigger their first-use WASM compilation. The guards return before particle creation, RNG access, or game state changes. Native builds keep their original behavior. A diagnostic Chrome run disabling lazy compilation reduced the first effect frame's CPU work from roughly 35 ms to 7 ms; production runs use normal browser flags. The mechanism is consistent with [V8's description of blocking first-use baseline compilation](https://chromium.googlesource.com/v8/v8/+/main/docs/wasm/architecture.md).

The launcher queries modal visibility once per input sample and sends controller state only when it changes. The engine still reapplies held state each VI. Regression tests cover press/release, confirmation invalidation, independent ports, mapping growth, retained burst capacity, and the synchronous reuse path.

Timing-only runs omit the first-playable screenshot; visual capture occurs after timing. Removing that screenshot alone did not remove the startup spike. The harness now accepts `MELEE_MAX_FRAME_MS` for an explicit worst-frame gate.

## Follow-up: startup and high-action stalls

The longer case study reproduced a 608 ms gameplay frame: 585 ms was spent uploading roughly 2 MiB to WebGPU, while game simulation took under 5 ms. The ordinary upload scratch buffer alone did not resolve it.

The launcher now displays the live GPU canvas, preserving the initialized iframe with `Element.moveBefore`, instead of copying every frame through `createImageBitmap` and a second canvas. Browsers without state-preserving iframe moves retain bitmap presentation. Returning visits also compile cached pipeline states cooperatively before simulation starts, with loading progress; previously five cached pipelines were compiled at each gameplay frame end. Phase diagnostics now identify upload, shader, simulation, and pacing costs in long-frame events.

| 60-second case | FPS range across 30-second windows | Worst frame | Frames over 33 ms | Audio underruns |
|---|---:|---:|---:|---:|
| Copy presentation, returning profile | 57.20–59.96 | 607.96 ms | See raw report | 20,513 samples |
| Direct presentation, returning profile | 59.89–60.00 | 46.13 ms | 2 | 0 |
| Direct presentation, fresh profile | 59.98–60.00 | 40.88 ms | 2 | 0 |

Both direct runs passed the focused performance gate. Fresh-profile means new browser storage, not cleared OS/driver caches. These runs support removing the copy path as the remedy for this reproduced stall; they do not establish that all GPUs or matches are stall-free. Full-quality custom textures remain enabled. The fresh run also passed return-to-roster/replay without rehashing the disc. Keyboard movement, attack, and release passed on the default launcher; the browser session unit test and TypeScript/Vite build also passed. Click-to-match was 4.04 s returning and 4.05 s fresh. Live presentation was asserted in the fresh run and inspected in screenshots.

Raw measurements: [stalls.json](stalls.json). Local runs: `build/stall-direct-surface`, `build/stall-direct-fresh`, and the failing baseline `build/stall-phases-returning`. Use the reproduction command below with `MELEE_WINDOWS=2`; add `MELEE_BROWSER_PROFILE=/path/to/profile` for returning visits and `MELEE_REPLAY=1` for replay. `?benchmark=1&presentation=bitmap` selects the comparison path.

## Earlier texture result

Ichiro (Roy), Donald Trump (Falco), and Michelangelo (Link), on Brinstar Depths, now use 512×512 RGBA8 body textures. The previous three-custom-fighter shortcut selected 256×256 CMPR textures. Comparing the same assets in the old and upstream renderers reproduced the blocky eyes and face detail in both. Restoring the larger, uncompressed assets visibly removes those artifacts.

The upstream browser stage/fighter heap grows from 0x64b400 bytes (6.3 MiB) to 16 MiB within the existing 96 MiB arena. Without that change the full-quality lineup exhausted this particular heap: a 1,136,736-byte allocation had only 690,688 bytes free. Native upstream heap sizes are unchanged.

## Stall fixes

- Upload used GPU bytes through a reusable ordinary ArrayBuffer instead of submitting a view of the shared, growable WASM heap. The trace previously showed 225–238 ms inside individual queue uploads.
- Reuse shader modules across blend/depth pipeline variants on the same browser GPU device.
- Skip the unused browser ImGui frame/font work (approximately 199 ms in the startup trace); browser controls live in React.
- Open the audio device during disc setup, before match launch. The original trace spent approximately 424 ms constructing AudioContext.

## Targeted validation

Normal headed Chrome audio output was enabled, with no audio-disable flag. Fresh Chrome profiles were used; OS/GPU caches were not purged. The two traced runs both captured startup screenshots. The final run omitted tracing and repeated startup captures to reduce measurement overhead.

| Measurement | Before, traced | After, traced | Final, unprofiled |
|---|---:|---:|---:|
| Click to match | 5.453 s | 4.495 s | 4.191 s |
| Gameplay FPS, 30 s | 58.93 | 59.67 | 59.77 |
| p99 frame time | 22.37 ms | 18.70 ms | 23.65 ms |
| Longest frame | 270.80 ms | 130.77 ms | 76.62 ms |
| Audio underrun samples | 0 | 0 | 0 |

The final run passed the normal FPS/audio gate and an additional maximum-frame gate of 100 ms. A separate default-launcher run passed keyboard movement, attack, and release checks. The browser session unit test and TypeScript/Vite build passed. The repaired build was also launched in the in-app browser and observed reaching 60 FPS after startup (its saved lineup/stage differed, so that observation is not the controlled benchmark).

This is a focused case study. Occasional short hitches remain, and this result does not establish zero stalls on every stage. The original-port test overlapped a compile job and is used only for image comparison, not timing.

## Reproduce

From the integration worktree, with the upstream server running on port 5191:

```sh
NODE_PATH=engines/melee/build/test-tools/node_modules \
MELEE_TEST_URL='http://127.0.0.1:5191/?benchmark=1' \
MELEE_WINDOWS=1 MELEE_CASE_STUDY=1 MELEE_LINEUP=custom MELEE_STAGE=15 \
node engines/melee/tools/validate_local_disc.cjs /path/to/melee.iso build/case-study 3
```

Use `MELEE_TRACE=1 MELEE_CAPTURE_STARTUP=1` for the visual/profile comparison. Use the URL without `benchmark=1` and `MELEE_INPUT_ONLY=1` for real keyboard validation. The case-study switch fixes the three fighter identities/movesets; it does not change production lineup settings.

Raw summary and artifact hash: [case-study.json](case-study.json).

Local image evidence:

- [Before](../../build/ichiro-before/startup-2.png)
- [Old port, same compact assets](../../build/ichiro-original/startup-4.png)
- [After](../../build/ichiro-after-2/startup-2.png)

Full traces and network/event logs remain under `engines/melee/build/ichiro-*`; game images and disc assets are not included in the source commits.
