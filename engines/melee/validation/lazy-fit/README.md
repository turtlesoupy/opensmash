# Lazy fitting feasibility benchmark — 2026-09-16

The experiment supports pursuing lazy, cached fitting. It does **not** establish
end-to-end native preparation or game startup latency. No production path changed.

## Measured results

Reference: existing Python/NumPy fitting on this Apple Silicon Mac. Three actual
characters (Abraham Lincoln, Alan Turing, Rob Zombie), seven targets, three samples
per target and preprocessing mode. Source preprocessing and DAT construction are
timed separately. These are ranges of per-character medians, not frame-time tails.

| Target | Fit with source-only normals already prepared |
| --- | ---: |
| Mario | 115–120 ms |
| Fox | 27–34 ms |
| Bowser | 78–95 ms |
| Zelda | 83–108 ms |
| Popo | 52–73 ms |
| Kirby | 206–671 ms |
| Jigglypuff | 219–1,215 ms |

Source GLB decoding separately took 69–199 ms, normal smoothing 29–65 ms, and
presentation artwork generation 68–117 ms. These are opportunities to do work
once per source character, independent of moveset. This experiment reused normals
only; it did not supply cached target profiles. Mario's existing profile function
still rereads the source mesh, so some avoidable decode work remains in its fit.
DAT construction from a fitted mesh took 43–104 ms; this is not the full hosted
conversion path (subprocess startup, upgrades, compression, and publication).

A lightweight scan of 1,067 local `play/ui/*/rigged.glb` sources found 2,387–3,670
vertices (median 2,629; p90 2,796; p99 3,070). Rob Zombie is the largest source in
that set. The benchmark therefore includes the observed upper end of the local
catalog, not just handpicked small meshes. This is not a production catalog audit.

Browser: Chrome 152.0.7977.83, headless, actual dedicated workers. A small C++
kernel compiled to WASM implements affine vertex/normal conformation, target
joint mapping, and merged normalized weights. The profiles, matrices, and smoothed
normals were provided by the reference implementation. Across 15 cases:

- Warm kernel means: 0.039–0.072 ms per character (30 batches of 100 calls).
- First kernel call in each fresh worker: 0.2–0.5 ms, coarsely timed.
- Module initialization: 1.9–6.9 ms; fixture fetch/JSON decode: 2.9–9.4 ms on localhost.
- Input allocation/copy is separately recorded; it is not GPU upload.
- IndexedDB write: 0.5–2.3 ms. Read and materialize after page reload: 0.4–1.1 ms.
- Cached fitted geometry/weights: 203–294 KB, excluding textures/presentation.
- All 15 cached outputs retained their SHA-256 after reload.
- Maximum position difference from reference: about 1.4e-14 model units; normal
  difference below 4e-16; stored float32 weights and joint mappings matched.

Kernel times are **not complete fitting times**: anatomical mapping, profile
solving, source decoding, round-body fitting, and clearance optimization were not
ported. The kernel uses benchmark-controlled, prevalidated inputs and is not a
safe general-purpose asset parser or production engine interface. Its 16.1 MiB
WASM heap is capacity, not measured peak browser memory. The cache check measures
storage access, not worker creation, full texture loading, or visible gameplay.

## Interpretation

The vertex math is cheap. The remaining important work is selecting and solving
the fit. Profiling Lincoln/Kirby identified the hand-clearance optimizer as the
largest fitting component (about 59% of profiled `profile_for` time, including
thousands of objective evaluations). That calculation depends on both character
geometry and target poses; caching source normals alone cannot eliminate it.

The next implementation experiment should port the complete fit for an ordinary
target **and a round fighter**, retaining geometry checks, before claiming one
uniformly fast first-use path. Cache each requested source-revision/target/fit-
version combination afterward. These results do not justify prebuilding all
1,000 × all-target combinations, nor skipping clearance checks. They also do not
attribute or solve GPU pipeline-compilation stalls.

## Reproduction

From the OpenSmash repository root, with the existing Python converter dependencies
and a locally extracted, verified USA 1.02 disc:

```sh
python3 engines/melee/tools/benchmark_lazy_fit.py \
  --source play/ui/abrahamlincoln --source play/ui/alanturing --source play/ui/robzombie \
  --targets mario fox bowser zelda popo kirby jigglypuff --repeats 3 \
  --fixtures engines/melee/build/lazy-fit-benchmark/fixtures \
  --output engines/melee/build/lazy-fit-benchmark/results.json

"$MELEE_EMSDK/upstream/emscripten/em++" engines/melee/tools/lazy_fit_kernel.cpp \
  -O3 -ffp-contract=off --no-entry -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker -s ALLOW_MEMORY_GROWTH=1 \
  -s 'EXPORTED_FUNCTIONS=["_fit","_malloc","_free"]' \
  -o engines/melee/build/lazy-fit-benchmark/fit.mjs

PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
  node engines/melee/tools/benchmark_lazy_fit_browser.mjs engines/melee/build/lazy-fit-benchmark
```

Emscripten 3.1.61 was used. Run these commands sequentially without another build
or benchmark competing for resources. Each reference source/target runs in a
fresh process with a 90-second timeout, and alternates preprocessing order.
File and OS caches are not purged. Browser kernel samples are batched means, not
single-call p95 latency. Browser fixtures are only generated for affine targets;
the round-fighter measurements are reference-only. Popo is measured alone, not a
two-body match; Zelda transformation into Sheik is not tested here.

Geometry gates and exact before/after source-preprocessing output hashes passed
for all 21 reference cases. Ball fits intentionally change head/body proportions,
so they preserve the existing exception to the head-fraction gate. No screenshots
or gameplay equivalence are claimed. Detailed logs, generated fixtures, and WASM
remain in ignored `build/`; only code and numeric measurements belong in GitHub.
