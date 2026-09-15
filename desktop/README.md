# Shared native launcher

The client bundles the same `web-prototype` frontend as smash.fun. The experience
selector chooses SSB64 or Melee. Website authentication, roster and creation APIs
remain online services; Melee conversion/process APIs run locally. Native tokens
never reach the website. Generated website fighters use the same source-export
and conversion path as the browser's private hosted converter.

Both Melee and SSB64 render inside the launcher;
closing the session, switching experiences or quitting stops the engine. The
standalone Melee release tooling remains available under `engines/melee`.

## Build and develop

Install the existing website, Melee web/Electron and Python dependencies first.
Use the engine Python environment for all commands (it must include PyInstaller).
Prepare Melee runtime and source-character payloads in `engines/melee/build` with
its existing release tools. Rebuild the Melee runtime after changing native
patches: shared packages require `launcherInput: 1` in both runtime manifests.

```sh
python desktop/build_ssb64.py --engine /absolute/path/to/BattleShip
OPENSMASH_SSB64_RUNTIME=/absolute/path/to/build/shared-ssb64-runtime python desktop/dev.py
python desktop/package.py                 # local installer, never publishes
python desktop/package.py --dir           # unpacked app only
```

SSB64 builds in an isolated snapshot under `build`; the sibling source repository
is not edited. The installer explicitly stages executables, extraction recipes,
fonts, renderer assets and licenses, excluding ROMs and `BattleShip.o2r`. macOS
non-system libraries are copied recursively and relinked within the package.
Both runtime manifests are hash-verified after packaging. Game data is supplied
locally by the user, and saves/configuration live under launcher user data.

Packaged data lives in `OpenSmash`; development uses `OpenSmash Integration`.
`OPENSMASH_DESKTOP_DATA` overrides this for isolated tests.
`OPENSMASH_FORCE_MUTE=1` forces both web and native audio off during testing. Keep generated build
outputs and private test workspaces out of source control and release uploads.

## Input and audio

A session-scoped 80-byte local packet carries four logical controller states and
live mute. The renderer uses browser Gamepad identities and the same saved
profiles used by the website, including device reconnection. Native engines no
longer guess how browser indices correspond to SDL devices. A stalled renderer
releases gamepad input after 500 ms. Melee keyboard mappings use the existing
embedded input bridge; SSB64 reads the website keyboard layout from the focused launcher canvas. Melee keyboard rebinding applies at the next match. Settings dialogs
suspend controller input. Native audio follows the website sound preference
without restarting the engine.

Run `node --test desktop/*.test.cjs engines/ssb64/desktop/*.test.cjs
engines/ssb64/launcher/*.test.mjs` plus the engine and website suites. The native
`opensmash-embedded-test` validates keyboard pulses, packet decoding, mute and the
stalled-renderer watchdog.

## Release checks

Local Apple Silicon app/DMG builds are supported and verified. Public macOS
releases still need the project's signing/notarization setup; the local build is
ad-hoc signed. The configuration retains Windows NSIS and Linux tar targets,
but those require platform-native runtime builds and platform testing. Account
login, physical multi-controller testing and offline website features remain
release acceptance checks. The bundled frontend still uses online roster/auth
services; this is not an offline website mirror.

## Embedded Smash 64 display

The SSB64 runtime advertises `embeddedFrames: 1`. Metal renders to an offscreen
texture; OpenGL/D3D11 read back their hidden render targets. A bounded triple
buffer sends RGBA frames to Electron's existing canvas presenter at 960×720.
The producer drops frames when the renderer falls behind. The hidden native
window never owns keyboard input; the shared page samples keyboard/gamepads,
clears held keys on blur and blocks controls while a visible dialog is open.
Fullscreen fills the launcher window while preserving the game's aspect ratio.

The combined launcher uses the portable shared-memory transport for both engines,
including Melee on macOS. This avoids a shared-texture mailbox failure observed
when switching from Smash 64 to Melee. It adds a CPU frame copy; the standalone
Melee client retains its IOSurface path.

When no local SSB64 archive exists, the launcher asks for the user's ROM using a
native file picker and runs the bundled extractor in private user data before
starting the engine. The ROM is neither uploaded nor copied into the app bundle.
Cancelling or switching experiences cancels preparation and stops the process.

`desktop/native/frame_test.cpp` validates frame publication, channel conversion,
resizing/flipping and backpressure without a GPU. The macOS Metal path has also
been checked with a real match, keyboard pause and in-launcher rendering. Other
native graphics backends still require testing on their target platforms.

Validation: 282 website tests, 46 adapter tests (one platform-specific skip),
the native frame-buffer tests, real first-ROM extraction and the macOS app/DMG
package verification pass. UI checks cover embedded play, keyboard pause,
fullscreen and returning to the roster. Audio was forced off throughout.
