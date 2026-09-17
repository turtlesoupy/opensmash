# Safari production-shell acceptance — 2026-09-17

Tested the built full website at localhost:5299/melee using Safari 26.5.2 on
macOS 26.5.2, Apple M5, 32 GB. Local USA 1.02 disc, normal roster click, Auto
960×720, WebGPU, four fighters (three custom), Brinstar Depths. No custom test
page, browser security override, server-side disc, or console-triggered launch.
Production deployment itself was not performed.

## Fixes

- COOP same-origin + COEP require-corp enable Safari shared memory. Cross-origin
  portraits/audio request CORS; production public assets were checked against
  both configured site origins. Unsupported credentialless trailer embedding
  falls back to a normal watch link.
- Without moveBefore, verify the local disc without standby WASM and mount the
  sole game iframe directly in its final parent. Chromium retains warm mounting.
- Resume audio on trusted input. Await the audio processor ready handshake and
  fall back to main-thread playback on processor initialization failure.
- Pass the audio ring by same-origin reference. A Safari probe showed that
  window.postMessage delivered an ordinary ArrayBuffer with unshared writes.
- Bound post-Asyncify wasm-opt inlining to reduce Safari optimizing-compiler
  register-allocation pressure. Before this, the WebContent process grew beyond
  7 GiB and Safari reloaded the page; the revised build survived a complete match.

## Results

Final audio-enabled launch: 7,305 ms click-to-match telemetry. Shared isolation
true. Three successive 30-second combat windows:

| Window | FPS | p99 ms | Max ms | Audio samples rendered | Underrun samples |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 59.43 | 22.26 | 247.00 | 1,440,768 | 0 |
| 2 | 59.16 | 24.62 | 102.62 | 1,440,512 | 0 |
| 3 | 58.03 | 23.80 | 676.16 | 1,440,000 | 14,130 |

Inspector was opened briefly to read counters during this run, so window 3 is
not an uncontaminated performance baseline. Audio peak was nonzero (1); the
producer and consumer counters advanced. Occasional long hitches remain.
Earlier bounded-inlining run with audio still broken: 59.84/59.43/59.92 FPS;
process RSS sampled over 100 seconds was 1.44–1.90 GiB. After reload and the
audio-enabled run, RSS was 2.62 GiB; WASM heap remained 256 MiB. These are process
measurements, not a claim of a strict memory bound or mobile performance.

Validation includes frontend production build, TypeScript check, shell tests,
frame mounting/shared-ring tests, audio startup/fallback tests, and engine
standby/preparation tests. Android's earlier measurements predate these Safari
changes; they are not a fresh Android acceptance result.

Chromium regression: Chrome 152 loaded the embedded trailer under require-corp,
completed local-disc verification/storage and keyboard onboarding, then rendered
a four-fighter match in the full shell with its audio-playing indicator active.
A hard reload was needed after replacing local dist assets during development;
this was a stale dynamic-import URL, not an engine boot failure. No fresh Chrome
performance benchmark was recorded in this pass.
