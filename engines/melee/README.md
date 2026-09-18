# OpenSmash Melee

Super Smash Bros. Melee with OpenSmash's generated fighters. This directory is
the Melee half of the [OpenSmash](../../README.md) repo: the pinned browser
engine, the costume converter that turns a generated fighter into a Melee
costume, the launcher components the site mounts at `/melee`, the hosted
converter service, validation tooling, and the desktop shell.

It started life as the standalone
[turtlesoupy/opensmash-melee](https://github.com/turtlesoupy/opensmash-melee)
repository and was imported here at the commit recorded in `IMPORT.json`. The
desktop alpha is still released from that repository; the website at
[smash.fun/melee](https://smash.fun/melee) is served from this tree.

No game data is in this directory. You need your own **unmodified Super Smash
Bros. Melee USA 1.02** disc image in ISO or GCM format. RVZ, NKit and patched
images are rejected. In the browser the disc is hashed and read locally and is
never uploaded.

## How it works

**The browser engine is the Melee PC source port.** The site runs
[turtlesoupy/opensmash-melee-pc](https://github.com/turtlesoupy/opensmash-melee-pc),
a fork of [999sian/melee-pc](https://github.com/999sian/melee-pc), compiled
with Emscripten and rendering through Aurora/WebGPU. `upstream.json` pins the
exact fork commit, the upstream commit it was merged from, and the Emscripten
and LLVM versions used to build it. The fork carries the web build, the
writable costume and menu slots that overlay the read-only disc, and the launch
hooks; game logic is upstream's. [UPSTREAM.md](UPSTREAM.md) has the build
steps and the sync procedure. The earlier direct-C and PowerPC-recompilation
engines (`browser-port/`, `runtime/direct-c/`, `runtime/native/`) are kept for
comparison and for the native desktop build; they are not what the site runs.

**Custom fighters are costumes on Melee skeletons.** A conversion takes the
rigged mesh and art from the generator, conforms the mesh onto the chosen
fighter's skeleton using the game's own bind matrices, repairs hands and feet,
bakes the textures into one atlas, and writes a genuine costume `.dat`. Physics,
hitboxes and animations are untouched Melee data, so each custom fighter borrows
one of the 26 movesets. In the browser the fit runs in a wasm build of the
fitter against templates read from the player's disc; the server only supplies
the fighter's source package. Kirby and Jigglypuff use the big-head fit, Ice
Climbers prepares both partners, and Zelda/Sheik keeps the custom character
through transformations. `docs/COSTUME_FORMS.md`, `docs/SHADING.md` and
`docs/RETARGET_VALIDATION.md` cover the details.

**Moveset assignment.** Each fighter has a default Melee moveset derived from
its Smash 64 base (`web-prototype/shared/melee-targets.js`), and the fighter's
owner can pick a different one in the site's fighter modal. The bundled roster's
assignments come from `tools/assign_roster_targets.py`. The full list of
movesets and their limits is `runtime/launch-options.json`.

**The site is the only launcher.** `web-prototype` owns the page, accounts,
roster and navigation for both games. This directory contributes
`launcher/` (the Melee experience, settings, controller tutorial, trailer
capture) and `web/` (shared engine components; its `npm run dev` forwards to
`web-prototype`). There is no separate Melee website any more.

**Hosting.** On smash.fun the converter runs as a loopback-only Python child
inside the existing web container (`server/embedded.mjs` →
`tools/serve_embedded.py`). Engine files, the fitter, disc-derived templates and
per-fighter source packages come from a content-addressed input pack in the
private bucket; `tools/prepare_web_release.py` builds and publishes that pack
during `web-prototype/infra/deploy.sh`. See [server/README.md](server/README.md).

## Layout

| | What |
|---|---|
| `upstream.json`, `UPSTREAM.md` | Engine fork pin, build and sync instructions. |
| `opensmash_melee/` | The Python converter: disc verification and extraction, costume fitting and packing, character-select menu and announcer assembly, hosted cache. |
| `tools/` | Build, serve, publish and validation scripts. The ones you will use are listed below. |
| `launcher/`, `web/` | React components the site mounts under `/melee`. |
| `server/` | The embedded hosted converter and its Dockerfile. |
| `runtime/` | Launch-option schema, retarget options, engine patches, and the older direct-C and native runtimes. |
| `desktop/` | Electron shell for the standalone desktop app. |
| `validation/`, `tests/`, `docs/` | Benchmark reports, Python and Node test suites, design notes and audits. |
| `melee/` | The [doldecomp/melee](https://github.com/doldecomp/melee) submodule, used as the structure reference. |
| `assets/`, `build/` | Local extracted game, converted costumes and build output. Gitignored. |

## Run it locally

Prerequisites: Python 3 with `requirements.txt`, CMake, Ninja, LLVM 22 with
LibTooling, GCC 16, Node 22.13+, and the site's dependencies. On Apple Silicon
the build defaults to Homebrew LLVM 22; set `LLVM_ROOT` elsewhere. All commands
run from the repository root (`pipeline/`).

1. Build the pinned engine. This clones the fork into a sibling `melee-pc/`
   checkout (or uses `MELEE_PC_ROOT`) and bootstraps its own emsdk:

```bash
python3 engines/melee/tools/build_upstream.py --jobs 6
```

2. Start the Melee asset service. `--characters` is a generator output tree
   (`play/ui`, one directory per fighter slug with at least `rigged.glb` and
   `character.json`); costumes are converted from it on first use:

```bash
python3 engines/melee/tools/serve_melee.py --upstream --port 8781 --characters play/ui
```

3. Start the site pointed at it:

```bash
cd web-prototype && MELEE_LOCAL_ORIGIN=http://127.0.0.1:8781 pnpm dev
```

Open <http://127.0.0.1:4174/melee>, choose your disc when prompted, pick a
fighter. Setup verifies the image, saves it in the browser's private storage
so you don't re-select it next visit, and reads game files from it directly.
The browser needs WebGPU, shared memory and cross-origin isolation. Pass
`--iso PATH` to `serve_melee.py` if the server-side converter needs an
extracted game for template work and you have not prepared one yet.

Import a fighter from the site instead of a local `play/ui`: open its download
panel on smash.fun, choose **Copy Melee import URL**, and paste it into
**Create** in the local launcher. `docs/CHARACTER_IMPORT.md` describes what
the link grants and how imports are validated.

## Checks

```bash
python3 -m unittest discover -s engines/melee/tests
```

```bash
node --test engines/melee/tests/*.test.mjs
```

```bash
npm run typecheck --prefix engines/melee/web
```

Tests that need a disc, an extracted game or character fixtures skip when those
are absent. Performance gates for the browser engine (≥58.5 FPS, p95 ≤20 ms, no
audio underruns) and the Playwright recipe that measures them are in
[UPSTREAM.md](UPSTREAM.md); the last reports are under `validation/upstream/`.

## Desktop and native

The standalone app (Windows x64 and Apple Silicon) wraps a native engine in an
Electron shell with the same launcher UI and a bundled Python service for setup
and imports. It is built and released from
[turtlesoupy/opensmash-melee](https://github.com/turtlesoupy/opensmash-melee/releases);
[docs/DESKTOP_RELEASE.md](docs/DESKTOP_RELEASE.md) and
[docs/NATIVE.md](docs/NATIVE.md) cover packaging and the Apple Silicon
ROM-first build. The shared two-engine desktop prototype that also hosts Smash
64 is described in [`../../desktop/README.md`](../../desktop/README.md).

## More docs

- [UPSTREAM.md](UPSTREAM.md): engine build, upstream sync, benchmark recipe.
- [server/README.md](server/README.md): hosted converter, release prep, deploy variables.
- [docs/CHARACTER_IMPORT.md](docs/CHARACTER_IMPORT.md): import links and validation.
- [docs/LAUNCH_MODES.md](docs/LAUNCH_MODES.md), [docs/CHARACTER_SELECT.md](docs/CHARACTER_SELECT.md): what the launcher can start and how the expanded select screen works.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md), [docs/STARTUP.md](docs/STARTUP.md): frame-time and click-to-match work.
- [docs/BOOT_AND_DISC_SETUP.md](docs/BOOT_AND_DISC_SETUP.md): disc verification and local storage.
- [launcher/TRAILER.md](launcher/TRAILER.md): recording the Melee trailer.
- [../../docs/melee-integration.md](../../docs/melee-integration.md): how the two engines share one launcher.

## Feedback and credits

Bugs: [open an issue](https://github.com/turtlesoupy/opensmash/issues) with your
platform, browser and what happened. Join the
[OpenSmash Discord](https://discord.gg/qYBbGmwBhr) to share characters.

Thanks to [999sian/melee-pc](https://github.com/999sian/melee-pc),
[doldecomp/melee](https://github.com/doldecomp/melee), and the Melee community.
