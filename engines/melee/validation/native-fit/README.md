# Full native fitting benchmark

Measured locally on macOS/Apple Silicon in Chrome 152.0.7977.83, using C++ compiled to WASM in a dedicated browser worker. Six source characters × Fox, Kirby and Jigglypuff = 18 cases, seven complete fits in a fresh worker per case. No Python runtime, converter service, solved character profile or cached hand offset participates in browser fitting.

| Target | First fit range | Repeat median range |
| --- | ---: | ---: |
| Fox | 2.6–6.6 ms | 0.8–1.2 ms |
| Kirby | 12.3–29.7 ms | 6.6–22.9 ms |
| Jigglypuff | 11.7–47.3 ms | 5.8–36.8 ms |

Times include input validation, copying into WASM, the full fit, and copying results out. Module initialization and local JSON fixture loading are recorded separately in [results.json](results.json). These are fitting measurements, not end-to-end character loading or gameplay frame times. The six sources are Abraham Lincoln, Alan Turing, Rob Zombie, 50 Cent, Donald Trump and Mahatma Gandhi. This is not a 1,000-character or concurrent-load benchmark.

Kirby/Jigglypuff include native hull construction, posed hand samples, both bounded hand optimizations, and final geometry/envelopes. The native implementation avoids a redundant humanoid solve and accelerates the exact clearance objective without reducing pose coverage. Fox includes the ordinary anatomical fit, head solve and terminal refinement; its source-only smoothed normals are supplied as input.

All 18 cases passed geometry, envelope and solver checks against the existing Python/SciPy offline oracle. Browser output matched native-host positions, normals and weights exactly. Round-hand clearance did not regress within the validation tolerance. Native/Python geometry is compared with explicit tolerances because their source-origin precision differs; see the implementation README. All 72 malformed browser-input checks passed. Synthetic native tests passed AddressSanitizer and UndefinedBehaviorSanitizer, including invalid geometry/rig inputs.

## Recommendation and scope

Use native lazy fitting for a common character–moveset preparation flow, then cache by source content, target calibration and fitter version. Prepare source-only data once per character. These measurements support that direction without eagerly building every combination. They do not establish full-roster compatibility: only Fox, Kirby and Jigglypuff are validated. Next integration work is the engine input/output adapter and testing the remaining target rigs and attachment/transformation paths.

The shipping launcher remains unchanged. The GLB decoder, DAT writing/engine attachment, downloads, shader compilation and GPU upload are outside this benchmark. No game-derived fixtures or binaries are added to the repository; they remain in ignored build output. Build and test tools use Python offline; the native fitting execution path does not.

See [implementation and reproduction steps](../../runtime/fitting/README.md). [Raw numeric measurements and build hashes](results.json) preserve all seven browser timings per case; ranges above are descriptive samples, not latency guarantees or confidence intervals.
