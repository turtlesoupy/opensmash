# Melee PC browser upstream

The browser launcher now uses the source port in
[turtlesoupy/opensmash-melee-pc](https://github.com/turtlesoupy/opensmash-melee-pc),
a history-preserving fork of [999sian/melee-pc](https://github.com/999sian/melee-pc).
`upstream.json` pins an exact tested fork commit. Game logic, GX rendering through
Aurora/WebGPU, AX mixing, and memory-card support are built from that checkout.
OpenSmash retains its launcher, local disc verification, custom costumes,
announcer/intro/results presentation, and controller settings.

## Build and run

Install Python 3, CMake, Ninja, LLVM 22 with LibTooling, GCC 16, and Node 22.13+.
On Apple Silicon the compiler defaults to Homebrew LLVM 22; set `LLVM_ROOT` on
other systems. The build script clones the pinned fork into the sibling
`melee-pc` directory unless `MELEE_PC_ROOT` specifies a different checkout.
It never resets an existing checkout to a different revision.

```sh
python3 engines/melee/tools/build_upstream.py --jobs 6
npm ci --prefix engines/melee/web
npm run typecheck --prefix engines/melee/web
python3 engines/melee/tools/serve_melee.py --upstream --port 5191 \
  --characters /absolute/path/to/exported/character/library
```

In a second terminal, start the unified website (install its dependencies first):

```sh
cd web-prototype
npm install
MELEE_LOCAL_ORIGIN=http://127.0.0.1:5191 npm run dev
```

Open `http://127.0.0.1:4174/melee` and select your unmodified USA 1.02 disc locally.
No ISO is bundled or uploaded. The existing verified-file reuse and bounded
chunk reads are retained. The upstream runtime uses a 32 MB disc-block cache.
The browser requires WebGPU, shared memory, and cross-origin isolation.

`?engine=upstream` is explicit; `?engine=direct-c` selects the prior direct-C
comparison backend if its artifacts are installed. The native desktop engine
continues to use its existing separate build and release pipeline.

## Periodic upstream sync

In the fork checkout, add `upstream` as `https://github.com/999sian/melee-pc.git`
if it is absent, then:

```sh
git fetch upstream
git switch -c opensmash/sync-YYYY-MM-DD opensmash/browser
git merge --no-ff upstream/master
python3 tools/browser/build.py --jobs 6
```

Resolve source conflicts and update `tools/browser/upstream.json` to the merged
upstream revision. Run the fork's roster/stage/custom/mode tests and the shared
launcher benchmarks below. Commit and push the reviewed fork branch, then
update this repository's `upstream.json` to that exact commit. Preserve merge
history so subsequent syncs can use Git's common ancestor normally.

The browser compiler lowers only big-endian `DISC_STRUCT` accesses; runtime
structs stay native endian. It also matches upstream's CP932 string encoding,
signed overflow, and disabled floating-point contraction. Compiler oracles
compare values and raw bytes against GCC before the game build.

## Launcher benchmark

Use Playwright with installed Chrome and a local ISO. Each run measures three
consecutive 30-second combat windows at 960×720, after scene preparation:

```sh
NODE_PATH=/absolute/path/to/playwright/node_modules \
MELEE_TEST_URL='http://127.0.0.1:5191/?engine=upstream&benchmark=1' \
MELEE_WINDOWS=3 MELEE_STRICT_WINDOWS=1 MELEE_LINEUP=stock MELEE_REPLAY=1 \
node engines/melee/tools/validate_local_disc.cjs /absolute/path/to/melee.iso build/bench-2 2
```

Repeat with `MELEE_LINEUP=custom`, output `build/bench-4`, and final argument `4`.
The gates are ≥58.5 FPS, p95 ≤20 ms, p99 ≤33.34 ms, no measured audio underruns
or overruns, and rendered audio covering ≥95% of wall time. Network recording
also checks that the disc stays local; replay checks reuse of the verified File.

On this validation host Chrome's physical output device clock stalled even for
a standalone oscillator. `MELEE_CHROME_ARGS=--disable-audio-output` enables
Chrome's render clock for the automated audio tests; it still runs the real
AudioWorklet/Sonic consumer, but does not validate physical speaker playback.
See the checked-in validation report for measured results and coverage.
