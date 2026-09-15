# OpenSmash Melee

Super Smash Bros. Melee with custom fighters, from the same team that built [OpenSmash](https://github.com/turtlesoupy/opensmash). Pick a character from the roster or bring one over from [smash.fun](https://smash.fun), and play with a familiar Melee moveset.

**This is an alpha build.** Expect bugs, unfinished features, and performance issues.

## Download

Choose your platform, then download the matching file from the release's **Assets** section.

| Platform | Releases | File to choose |
| --- | --- | --- |
| Windows (64-bit) | [Download for Windows](https://github.com/turtlesoupy/opensmash-melee/releases) | `OpenSmash-Melee-…-win-x64-Setup.exe` |
| macOS (Apple Silicon) | [Download for Apple Silicon](https://github.com/turtlesoupy/opensmash-melee/releases) | `OpenSmash-Melee-…-mac-arm64.dmg` |

Check the release notes for platform requirements and known issues.

## Getting started

You'll need your own **unmodified Super Smash Bros. Melee USA 1.02 disc image** in ISO or GCM format. RVZ, NKit, and patched images aren't supported. No game disc is included.

1. Open OpenSmash Melee and choose your disc image when prompted. Setup stays on your computer and leaves the original image unchanged.
2. Wait for setup to finish, then pick a fighter from the roster.
3. Pick a fighter to face a random Melee fighter and two random custom characters. Open **Settings** to choose your opponents, stage, match rules, and controllers. Open **Controls** to see the button mappings light up as you press them, and to rebind keys or gamepad buttons.

## Bring your own character

Create a character on [smash.fun](https://smash.fun). In its download panel, choose **Copy Melee import URL**. Open **Create** in OpenSmash Melee, paste the link, and choose a Melee moveset. Your character appears in the roster when the import finishes.

## How it works

**The browser build now uses the Melee PC source port.** Its exact fork revision is pinned in `upstream.json`; game logic and Aurora/WebGPU rendering are built from that maintained upstream. See [browser build, upstream sync, and validation](UPSTREAM.md). The native desktop release described below retains its separate recompilation engine.

**The game runs as recompiled code, not in an emulator.** At setup, the `main.dol` executable from your disc image is run through a PowerPC static recompiler that turns the game's machine code into a native module (or WebAssembly for the browser build). Around that module sits a host layer that stands in for the rest of the GameCube: a GX-to-OpenGL/WebGL renderer, DSP audio, controller input, and a virtual disc that serves files from the extracted image. That host layer is built from Dolphin's own video, audio, and hardware subsystems, trimmed down and embedded as a library, with Dolphin's PowerPC interpreter swapped out for the recompiled code. So this is not a source port in the style of the Zelda and Mario decomp ports. It is closer to the N64 recompilation projects: the original game binary, translated ahead of time, running inside a slimmed emulator core. We also use full Dolphin during development to record parity captures and check that our output matches frame for frame.

**Your disc is never modified.** Setup verifies that the image is an unmodified USA 1.02 copy, extracts its filesystem into a local folder, and hashes every file. Custom fighters are swapped into that folder as costume files, padded to fixed sizes so the file table stays stable, and small runtime mods hook into the game to route scenes and drive the expanded character select screen.

**Custom fighters are costumes on Melee skeletons.** An import fetches the rigged model and art from smash.fun, conforms the mesh onto the chosen fighter's skeleton using the game's own bind matrices, repairs hands and feet, bakes textures into a single atlas, and writes a genuine DAT costume file. Physics, hitboxes, and animations are untouched Melee data, so each custom fighter borrows a Melee moveset. The shared launcher offers all 26 movesets in More → Settings → Players & Controllers; alternate costumes are generated locally on first use and cached. Kirby and Jigglypuff use the big-head fit; Ice Climbers prepares both partners, and Zelda/Sheik keeps the custom character through transformations. The bundled roster uses all 26 default movesets, assigned by stable moveset-family heuristics and thematic overrides in `tools/assign_roster_targets.py`; player overrides remain available. Original assignments are retained only for costume cache compatibility.

**The desktop app is a shell around the native engine.** Electron hosts the same launcher UI as the web build and a bundled Python service handles setup and imports. The engine renders natively and its frames are shared into the window through IOSurface on macOS or shared memory elsewhere.


## Feedback

Found a bug? [Open an issue](https://github.com/turtlesoupy/opensmash-melee/issues) with your platform, app version, and what happened. Screenshots or a short clip help, especially for character glitches.

Join the [OpenSmash Discord](https://discord.gg/qYBbGmwBhr) to share characters and talk about the alpha.

## Credits

Made by the team behind [OpenSmash](https://github.com/turtlesoupy/opensmash), with thanks to [doldecomp/melee](https://github.com/doldecomp/melee) and the Melee community.
