# Direct-C browser backend

This backend compiles the complete pinned Melee source port to WASM32. It runs the
Melee game and HSD code directly, with browser implementations of DVD, controllers,
VI pacing, GX rendering and audio output. The shared OpenSmash launcher selects it
with `?engine=direct-c`; its existing backend remains available without that query.

## Build and run

From the repository root, with Emscripten 3.1.61 installed:

```sh
export MELEE_EMSDK=/absolute/path/to/emsdk
python3 engines/melee/tools/build_direct_c.py --dol /absolute/path/to/main.dol
npm --prefix engines/melee/web ci
npm --prefix engines/melee/web run typecheck
python3 engines/melee/tools/serve_melee.py --direct-c --port 5189 \
  --characters /absolute/path/to/character/library \
  --iso /absolute/path/to/Melee-USA-1.02.iso
```

In a second terminal, start the unified website (install its dependencies first):

```sh
cd web-prototype
npm install
MELEE_LOCAL_ORIGIN=http://127.0.0.1:5189 npm run dev
```

The launcher server uses the existing extracted `engines/melee/assets/game` files
for custom-character preparation. The runtime verifies the complete disc SHA-256 and reads the user's ISO locally in the
browser; the ISO is not uploaded. Open <http://127.0.0.1:4174/melee?engine=direct-c> and
choose that ISO. Use the normal roster, settings, controllers and play controls.

For the isolated stock-game diagnostic UI, without a character library:

```sh
python3 engines/melee/tools/serve_direct_c.py --port 5188
```

Open <http://127.0.0.1:5188/>. This diagnostic defaults to CPU Mario versus Peach.
WASD, J/K, Space and Enter are available when port 1 is configured as human.
`?fast` is an unpaced diagnostic: it speeds up simulation and is not a 120 Hz
version of Melee. Normal play preserves the game's 60 Hz simulation.

## Boundaries

- The upstream revision is in `upstream.json`. Source is fetched into `build/`,
  then copied and transformed there. No game executable or disc assets are committed.
- Game/HSD code remains at O0 because the upstream decomp contains optimization-
  sensitive code. The browser runtime is O2. The build records its inputs and WASM
  digest in `build/direct-c/melee-direct-build.json`.
- All game logic, stage logic and fighter logic uses native C calls. The small
  `CPUState` structure in `presentation.c` adapts existing presentation helpers;
  it does not execute or dispatch PowerPC instructions.
- The shared OSUI, OSSK and OSCS asset formats carry custom body geometry,
  skinning weights, stock art, results identity, character-select pages and names.
  Existing presentation helpers are reused with native global accessors.
- `skinning.c` evaluates exact stored weights against live game joints. Its first
  draws check blended matrices against HSD's ordinary envelope implementation.
- Rendering uses the source port's GX-to-WebGL path, with explicit vertex/index
  buffers. This is a separate renderer and mixer from Dolphin; it is not a claim
  of bit-exact console emulation.
- Full-disc verification uses the SHA-256 subset of Mbed TLS 2.28.0 (Apache-2.0),
  streaming a 1 MiB buffer; a previously verified immutable File can be reused.
- Audio retains the source port's AX mixer and feeds a shared stereo ring. A small
  independent WASM module runs Sonic on the audio consumer, preserving pitch
  while adjusting tempo when the game/render worker stalls.
  The direct-C queue targets 128 ms of audio to absorb browser scheduling stalls.
  The shared launcher falls back to ScriptProcessor audio if worklet loading fails
  or stalls, adding a 1024-sample callback buffer on that fallback path.
- First-scene preparation pauses simulation while drawing warms up. Saves use a
  separate IndexedDB filesystem mounted at `/saves`, in the source port's format.

## Validation

See [VALIDATION.md](VALIDATION.md) for measured results and remaining accuracy limits.

```sh
python3 engines/melee/tools/validate_direct_support.py
node engines/melee/tools/validate_direct_audio.mjs
python3 engines/melee/tools/validate_direct_c.py --iso /absolute/path/to/disc.iso
node engines/melee/tools/validate_direct_render_matrix.cjs /absolute/path/to/disc.iso
python3 engines/melee/tools/prepare_direct_fixture.py
python3 engines/melee/tools/validate_direct_flows.py --iso /absolute/path/to/disc.iso
node engines/melee/tools/validate_direct_ui_flows.cjs /absolute/path/to/disc.iso
node engines/melee/tools/validate_direct_custom_matrix.cjs /absolute/path/to/disc.iso
python3 engines/melee/tools/benchmark_direct_c.py --wait-for-compilers --iso /absolute/path/to/disc.iso
```

The browser tools expect Playwright at `engines/melee/build/test-tools/node_modules`
(which can be installed with `npm install --prefix engines/melee/build/test-tools playwright@1.55.0`).
They launch isolated Chrome profiles. Coverage logs, snapshots, images and timing
reports are written under `engines/melee/build/direct-c/`; tests fail on missing
combat, invalid state, missing rendering or runtime errors. Headless elapsed time
is a simulation diagnostic, not rendered FPS.

The fixture preparation tool calls the normal local launcher API. It requires the
Alan Turing, Abraham Lincoln, Steve Jobs and 50 Cent entries in the character
library. It writes only ignored local build assets. The results/Classic browser
checks use the diagnostic server on port 5188; fixture preparation and benchmarks
use the shared launcher on port 5189. Benchmark comparison also requires the
existing backend's build and system bundle on that server.

The benchmark runs four cases sequentially: two players (custom Alan Turing plus
stock Fox) and four custom players, each through both backends. Each case uses a
fresh Chrome profile, the same launcher assets, three 30-second combat windows,
and the existing FPS/frame-time/audio gate. Stop other builds and games first.
Reports retain gate failures, audio consumption, frame-time tails and errors.

For unpaced headroom, run `node engines/melee/tools/benchmark_direct_headroom.cjs
/absolute/path/to/disc.iso` after other tests finish. This separate diagnostic
runs stock Mario/Peach and the compact four-character Mario/Fox fixture, disables
audio, and reports both simulation FPS and submitted bitmap FPS. It speeds up the
game; normal play remains 60 Hz. These are four-player workloads, not a claim of
hundreds of players or a change to Melee's player limit.
