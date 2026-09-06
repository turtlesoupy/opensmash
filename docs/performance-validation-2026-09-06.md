# Renderer performance validation — September 6, 2026

The scalar renderer optimizations improve the measured desktop Chrome workload.
They do not establish a mobile performance or stability fix. In the user's mobile
Safari test of the updated local preview, gameplay looked the same, speed was not
clearly better, and crashes still occurred several times. The cause of those
crashes remains unknown; no crash trace establishes whether they are regressions.
Mobile Chrome reports of poor FPS also remain unresolved on real devices.

## Accepted implementation

The engine retains 64-vertex custom mesh windows, paired triangles, mesh cache
reordering, renderer state/packed-vertex reuse, specialized common-material
packing, guarded game-quad presentation, sampler-state tracking, DL gap caching,
and removal of unnecessary Wasm GL flushes. SIMD remains opt-in and OFF by default.
SSB64_MESH_CACHE_ORDER=0 restores original triangle order. Existing general renderer
and menu presentation fallbacks remain available.

The website fixes a reduced-motion transition that left the menu backdrop filter
active during gameplay. An opt-in `?perf=1` recorder downloads a local 30-second
performance report. Add `SSB64_FRAME_PROFILE=1&SSB64_STALL_WATCH=1` to the outer URL
for engine profiling. Reports are not automatically uploaded.

## Evidence and limits

On Apple M5, headed Chrome 152 / ANGLE Metal with 6x CPU throttling, three final
900-tick cases measured 59.99–60.00 simulation FPS, 59.92–59.98 render opportunities
per second, and 19.06–25.68 ms p95 tick intervals. This is not a low-end phone
emulator, a physical scanout measurement, or a locked 16.7 ms cadence.

Corrected end-of-render captures compared 36 nonblank frames. Against the
original-order scalar control, 28 were exact and eight differed by 1–11 pixels:
42 changed pixels out of 39,323,520 total, maximum channel difference 21/255.
Inspection found small clothing/limb shading seams, with no observed changes to
poses, silhouettes, stages, effects or HUD. The HUD region was exact in every
frame. The user reviewed screenshots and accepted the small ordering differences.
All 36 frames matched the prior optimized scalar build exactly. Earlier blank
captures were invalid and are not evidence. Sampled screenshots cannot exclude
unsampled flicker or device-specific differences.

At 12x CPU throttling, the custom workload remained about 28.4 FPS at both 1280
and 640 render widths; vanilla fighters reached about 58.2 FPS. Explicit desktop
SwiftShader testing improved from about 28.4 to 53.8 render opportunities/s when
reducing width to 640. These separate CPU-bound and software-GPU-bound cases;
they do not identify the user's Safari bottleneck or imply Android uses SwiftShader.

Native and Wasm builds, mesh topology/opt-out and DL range invalidation tests,
menu fallback, CRT transitions in both motion modes, and recorder smoke checks
passed. Final scalar Wasm SHA-256:
`fc2807bdb9c1dc3938e3f9acc03d5966fc3057dc0e4872a87a446661f44a108e`.

## Reproduction tools

Use Node with Playwright installed (or set PLAYWRIGHT_PATH to its package path)
and an installed Chrome. From the pipeline repository:

```sh
node web-prototype/scripts/perf-crt-state.mjs
node web-prototype/scripts/perf-capture-smoke.mjs
node web-prototype/scripts/perf-60fps.mjs
```

The benchmark expects the sibling BattleShip checkout, a packaged web-dist,
locally built build-us/BattleShip.o2r from your ROM, and the named custom bundles.
PERF_ENGINE_ROOT and PERF_BUILD_ROOT select packaged runtime and executable inputs;
PERF_OUTPUT selects results. The harness binds only to loopback and stages your
local archive for testing. Run benchmarks serially without other heavy work.
The screenshot comparator rejects blank captures. Source scripts and this compact
record are committed; large raw logs, screenshots and abandoned experiments stay
local under eval/performance/2026-09-06-visual-review and
2026-09-06-mobile-local.

Next evidence needed: a device/browser/OS identifier, a recorded slow match, and
crash diagnostics or reproducible steps on an affected phone. Do not mark the
mobile FPS or crash issue resolved based on the desktop results.
