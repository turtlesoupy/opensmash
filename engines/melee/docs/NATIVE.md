# Native ROM-first builds

The native script targets **Apple Silicon, macOS 14 or later**. Windows, Linux,
Intel Macs and mobile native packages are not validated by this build path.
It uses the pinned MeleePad/ModernGekko native runtime and an ARM64 module
generated locally from the user's own unmodified Melee USA v1.02 ISO/GCM.

Install Xcode Command Line Tools, Python 3, CMake and Ninja, then run from this
repository:

```sh
python3 tools/build_native.py
```

Alternatively, double-click `tools/build-native-macos.command`. The first source
build requires network access for pinned dependencies and can take several minutes.

A file picker asks for the ROM **before cloning dependencies or building**.
Cancellation stops the build. The script checks the full image SHA-256, prepares
the pinned native engine and game module, and produces:

```text
build/native/OpenSmash Melee.app
```

Open the app normally. Its own first-run picker asks for the ROM, verifies it
again, and imports the game under `~/Library/Application Support/OpenSmash Melee`.
The source image is never modified. Subsequent launches remember its path and
verify it before reusing the local extraction. Game settings and saves are
separate from Dolphin and the browser. The native picker lets you search bundled custom characters or the 26 standard
Melee fighters and choose the same five launch modes as the local website:
Free-for-All, VS Menu, VS Character Select, 1P Character Select (Classic), and Full
Boot. Configure stage/random, CPU level, stocks, minutes, and four controller
ports. Defaults are a four-stock Battlefield match against a level-5 CPU.
The Play button displays preparation/loading progress and stays visible until the game reaches its destination. An early exit displays an error with a button to open the runtime log. `--play` starts the saved setup after ROM verification.
The game opens in a fixed 960×720 floating panel on the active desktop. Closing
it returns to the picker. No AeroSpace configuration is changed.

On a fresh virtual memory card, Melee may ask for an initial confirmation: press
**J (A)**. By default, move with WASD, attack with J, special with K, jump with
Space/I, grab with U, shield with Q/E, smash with the arrow keys, and pause with
Return. The Controls screen lights up each key or gamepad button as it is
pressed and lets players rebind keys and gamepad buttons; the launcher sends
those bindings with each launch and writes them into GCPadNew.ini. The headless
test exercises the initial confirmation through its own isolated pipe
controller; normal play keeps the keyboard configuration and separate saves.

The native picker includes the custom characters already prepared under
`build/characters/web-v1-*` when you package it. The current local package contains
eight custom characters covering all six supported movesets. It does not yet
fetch or convert the entire 1,067-character browser roster on demand. A source-only
build includes the 26 standard fighters. To include another existing native build:

```sh
python3 tools/build_native.py --character-id YOUR_EXISTING_CHARACTER_BUILD
```

That identifier is a directory under `build/characters/` containing the standard
native `Pl*Nr.dat`, not the browser-only draw layout. It retains the assigned
Melee moveset. Use the existing `tools/build_character.py` workflow to build a
new source character first.

## Automation and verification

```sh
python3 tools/build_native.py --rom '/path/with spaces/melee.iso' --verify-only
python3 tools/build_native.py --rom /path/to/melee.iso --reuse-build --output 'build/native/My Test.app'
'build/native/My Test.app/Contents/MacOS/OpenSmashMelee' --verify-rom /path/to/melee.iso
'build/native/My Test.app/Contents/MacOS/OpenSmashMelee' --smoke-test /path/to/melee.iso --user-dir /tmp/my-native-validation
python3 tools/verify_native_package.py 'build/native/My Test.app'
python3 tools/test_native_first_run.py --app 'build/native/My Test.app' --rom /path/to/melee.iso --output build/native-validation-new
```

`--reuse-build` skips game-module preparation but still builds/checks the native
app runtime and verifies the ROM and module identity. Existing output bundles
are never overwritten. `--prepare-rom` imports without launching a game.
`--smoke-test` uses a headless renderer. Free-for-All passes after 180 combat
callbacks; the other modes pass after reaching their destination and remaining
alive for three seconds. Use `--mode 0` through `--mode 4` or `--launch-settings
/path/settings.json` to choose a case. It does not certify Metal rendering,
audio, controls or native FPS. These command-line modes open no game window.
`--choose-rom` forces the app's picker on a later launch.

Import failures are logged in `import.log`; runtime output is in `game.log`
under the app's support directory (or the supplied `--user-dir`). Wrong hashes
are rejected rather than guessed from a filename. This path currently accepts
raw ISO/GCM only, not RVZ, NKit or a modified image.

## Sharing with Discord users

`python3 tools/package_native_sources.py` creates an allowlisted source-only ZIP
at `build/native/opensmash-melee-native-builder.zip`. It can build the standard
native game without the rest of this project. Custom source-character conversion
still uses the full project. The archive contains no ROM, extracted assets,
generated module or costumes.

Share the source/build scripts. The app is a **private local build**, including
a game-derived ARM64 module and, if selected, a costume archive. The bundle
contains no ROM or extracted game filesystem. Each user should build it from
their own ROM. The app is ad-hoc signed locally, not notarized for public release.

Suggested status text:

> OpenSmash Melee has a local playable browser build and an experimental Apple
> Silicon native build script. The native script asks for your own unmodified
> Melee USA v1.02 ROM and builds locally. Windows/Linux and full OpenSmash feature
> parity are not confirmed yet. No game download is included.

## Local validation (September 9)

The current eight-custom-character package passes signature/module/costume
integrity checks, same-size wrong-ROM rejection, fresh import, all five headless
launch destinations, and a four-player custom/vanilla combat check. Native GUI
validation covered the searchable picker, ROM selection, VS Menu → character
select → stage select, and four-player custom combat in the floating window.

