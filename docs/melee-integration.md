# Unified OpenSmash integration

OpenSmash is one product with Smash 64 and Melee experiences. The public repository
is the canonical home. `web-prototype` owns the launcher, accounts, creation,
roster browsing and navigation. Melee-specific source lives in `engines/melee`.
BattleShip remains the SSB64 upstream dependency; existing native and ROM build
commands remain supported. “SM64” in planning refers to Smash 64, not Mario 64.

## Required behavior

- `/` selects Smash 64; `/melee` selects Melee. Both use the existing launcher.
- An experience selector navigates to stable URLs and disposes the old engine.
- Browser and native desktop clients support both experiences. Desktop bundles
  the shared frontend and talks to the same hosted account/creation services.
- Platform adapters own setup, launch, stop, input, audio and display. The shared
  launcher must not depend on Electron or any particular engine protocol.
- Disc readiness and clearing are experience-specific, separate from account
  authentication. Browser game bytes remain local. Native storage is persistent.
- Controller discovery and assignment are shared. Bindings remain engine-specific;
  GameCube input must consume raw devices, never N64-remapped gamepad values.
- Shared character identity does not imply shared binary assets. Melee conversion
  is versioned and cached by character revision, moveset and costume variant.
- Preserve Melee launch-plan validation, including costume and transformation limits.

## Migration and release boundaries

The Melee import records its source revision in `engines/melee/IMPORT.json`.
Only tracked source is imported; discs, generated assets, secrets and local build
caches are excluded. Native packaging stays with the engine during migration.
Do not deploy, archive repositories, or redirect releases as part of this branch.

## Acceptance matrix

Verify Smash 64 and Melee independently in browser and desktop: initial disc setup,
roster selection, launch modes, gamepad and keyboard bindings, reconnect, audio,
fullscreen, return to launcher, experience switching, cached/offline local play,
and errors. Verify the existing character-creation and account flows still work.
Build desktop packages on their target platforms; a frontend build is not proof
that native engines or installers work.

## Implemented adapters

The shared picker preserves human-first/CPU selections and controller assignments.
Melee honors full-game and character-select actions, and uses its own movesets,
stages, rules, keyboard/button profiles and touch controls. Setup/status polling
is abortable and survives transient failures. Settings can replace or forget the
disc. Native sessions are fenced so a cancelled preparation cannot start later.

`desktop` builds a two-engine client from the same website frontend. Its local
Melee service supports the embedded native surface; SSB64 renders offscreen into the same launcher canvas. Both engines consume session-scoped logical gamepad packets produced by
the browser's device/profile system and live audio mute. Device reconnection no
longer relies on matching browser indices to SDL indices. Hidden settings dialogs
are ignored; visible dialogs suspend input. Melee keyboard rebindings apply on
the next launch. Mac native libraries are bundled and relinked; both engine
manifests and package contents are verified. See [desktop guide](../desktop/README.md).

New generated fighters resolve through the website's source-export endpoint and
the existing Melee importer. The native client converts locally; browser clients
use a private hosted converter behind the website. Ownership checks protect
private source exports, imported costumes, job status and portrait/selection
assets. Public baked catalog coverage is 1,046/1,046 website fighters. See the
[service guide](../engines/melee/server/README.md) for private deployment inputs,
secret configuration and durable-storage requirements.

## Validation

- Website suite: 282 passed.
- Melee Python suite: 145 passed, 15 environment/asset fixtures skipped.
- JavaScript adapter suites: 44 passed, one local-disc fixture skipped.
- Both frontend production builds and Melee/launcher TypeScript checks passed.
- Existing SSB64 build-driver tests: 13 passed.
- Both native engines built from source with the shared input/audio bridge.
- Native bridge executable checked keyboard pulses/reset, packet decoding, mute,
  and the 500 ms stale-gamepad watchdog.
- Real four-fighter Melee combat rendered inside the packaged shared launcher on
  macOS; keyboard Start paused the active match.
- Packaged SSB64 rendered a real match with injected fighters and stopped through
  the launcher. Its hidden renderer retains its own macOS bundle identity.
- Hosted test imported a real source mesh/art set, built a playable costume, and
  returned job/costume/portrait only to the owner; another owner received 404.
- Apple Silicon app and DMG built; runtime hashes and exclusion of ROM/disc data
  were verified. Test game data lives only in ignored local workspaces.

## Remaining release acceptance

This branch is not deployed. Production service provisioning, account-login
verification, physical multi-controller testing, fresh user ROM/disc setup,
Windows/Linux runtime/package testing and public signing/notarization remain.
The website's online services are still required for roster/auth/creation; an
offline website mirror is not implemented. Both engines are embedded in the shared launcher.
Automatic assignment of newly connected devices to CPU slots and full touch-layout
parity remain distinct work. Melee supports per-device stick-axis selection,
inversion and deadzone through the same logical input sampler in browser/native.
Imported release workflows are reference files, not active public-repo triggers.
