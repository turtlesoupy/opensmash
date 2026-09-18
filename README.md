# OpenSmash

Super Smash Bros. 64 and Super Smash Bros. Melee in the browser, with new
fighters from image uploads. Give it a name and (optionally) a photo, and the
pipeline produces a low-poly rigged mesh, a character-select portrait, a stock
icon, a series emblem, and an announcer call. In Smash 64 the result is injected
into the game on one of the twelve original skeletons; in Melee the same fighter
becomes a costume on one of the 26 Melee movesets.

https://github.com/user-attachments/assets/d3a589cf-1443-4926-8914-97371bd40b97

Full trailer: [youtu.be/Uj3N_CbYMHs](https://youtu.be/Uj3N_CbYMHs). Play it at
[smash.fun](https://smash.fun) (Smash 64) and [smash.fun/melee](https://smash.fun/melee).

No Nintendo assets are in this repo or served by the site. The Smash 64 engine
is [BattleShip](https://github.com/turtlesoupy/BattleShip), a decomp-based PC
port, and the game's assets are extracted in the player's browser from their
own ROM. The Melee engine is a pinned fork of the
[Melee PC](https://github.com/999sian/melee-pc) source port built to
WebAssembly, and it reads the player's own disc image in the browser. The few
generator inputs that come from the games (sprites, skeletons, announcer clips,
costume templates) can be rebuilt from your own ROM or disc; see
[Game-derived inputs](#game-derived-inputs).

## Upstream projects

Everything below the site is a chain of forks. We keep our own copies so the
wasm build and the pipeline hooks stay pinned; BattleShip's submodules point
at these copies.

| Our copy | Forked from | What it is |
|---|---|---|
| [turtlesoupy/BattleShip](https://github.com/turtlesoupy/BattleShip) | [JRickey/BattleShip](https://github.com/JRickey/BattleShip) | The PC port. Native macOS/Linux/Windows/Android plus our Emscripten build, the fighter-injection code (`port/`), and the pipeline dump hooks. |
| [turtlesoupy/ssb-decomp-re](https://github.com/turtlesoupy/ssb-decomp-re) | [VetriTheRetri/ssb-decomp-re](https://github.com/VetriTheRetri/ssb-decomp-re) | The game decompilation. Vendored as `decomp/`. |
| [turtlesoupy/libultraship](https://github.com/turtlesoupy/libultraship) | [JRickey/libultraship](https://github.com/JRickey/libultraship/tree/ssb64) ← [Kenix3/libultraship](https://github.com/Kenix3/libultraship) | Rendering, audio, and input layer for N64 ports. Vendored as `libultraship/`. |
| [turtlesoupy/Torch](https://github.com/turtlesoupy/Torch) | [JRickey/Torch](https://github.com/JRickey/Torch/tree/ssb64) ← [HarbourMasters/Torch](https://github.com/HarbourMasters/Torch) | Extracts assets from the ROM into the `.o2r` archive. Also compiled to wasm so the browser can do this. Vendored as `torch/`. |
| [turtlesoupy/opensmash-melee-pc](https://github.com/turtlesoupy/opensmash-melee-pc) | [999sian/melee-pc](https://github.com/999sian/melee-pc) | The Melee PC source port. Our `opensmash/browser` branch adds the Emscripten/WebGPU build, custom-costume slots, and launch hooks. Pinned by `engines/melee/upstream.json`. |
| [doldecomp/melee](https://github.com/doldecomp/melee) | | The Melee decompilation, used as the structure and symbol reference for the costume converter. Submodule at `engines/melee/melee`. |

BattleShip's README has the licenses and credits for the Smash 64 projects.

## Getting the code

Clone the two repos next to each other, with emsdk alongside:

```
opensmash/
  BattleShip/    git clone https://github.com/turtlesoupy/BattleShip
  pipeline/      git clone https://github.com/turtlesoupy/opensmash   (this repo)
  emsdk/         https://github.com/emscripten-core/emsdk
  melee-pc/      cloned for you by engines/melee/tools/build_upstream.py (Melee only)
```

The site server looks for the engine at `pipeline/BattleShip/web-dist`, then
`../BattleShip/web-dist`. Either a symlink
(`ln -s ../BattleShip pipeline/BattleShip`) or the sibling layout works.

What's in this repo:

| | What |
|---|---|
| `pipeline/` | The generator. `run_character.py` turns a name + photo into a playable fighter. |
| `web-prototype/` | The site: React frontend + Node server. Character grid, ROM/disc check, launching either engine (`/` is Smash 64, `/melee` is Melee), and the hosted "create a fighter" flow (Cloud Run, Firestore, GCS). Its own `asset-sources/` and `tools/` hold the site's 3D props, fonts, and the Blender scripts that built them. |
| `engines/` | Per-engine code. `engines/ssb64/` is the BattleShip launch adapter; `engines/melee/` is the Melee engine build, the costume converter, the launcher components, the hosted converter service, and the desktop shell. See [`engines/melee/README.md`](engines/melee/README.md). |
| `skels/` | The twelve Smash 64 target skeletons, per-fighter conform profiles, and the reference part data the converter fits meshes onto. Melee skeletons come from the disc at conversion time. |
| `play/` | Local generation output (gitignored). The production roster lives in a public GCS bucket, pinned by `web-prototype/config/baked-assets.json`. |
| `scripts/`, `tools/` | Batch driver, the derive-from-ROM scripts, sprite extraction, the Wikipedia roster seed. |
| `eval/` | Mesh eval harness (`EVAL.md`). |
| `config/`, `docs/`, `assets/` | Docs and the style references the generator uses. `config/` holds local (gitignored) roster inclusion/exclusion lists. |

## Native and ROM builds with character injection (Smash 64)

Playing on real N64 hardware:

https://github.com/user-attachments/assets/97b41166-8646-4dd5-ab45-80ee5d275297

You can play the Smash 64 side of OpenSmash outside the browser in two ways:
build a **native desktop game** through BattleShip, or create an **experimental
N64 ROM** for an emulator or real console. (For Melee outside the browser, see
[Melee](#melee).) Both can include website fighters and your own custom/private
characters, including their portraits, names, emblems and announcer voices.

Both use `build.py` and the same character-selection arguments. The main
difference is the roster: **native adds pages of custom fighters alongside the
vanilla roster; ROM builds replace existing slots, up to 12, without extra pages.**

For either build, run commands from this repository's root with a current
`BattleShip/` checkout alongside it and its submodules initialized. Put your own
US v1.0 ROM at `BattleShip/baserom.us.z64`, or add `--rom /path/to/baserom.us.z64`
to the commands below. Your ROM stays local. See [build setup](BUILDING.md#checkouts-and-prerequisites)
for prerequisites and other checkout layouts.

### Native: a desktop version of the website's game

The native build runs through BattleShip and includes the full public website
roster by default. Custom fighters appear on additional character-select pages;
use L/R or the on-screen arrows to switch. Once built and downloaded, the game
works offline.

Install [BattleShip's platform prerequisites](https://github.com/turtlesoupy/BattleShip/blob/main/BUILDING.md), then:

```sh
# Build with the full public roster:
python3 build.py native

# Or choose just a few website fighters:
python3 build.py native --characters queen,50cent,abrahamlincoln
```

To include a custom or private fighter, copy **Character download URL** from its
settings on the website. Use `--characters none` to include only your linked
fighters, or specify public fighters to include alongside them:

```sh
python3 build.py native --characters none --character-url 'PASTE_DOWNLOAD_URL'
python3 build.py native --characters queen,50cent --character-url 'PASTE_DOWNLOAD_URL'
```

Character IDs such as `queen` are website slugs. Repeat `--character-url` to add
more links. These options choose the custom roster; native still keeps the
original fighters available. See [custom-character links](BUILDING.md#private-characters-and-copied-links)
for moveset defaults and link details.

**To play**, open `Play.command` (macOS) or `Play.bat` (Windows) in the generated
`build/native-PLATFORM-REGION-CONFIG/` folder. On any desktop platform, you can
also run that folder's `play.py` with Python. For example, on macOS:

```sh
python3 build/native-darwin-us-release/play.py
```

### ROM: bake a loadout into an N64 cartridge image

The ROM build produces `build/rom/opensmash.z64` for an emulator or an N64 flash
cartridge such as EverDrive. Choose a subset of fighters: each replaces one of
the **12 original slots**, while unselected slots stay vanilla. There is no
paginated selector in this build yet.

**The same `--characters` and `--character-url` options work here:** change
`native` to `rom`. Unlike native, select a loadout rather than the full public
roster. First install the extra [ROM build dependencies](BUILDING.md#hardware-rom-select-a-subset),
including `vpk0cmd`:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r hardware-rom/requirements.txt

# Bake selected website fighters into a ROM:
python3 build.py rom --characters queen,50cent --vpk0 /path/to/vpk0cmd

# Or bake in a custom/private fighter:
python3 build.py rom --characters none --character-url 'PASTE_DOWNLOAD_URL' --vpk0 /path/to/vpk0cmd
```

On Windows, activate `.venv\Scripts\Activate.ps1` instead. Omit `--vpk0` if the
tool is installed at `BattleShip/decomp/tools/vpk0cmd` or on `PATH`.

The builder prefers each fighter's website moveset, but may reassign conflicting
slots. Check `build/rom/characters.json` for the actual assignments. For precise
control of replacement slots, see [local loadouts](hardware-rom/README.md).

**ROM support is experimental.** ROM builds use skeletal skinning by default,
blending up to four joint influences per vertex. This requires a MIPS compiler;
mesh detail and loadout size remain limited by memory and performance.
Use `--no-skinning` for the earlier rigid-joint builder.
See [skinning setup and validation](hardware-rom/skinning/FORMAT.md) and
[ROM details](hardware-rom/README.md). Native and website builds are unaffected.

For either target, `--output-dir PATH` keeps different builds separate, and
`--dry-run` previews the build commands. See [BUILDING.md](BUILDING.md) for all
options, including vanilla native builds and local asset loadouts.

## Running the site

You need Node 20+ with pnpm (`corepack enable`), a Super Smash Bros. USA
(NTSC-U v1.0) ROM with SHA-1 `e2929e10fccc0aa84e5776227e798abc07cedabf`
(other regions are rejected), and Emscripten if you're building the engine
yourself. Don't commit the ROM. The steps below get Smash 64 running; the
Melee side of the site is optional and is set up separately in [Melee](#melee).

### 1. Build the engine

From `BattleShip/`, with the ROM at `baserom.us.z64` and emsdk activated
(`source ../emsdk/emsdk_env.sh`):

```bash
emcmake cmake -B build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release -DSSB64_VERSION=us
```

```bash
cmake --build build-wasm --target BattleShip.js -j
```

```bash
scripts/build_torch_wasm.sh
```

```bash
scripts/package_web.sh build-wasm web-dist
```

`web-dist/` is what the site serves under `/engine/`. Every file URL in it
carries a build version, and it does not include the ROM-derived archive;
the browser builds that on first launch (`BattleShip/docs/web_rom_extraction.md`).
After C changes: `ninja -C build-wasm BattleShip.js`, then `package_web.sh`
again.

### 2. Get a roster

Download the production roster (1000+ fighters, ~3.3 GB) into
`web-prototype/.baked-characters`:

```bash
cd web-prototype && PUBLIC_BUCKET=smash-the-weights-fighter-assets pnpm assets:fetch
```

Or generate your own into `play/` (next section). In dev the server reads
`play/` directly.

### 3. Start it

```bash
cd web-prototype && pnpm install && pnpm dev:safe
```

Open <http://127.0.0.1:4174>, drop in the ROM, play. `dev:safe` disables the
local fighter worker so `/create` can't spend credits; `pnpm dev` runs real
generations from the web UI. `/melee` shows the Melee roster but can't launch a
match until the Melee asset service is running (next section). The ROM gate, auth, phone hand-off, and the
hosted generation flow are documented in
[`web-prototype/README.md`](web-prototype/README.md).

## Melee

Melee runs the same generated fighters on Melee's own skeletons and movesets.
Everything Melee-specific lives in [`engines/melee`](engines/melee/); this is
the short version.

**How a fighter gets into Melee.** The converter takes the rigged mesh the
generator already produced, conforms it onto the chosen Melee fighter's
skeleton using the game's own bind matrices, bakes the textures into one atlas,
and writes a real costume `.dat` file. Physics, hitboxes and animations are
untouched Melee data, so a custom fighter borrows one of the 26 movesets. The
default moveset is picked from the fighter's Smash 64 base (Mario stays Mario,
DK becomes Donkey Kong, and so on); a fighter's owner can override it in the
**Melee** setting of the fighter modal on the site. Fitting happens in the
browser with a wasm build of the fitter, so each player's disc supplies the
skeleton templates and nothing game-derived is served for gameplay.

**Playing locally.** You need an unmodified Melee USA 1.02 disc image (ISO or
GCM). Build the pinned engine fork, then run the Melee asset service next to
the site:

```bash
python3 engines/melee/tools/build_upstream.py --jobs 6
```

```bash
python3 engines/melee/tools/serve_melee.py --upstream --port 8781 --characters play/ui
```

```bash
cd web-prototype && MELEE_LOCAL_ORIGIN=http://127.0.0.1:8781 pnpm dev
```

Open <http://127.0.0.1:4174/melee> and pick the disc when prompted. The disc
is hashed and read in the browser; it is never uploaded. Toolchain
prerequisites (LLVM 22, GCC 16, Node 22.13+, Emscripten) and the upstream
sync procedure are in [`engines/melee/UPSTREAM.md`](engines/melee/UPSTREAM.md).
The `--characters` directory is a generator output tree (`play/ui`, one
directory per slug with `rigged.glb` and `character.json`); the converter
prepares costumes from it on first use.

**Bringing a fighter over from smash.fun.** Open a fighter's download panel on
the site and choose **Copy Melee import URL**. A local Melee launcher (or the
desktop app) accepts that link in **Create** and converts it on your machine.
On the hosted site no link is needed: the roster is shared and costumes are
prepared on demand by a Python child inside the web container
([`engines/melee/server/README.md`](engines/melee/server/README.md)).

**Deploying.** `web-prototype/infra/deploy.sh` runs
`engines/melee/tools/prepare_web_release.py` before rollout. It fingerprints
the engine pin, fitter and template code, rebuilds only when something changed,
publishes a content-addressed input pack to the private bucket, and pins the
manifest for that deploy. It needs a verified extracted-game workspace
(`MELEE_WORKSPACE`) and a Python environment with the engine requirements plus
`google-cloud-storage` (`MELEE_BUILD_PYTHON`).

**Outside the browser.** The standalone desktop alpha (Electron shell around a
native engine, Windows and Apple Silicon) is released from
[turtlesoupy/opensmash-melee](https://github.com/turtlesoupy/opensmash-melee/releases).
Its source was imported here as `engines/melee` (provenance in
`engines/melee/IMPORT.json`); see
[`engines/melee/docs/DESKTOP_RELEASE.md`](engines/melee/docs/DESKTOP_RELEASE.md)
and [`engines/melee/docs/NATIVE.md`](engines/melee/docs/NATIVE.md).

## Generating a fighter

### Prerequisites

- Python 3.11+ and `pip install -r requirements.txt`. `ffmpeg` on your PATH
  for the announcer audio.
- The ROM, as above. The generator doesn't read it directly, but the
  skeleton and sprite inputs it uses are derived from it and are not in the
  repo. Run `tools/derive_from_rom.py` and `tools/derive_skeletons.py` once
  before generating (see [Game-derived inputs](#game-derived-inputs)).
- Keys. Copy `.env.example` to `.env` in the repo root (gitignored; every
  pipeline script reads it):

| Key | Used for |
|---|---|
| `OPENAI_API_KEY` | Character description (`gpt-5.6-luna`); T-pose sheet, portrait, stock and emblem art (`gpt-image-2`); the facing check; upload moderation on the site. |
| `TRIPO_API_KEY` | Image-to-3D + auto-rig. ~55 credits (~$0.55) per fighter. Task ids are checkpointed, so a retry doesn't buy the mesh again. |
| `FAL_KEY` | Announcer clips (fal's MiniMax speech endpoint) and creating the announcer voice. |
| `MINIMAX_ANNOUNCER_VOICE_ID` | The MiniMax voice clone the announcer speaks with. Made once; see below. |
| `GEMINI_API_KEY` | Optional. Alternative image model for some experiments. |
| `MESHY_API_KEY` | Optional. Only `web-prototype/tools/generate_mesh.py` (site props). |

A fighter costs about $0.65 in provider fees. Each run writes a per-stage
breakdown to `play/ui/<slug>/cost.json`.

### The announcer voice (once)

The announcer is a MiniMax voice clone of the game's announcer. The reference
audio is rendered from the ROM (`eval/announcer_conditioning_corrected/`,
regenerated by `derive_from_rom.py`). To make the clone on your own fal
account:

```bash
python3 pipeline/create_announcer_voice.py
```

That uploads the 14-second name montage, calls fal's `minimax/voice-clone`,
saves a preview WAV, and prints the voice id. Put it in `.env` as
`MINIMAX_ANNOUNCER_VOICE_ID`. MiniMax charges a small fee per clone, and a
clone that isn't used for TTS within seven days is deleted, so generate at
least one announcer clip after making it. `ANNOUNCER.md` has the details and
the provider settings that were tuned by ear.

### One fighter

```bash
python3 pipeline/run_character.py "Weird Al Yankovic" --photo ref.png
```

Options: `--short WEIRDAL` (tile caption, up to 10 capital letters),
`--display "Mozart"` (in-game name and what the announcer says),
`--emblem "a red accordion"` (series emblem; inferred if omitted),
`--notes "..."` (steer the description: which depiction, outfit, era),
`--variants all` (also build the experimental DK and Yoshi targets).

Stages: `expand` (description) → `tpose` (model sheet) → `mesh` (Tripo mesh +
rig) → `convert` (fit onto the Smash 64 skeletons) → `portrait` → `stock` →
`emblem` → `ui` → `voice` → `melee-source` (packs the rigged mesh and art for
the Melee converter; one package serves every moveset). A stage is skipped if its output already exists,
so a failed run resumes where it stopped. Delete a stage's output or pass
`--force-stage <stage>` to redo it. To fix a description or emblem, edit
`character.json` and re-run.

Output goes to `play/ui/<slug>/` (art, `character.json`, the `.osbui` UI pack,
`announcer.wav`, the Melee source package, intermediates) and
`play/<slug>.osb6`, one bundle with the mesh for every Smash 64 target
skeleton. Melee costumes are not built here; they are fitted on first use from
the source package. The site's `/create` page runs this same script.

### Many fighters

```bash
python3 scripts/batch_characters.py names.txt --workers 3
```

One name per line. Retries transient provider errors, re-rolls
moderation-blocked images, skips names that are already done, and keeps state
in `batch-state/`. `touch batch-state/STOP` to finish in-flight work and
exit. `tools/build_wikipedia_people_seed.py` builds popularity-ranked name
lists from Wikipedia. It applies `config/wikipedia-roster-{inclusions,exclusions}.txt`
if you have them (local files, not in git); the rules we used are in
`docs/character-roster-editorial-policy.md`.

## Publishing to the site roster

`web-prototype/config/characters.json` is the ordered list of baked fighters.
After checking a fighter locally:

```bash
python3 pipeline/baked_roster.py <slug>
```

That validates the required files and appends the slug (`run_character.py
--publish` does the same). Then upload the runtime files and refresh the
checksum pin:

```bash
cd web-prototype && PUBLIC_BUCKET=<project>-fighter-assets pnpm assets:publish
```

Commit `config/characters.json` and `config/baked-assets.json` together.
Objects are keyed by content hash, so publishing only adds, and old commits
stay reproducible. Deploy (Cloud Run, the worker job, Cloudflare) is one
script: [`web-prototype/infra/README.md`](web-prototype/infra/README.md).

## Game-derived inputs

Some generator inputs come from Smash 64 itself. None of them are committed
(they're gitignored, and were purged from history before the repo went
public). Rebuild them from your ROM before running the generator or the
worker Docker build, which copies `ui_refs/` into the image. (Melee's
equivalents, the costume templates and menu files, are extracted from your
disc by the Melee tools; see [`engines/melee/README.md`](engines/melee/README.md).)

| Files | What | Rebuilt by |
|---|---|---|
| `skels/*.skel`, `skels/fk*-all.log`, `skels/parts/*.json` | Rest-pose skeletons and part geometry for the twelve fighters | `derive_skeletons.py` (runs the engine) |
| `web-prototype/asset-sources/css-font/{portraits,locked}` | Character-select portraits, fire slot, question mark, shadows | `derive_from_rom.py` |
| `web-prototype/visual/assets/ui_refs/` | Tile and name sprites, stock icon, emblem sheet, glyph atlases | `derive_from_rom.py` (four letters need `--skeletons`) |
| `eval/announcer_conditioning_corrected/` | Announcer lines the voice clone is conditioned on, at in-game pitch | `derive_from_rom.py` |
| `web-prototype/asset-sources/stone-tile/source-*` | The character-select stone texture | `derive_from_rom.py` |

Not derived (and committed): the hand-authored `skels/*.profile.json`,
`skels/VALIDATION.md`, and `asset-sources/css-font/letters`.
`skels/reference/mario.skel` is an old capture from a different engine build
that `texture_check.py` still reads; the scripts report it as `LEGACY` and
leave it alone.

Why run the engine for skeletons: the ROM stores joint trees and animations,
not world-space rest frames. The dump hook runs the game's own setup and
transform code and prints the result, which is simpler and safer than
reimplementing that in Python. The conform profiles were tuned against these
exact numbers.

### Prerequisites

- The ROM at `BattleShip/baserom.us.z64` (SHA-1 is checked).
- A native engine build, which also produces the `BattleShip.o2r` archive the
  sprite extraction reads. From `BattleShip/`:

```bash
cmake -S . -B build-us -GNinja -DSSB64_VERSION=us -DCMAKE_BUILD_TYPE=Release && cmake --build build-us -j
```

- Python with `numpy` and `Pillow` (in `requirements.txt`).

### Verify

```bash
python3 tools/derive_from_rom.py --verify --skeletons
```

Derives everything into a temp dir and prints one line per file:
`IDENTICAL`, `DIFFERS` plus a reason (pixel count, which joints moved), or
`LEGACY`. Non-zero exit on any difference. `--skeletons` launches
`BattleShip/build-us/BattleShip` thirteen times (once per fighter with
`SSB64_DUMP_SKELETON`, once on the character-select screen with
`SSB64_DUMP_SPRITES`). A window opens and closes each time, ~10 s per launch.
Leave it off to check just the archive-based files.

### Regenerate

```bash
python3 tools/derive_from_rom.py --skeletons
```

Without `--verify`, files are written in place. `--out DIR` writes a mirror
of the repo layout elsewhere. Also useful:

```bash
python3 tools/derive_skeletons.py --verify --fighters samus,link
```

```bash
python3 tools/derive_skeletons.py --verify --from-logs skels
```

The first limits engine runs to the named fighters (names or fkind numbers).
The second skips the engine and re-derives from the committed raw logs, which
tests the parsing and profile-map transform without a ROM. `--build-dir`
points either script at a different native build.

The `dl=` field in the skeleton dumps is a host pointer the engine prints;
the scripts normalize it to its stable low bits so two launches match. The
one consumer only checks whether it's zero.

## More docs

- `EVAL.md`: mesh generation / skinning eval harness and its experiment log.
- `ANNOUNCER.md`: announcer voice generation, the clone, provider settings.
- `web-prototype/docs/site-visual-assets.md`: how the site's console,
  cartridge, CRT intro, and other props were made.
- `web-prototype/docs/production-architecture.md`: the hosted generation
  service (job protocol, retries, abuse controls).
- `BattleShip/docs/`: engine internals, web harness, controller ports,
  in-browser ROM extraction.
- `engines/melee/README.md`, `engines/melee/UPSTREAM.md`, `engines/melee/docs/`:
  the Melee engine, converter, validation reports, and desktop packaging.
- `docs/melee-integration.md`: how the two engines share one launcher, and the
  acceptance matrix used when Melee was brought in.