Evidence: `build/moderngekko-validation/native-launch-final/result.json`,
`native-launch-final/package-final.json`, and
`native-first-run-launch-final/result.json`. The tests ran before the package was
renamed from `OpenSmash Melee Launch Modes v5.app` to `OpenSmash Melee.app`; the
final path passes package verification with the same signed module.

The earlier native build, before shared skinning, was CPU-limited in four-player combat (roughly 31–34 FPS in an
isolated sample). A 1× render-scale test did not solve this, and bounded CPU/GPU
threading did not sustain 60 FPS. These launch tests do not certify performance
parity or physical gamepads. See `docs/LAUNCH_MODES.md` in the full project.

## Launch-mode validation

```sh
python3 tools/test_native_launch_modes.py --app 'build/native/OpenSmash Melee.app' --rom /path/to/melee.iso --output build/native-launch-validation
```

This exercises the five modes and, when the bundled samples are available, a
four-player match with two custom Falcon costumes alongside custom and standard
Mario. Each lineup starts from the unmodified imported game; different characters
sharing a moveset receive separate costume slots. The standard slot is reserved
when a vanilla version is present. Results panels use each costume’s short name;
the winner title and background
emblem use its full name and imported OpenSmash stencil. Custom winner portraits
are framed from the fitted head bounds. The original selection menus and stock
icons still use Melee’s assets.

Keyboard and up to four separately assigned gamepads are supported by the
launcher. A controller may occupy only one port. Physical gamepad input still needs a hands-on check; detecting a connected DualSense alone is not an input validation. Stage/rules seed VS mode; Classic uses P1 and
maps CPU levels 1–9 to its five difficulty levels. Full Boot preserves the original
intro/title/menu flow; use the original game menus for its rules and selections.

## Shared native skinning

The native module also uses the same verified matrix-concatenation and scaled-add specializations as the browser. Their generated instruction bodies are hash-checked before transformation.

Native packages prefer each prepared costume's `browser/` single-batch layout
when available. The native engine uses the same skinning implementation and
Melee matrix oracle as the browser, through a small native module adapter.
Lineups with three or more distinct customs use bundled 256px variants to fit Melee’s preload memory; smaller lineups retain their 512px textures. Meshes, proportions, materials, names and emblems are shared. Vanilla costumes and imports without that layout retain the original GX path.
The launcher keeps its controller bridge active while gameplay is running.

Measure real CPU-versus-CPU combat without capture:

```sh
python3 tools/benchmark_native.py --character abrahamlincoln --output build/native-fps-new
```

This uses the already-verified local game import and copies settings into an
isolated user directory. It saves three 30-second frame-time windows after
warm-up, with capture explicitly disabled. See `docs/PERFORMANCE.md` for measured
results and remaining limitations.

### Picking a retarget for smoke tests

Each player row has a target dropdown beside the custom character. **Default**
shows the original assignment (for example, Captain Falcon for Abraham Lincoln).
Choose Mario, Luigi, Captain Falcon, Fox, Marth, or Link to change both the fitted
skeleton and the Melee moveset. Choices persist with launch settings. Standard
Melee characters do not use this override. Only bundled targets are enabled;
unsupported choices fail explicitly instead of silently falling back.

In a full local checkout, build alternate costumes for cached roster characters
before packaging the native app:

```sh
python3 tools/build_retarget_options.py
# Or only one character:
python3 tools/build_retarget_options.py abrahamlincoln
```

Then run the usual native packaging command with `--reuse-build` and a new output
path. The app packages the generated targets, including compact textures for
large lineups. Generation runs the source-proportion checks; a successful build
does not certify every animation or target's visual quality. To exercise every
bundled target for one character in isolated headless combat:

```sh
python3 tools/test_native_targets.py --app 'build/native/OpenSmash Melee.app' \
  --rom /path/to/melee.iso --character abrahamlincoln --output build/target-smoke
```

These are native launcher controls; the web roster's assignment is unchanged.

### Retarget presentation validation

Costume exports now record a measured uniform stature fit against the verified
original target costume. The render transform preserves the source character's
head/body proportions and ground baseline. It does not alter Melee's physics,
hitboxes, or animation. Link and Marth retain their original weapon DObjs and
visibility tables. Rigid weapons retain their native world size independently
of the body fit. Link's held shield clearance is measured against the custom
forearm; the stowed shield, sheath, and sword move together as one back assembly
with clearance for the torso and head. Marth's sword and scabbard receive a
measured outward rotation around the original grip and belt mounts, preserving
native equipment size and the original idle floor spacing relative to the custom
body height. The blade follows the hilt as one assembly. Position and normal
arrays are cloned per attachment,
preserving shared originals, weapon materials, and animation joints. Held bows, blasters, and Mario's cape follow the same visual
transform, including nocked arrows and their charge visuals; released projectiles
retain their world trajectories. The stature rule is shared across all bundled
characters and target variants, not a Lincoln-specific scale table.

Custom OpenSmash emblems supply both combat stock icons and damage-panel marks.
The stock texture has transparent padding and an outline for bright stages.
Results portrait framing accounts for the uniform stature transform.

`tools/verify_target_assets.py` checks every bundled variant's stature metadata,
icon alpha, retained weapon geometry, and uniform weapon transforms. `tools/validate_retargets.py`
compares custom/original fighters on Final Destination with a fixed camera;
`--action` drives real controller inputs and checks damage and stock loss.
Its frame-dumping captures are for visual review, not FPS measurements. Use
`tools/benchmark_native.py --target 6` for capture-free combat timing.
