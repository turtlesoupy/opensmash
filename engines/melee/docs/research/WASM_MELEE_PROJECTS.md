# Browser Melee implementation survey — September 12, 2026

The reviewed projects do not establish a comparable four-player, full-quality,
60-distinct-frame Melee result. This is a statement about evidence found, not a
claim that no such project exists. Search included web search, the GitHub
repository API, and direct inspection of primary project documentation/source.
Published figures below were not remeasured on our M5.

| Project | What executes | Performance evidence and relevance |
| --- | --- | --- |
| [wasm-dolphin](https://github.com/dougchansan/wasm-dolphin) | Dolphin with a custom PPC-to-WASM JIT; software rasterizer plus WebGPU presentation; current auto-profile selects hardware for Melee | Real Melee, but its audit distinguishes roughly 59.7 presentations/s from 12.8 distinct visual frames/s. Hardware WGPU remains slow/experimental. GPR locals and synchronized callback boundaries are worth testing. |
| [melee-web](https://github.com/frankischilling/melee-web) | Planned Gecko/WebGPU integration with local disc validation | README explicitly says browser boot, audio and playable performance are not verified. No usable FPS comparison yet. |
| [100-man-melee](https://github.com/benstrumeyer/100-man-melee) | JavaScript Melee Light derivative | Claims 60 FPS on capable hardware; recreates movement/physics rather than executing the retail PPC program. Its performance does not establish original-game emulation throughput. |
| [Melee Light](https://github.com/schmooblidon/meleelight) | JavaScript/canvas platform-fighter recreation | Useful browser-game reference; a different execution and fidelity scope. |
| [Slippi Lab](https://github.com/frankborden/slippilab) | Browser replay viewer | Replay visualization does not benchmark full game simulation/emulation. |
| [Gecko](https://github.com/ioncodes/gecko) | Rust GameCube/Wii emulator with a browser build | Native Cranelift JIT support and the existence of a web target do not by themselves prove a working browser JIT or sustained browser Melee FPS. |

## Most relevant primary evidence

The [wasm-dolphin July 10 audit](https://github.com/dougchansan/wasm-dolphin/blob/main/docs/performance-audit-2026-07-10.md)
used a fixed Kirby/Link save on a Ryzen 9 9950X3D, Windows and headed Chrome.
It separates game timing, presentation and unique-frame production. Its
[qualification package](https://github.com/dougchansan/wasm-dolphin/blob/main/docs/perf-results/melee-performance-evidence-2026-07-10.md)
labels the default run a failure of its strict gate. Its
[current status](https://github.com/dougchansan/wasm-dolphin/blob/main/docs/current-status.md)
also describes the hardware renderer as far from full speed. These are useful,
candid results, not proof that the browser problem is solved.

The [README's register-cache section](https://github.com/dougchansan/wasm-dolphin#cpu-the-powerpc--wasm-jit)
describes a historical 38% raw-throughput improvement but explicitly says a
current repeated A/B has not reproduced it. Do not transfer that percentage to
our AOT runtime. Source inspected at commit
`1f2e571b2d07e6097aae08f5784a1ebc2b517067`, particularly
`patches/dolphin-wasm/snapshot/0003-ppc-wasm-jit.patch`.

## Local follow-through

A rejected private experiment under `build/wasm-research/regcache/` kept GPRs in C locals
that compile to WASM locals in seven profiled DolRecomp regions. It preserves
synchronization around state-observing helpers, MMIO and write journaling;
ordinary non-aliasing RAM accesses can retain cached GPRs. Unsupported dynamic
GPR-index shapes are rejected. This is new implementation inspired by the
register-cache design; no upstream JIT source was copied into the product.

The instrumented original and transformed regions passed 14,000 bounded
full-CPU/RAM/callback comparisons each in native and WASM builds. This is a
correctness screen, not a gameplay speedup claim. Gameplay results must be
recorded separately before retaining a product optimization.

The seven-region gameplay screen was rejected: all-stock windows were 37.06, 37.57, 37.87, 33.52 FPS; injected windows were 43.80, 44.61, 45.33, 43.87 FPS. These did not improve the prior scalar ranges (37–39 stock,
44–47 injected). Both runs had audio, zero recorded underruns and no reported
runtime errors. The prototype was never added to the product source/build
script; its private CMake override, source and executable were removed. Exact windows and build identity
are in `build/wasm-research/regcache/summary.json`. No 60 FPS success is claimed.

Our existing FPS counter is driven by Dolphin's EFB-to-XFB frame event, not a
60 Hz canvas repaint timer. That avoids the specific repeated-presentation
measurement pitfall above, although it is not an independent pixel-uniqueness
measurement. The browser renderer sends its bitmap when it swaps the canvas.

## Local wasm-dolphin check

The same source commit was launched on this Apple M5 with the local USA 1.02 ISO,
headed Chrome and metrics enabled. Its auto-profile selects hardware WebGPU for
Melee while the settings panel still displays Software. JIT activated. A short
Ness/Pikachu Pokémon Stadium combat sample reported 57–75% game speed and 14–41
presentation FPS. This was a smoke test, not a matched four-player benchmark;
the HUD's separate visual count was not independently verified. Measurements
and screenshots are under `build/wasm-research/live-check/`. The older published
software-path results above describe a different rendering configuration.
