# Repositories and fresh-checkout setup

`opensmash-melee` contains the playable local website, character conversion,
native launcher, validation tools and all port-specific runtime patches. The
matching decompilation is pinned as the `melee` submodule. MeleePad and its
ModernGekko dependencies are fetched at the revisions in `runtime/upstream.json`;
patches under `runtime/patches/` are applied by the build scripts. A separate
GitHub runtime fork is not required to reproduce this checkout.

The existing OpenSmash generator is at https://github.com/turtlesoupy/opensmash.
Its BattleShip engine is not a runtime dependency of the Melee port. The old
hosted gallery and combat-clip pages are not part of local development.

## Source-only checks

```sh
git clone --recurse-submodules https://github.com/turtlesoupy/opensmash-melee.git
cd opensmash-melee
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
npm ci --prefix web
python3 -m unittest discover -s tests
node --test tests/*.test.mjs
npm run build --prefix web
```

Node 22.13+ is required. Python tests needing local ROM/character fixtures skip
when those fixtures are absent. The web UI compiles without a ROM; playing the
game requires the local runtime and verified assets below.

## Native build

On Apple Silicon macOS 14+, install Xcode Command Line Tools, CMake and Ninja,
then run `python3 tools/build_native.py`. The ROM picker and full-image hash check
run before build work. See [NATIVE.md](NATIVE.md) for packaging and validation.
The source-only native build includes standard Melee fighters; prepared custom
costumes are included when available locally.

## Playable browser build

Install Emscripten 3.1.61 using the official emsdk. Set `MELEE_EMSDK` to that SDK's
root directory (the directory containing `.emscripten` and `upstream/`). The
existing sibling `../opensmash/emsdk` layout remains a supported default.

```sh
export MELEE_EMSDK=/absolute/path/to/emsdk
export MELEE_ISO=/absolute/path/to/your/melee-usa-1.02.iso
python3 tools/build_native.py --rom "$MELEE_ISO" --verify-only
python3 tools/prepare_moderngekko.py "$MELEE_ISO"
python3 -m opensmash_melee prepare-game build/browser-engine/meleepad/ref/ModernGekko-Template/extracted/Super-Smash-Bros-Melee-GALE01-r2
python3 tools/build_recomp_browser.py
python3 tools/serve_melee.py --iso "$MELEE_ISO" --characters /absolute/path/to/exported/play/ui
```

In another terminal run `npm run dev --prefix web`, then open
http://127.0.0.1:5174/. The native preparation step above builds the pinned tools
and extracts the verified game; `prepare-game` imports that extraction. It
refuses to overwrite an existing `assets/game` directory.

The committed catalog and thumbnails display the roster. Playable source rigs
are separate local generation artifacts; cloning OpenSmash alone does not fetch
them. Supply your exported library with `--characters` or
`OPENSMASH_CHARACTER_ROOT`. Each slug directory needs `rigged.glb`,
`character.json`, `portrait_raw.png`, `stock_raw.png`, `emblem_raw.png` and
`announcer.wav`. The existing `../opensmash/pipeline/play/ui` layout also works.

ROMs, extracted game files, converted costumes, generated PPC/native/Wasm game
modules, captures and local validation outputs are excluded from Git. Runtime
patches retain their upstream source notices; their upstream projects and
pinned revisions are recorded in `runtime/upstream.json` and `.gitmodules`.
This repository does not assign a new license to upstream code or assets.

See [LAUNCH_MODES.md](LAUNCH_MODES.md) and [PERFORMANCE.md](PERFORMANCE.md) for
functional coverage and the remaining FPS gaps.
