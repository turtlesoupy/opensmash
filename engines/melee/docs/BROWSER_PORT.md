# Browser port: implementation and validation

The browser currently runs original Melee HSD animation and matrix code and
renders custom costumes. It does **not** boot a match. The full OpenSmash parity
request remains open; the lab is a foundation and regression tool, not the
finished game.

## Actual game runtime bring-up (September 8)

The native game build is now separate from the older animation lab. It links
1,018 translation units in diagnostic mode, including the real `main`, scene
state machine, fighter/stage logic, HSD, and portable portions of the SDK.
The build preserves upstream size assertions and uses generated source overlays;
the matching upstream checkout remains unchanged.

The current reproducible VS diagnostic enters `gm_Scene_Vs_OnEnter`, configured
for Mario versus CPU Peach, four stocks, eight minutes, on Battlefield. It loads
sound, rumble, refraction, particle-bank, and common player data, then **stops at
Battlefield's `map_head` descriptor**. It has not drawn or simulated a match.
The normal boot path separately stops on the memory-card scene's scene-data
schema. Neither run counts as gameplay or browser parity evidence.

Implemented platform work:

- Arena/heap support, a separate 16 MiB audio-memory domain, deferred DVD and
  audio-memory completions, interrupt nesting, alarms, calendar conversion,
  host preferences, and a four-port PAD input buffer. Main-memory addresses
  start at 32 MiB; the original main/ARAM address-classification checks are
  adapted to that explicit layout.
- Original SDK matrix operations and GX state/register packing. Direct GX FIFO
  writes produce a big-endian command stream. GPU completion requires an
  explicit host service; there is no fake rendered-frame success.
- Original AX voice allocation/state and auxiliary-effect setup. This is **not**
  audio playback: the software mixer, several assembly DSP kernels, HPS stream
  handling, and WebAudio output are unfinished.
- Validated HSD archive header, relocation, public-symbol and external-chain
  conversion. Payload conversion is type-specific. Supported data includes
  SSM/SEM metadata, rumble, refraction, player-common data, and particle-bank
  headers. Compressed commands, texture data and sound samples retain their
  source bytes. Unsupported scene/model data throws at its load boundary.
- A launch adapter feeds the original VS state machine using normal rule and
  player defaults. This is the engine-side entry point for character selection;
  the website is not wired to a playable runtime yet.

Run from the Melee project:

```sh
python3 tools/build_game_port.py --diagnostic
node --test browser-port/tests/assets.test.mjs
node browser-port/tests/boot-game.mjs --platform-checks
node browser-port/tests/boot-game.mjs --match
```

The first three commands pass. The last command intentionally exits nonzero at
an unsupported stage schema and writes the exact stack to
`build/browser-port/game/boot-report.json`. A worker enforces a 12-second hard
limit even if Wasm spins without host calls. Reports distinguish platform-test
success from game-boot failure. The default build omits the diagnostic imports
and rejects unresolved runtime symbols; diagnostic output must not be deployed
as a game. Builds publish their Wasm output atomically and fingerprint included
headers to prevent stale object reuse.

Validation added here covers queued callback ordering and interrupt state,
arena bounds, PAD state, DVD reads, ARAM round trips and bounds rejection,
calendar/leap-day conversion, translation matrices, numeric conversion, and
exact FIFO bytes. Six asset tests cover all 112 SSM/SEM files plus typed archive
and particle-bank conversion. The existing 24 Python tests, 15,741 animation
samples and 1,000 randomized matrix checks still pass.

Remaining first-match work is substantial: complete stage/fighter/item/effect
schemas and bytecode boundaries, callback/ABI adaptations, yielding frame
scheduling, a full GX renderer, software audio, and browser-local disc storage.
The renderer/reference checkouts under `build/browser-engine/` are research
inputs only; no renderer from those checkouts is integrated. No browser combat,
mobile performance, or full OpenSmash parity is claimed.

## Animation lab executable code

`tools/build_browser_port.py` compiles upstream `fobj.c`, `aobj.c`, `spline.c`,
`mtx.c`, and `ftcommon.c` to wasm32, using Emscripten's math library. Section
collection retains the called functions. No dummy platform implementations or
undefined-import allowances are linked. The resulting module has no host
imports. `-DLINT` enables the upstream size/offset assertions; pointers are 32-bit.
Floating point contraction is disabled. This is not a claim of PPC bit accuracy.

The module exports bounded adapters for track loading, seeking, stepping, HSD
scale-compensated matrices, and two original fighter physics functions. The
latter are tested building blocks, not a replacement combat simulation.

Game archive fields are decoded explicitly as big-endian. FigaTree compressed
tracks retain their original bytes (their scalar encoding is little-endian).
The track adapter validates complete scalar and varint reads, finite floats,
formats, pack limits, and storage limits before calling the upstream decoder.
Malformed, duplicate, and unsupported channels fail explicitly. Original PPC
varargs are replaced by compiler-owned varargs in an include overlay.

The local WebGL 2 lab uses independently decoded output DAT geometry and
textures, four blended weights, and archived inverse bind matrices. It has
fixed 960×720 rendering, shared framing, bind pose, animation selection,
frame seek, pause/play, three views, and GPU transform-feedback validation.
HSD builds local matrices in Wasm; the adapter composes the hierarchy and
uploads skin matrices. Quaternion/instance/independent matrices, paths, IK,
visibility, GX materials/TEV, animation blending, and model-owner variants are
not validated by this lab. Original HSD joint/scene traversal is not yet linked.

## Reproduce

The local verified game extraction and revision-6 character DATs must exist.
`MELEE_EMSDK` can override the adjacent OpenSmash emsdk used by the runtime build.

```sh
python3 tools/extract_browser_fonts.py
python3 tools/audit_browser_port.py
python3 tools/build_browser_port.py
python3 tools/extract_browser_animations.py
node browser-port/tests/animation.test.mjs
node browser-port/tests/matrices.test.mjs
python3 tools/prepare_browser_lab.py
python3 tools/serve_browser_lab.py
```

Open `http://127.0.0.1:8766` and run **Validate GPU skinning**. Nothing needs a
Dolphin window or an AeroSpace change. Game fonts, animations, and skeleton
assets stay in ignored local build directories; this directory is not a public
website distribution.

## Evidence on September 8, 2026

- Compile audit: 984/984 game/HSD translation units, no errors, 330 unresolved
  external symbols across the complete object inventory. Two source adaptations
  are generated separately; matching upstream files are untouched.
- All 195 Mario animation archives: 15,741 finite-pose samples, two loops per
  animation, sequential-versus-seek checks, and independent analytic linear /
  Hermite / signed fixed-point checks pass. Four archives have 52 joints;
  they pass interpreter checks but are excluded from the 61-joint costume lab.
- Original HSD matrix builder versus independent double-precision equations:
  1,000 randomized cases including signed/nonuniform parent scales, maximum
  error 4.08e-6. Archived bind-matrix identity residual: 8.00e-6.
- GPU transform feedback: 24 character/pose combinations (Rowan, Steve Jobs,
  Dracula; bind, idle, run, jab, aerial attack, damage, special), maximum
  vertex position difference 3.611e-6 game units in Codex's in-app browser.
- A three-quarter camera depth sign error was caught visually and fixed.
  Regression checks enforce orthogonality and the intended near direction.
- Three actual browser canvas recordings were decoded and checked: 960×720,
  540 encoded frames / 9 seconds each, idle/run/aerial attack. This verifies the
  capture, not sustained gameplay performance. `Record browser clip` saves
  through a bounded loopback-only endpoint when using `serve_browser_lab.py`.
- These are animation/skinning checks. No browser combat, sound, controllers,
  multiplayer, mobile performance, or Dolphin pose equivalence is certified.

Machine-readable reports are in `build/browser-port/compile-report.json`,
`unresolved-symbols.json`, `portability-patches.json`, and
`runtime/{build,animation-validation}.json`. GPU results appear in the lab.

## Source adaptations

`tools/browser_port_sources.py` generates patched copies into the build tree,
asserting the source context and recording original/effective SHA-256 hashes.

1. `efalt.c`: replace the direct Metrowerks `__va_arg` invocation with `va_arg`.
   The include overlay uses the target compiler's varargs ABI.
2. `grmutecity.c`: define `grMuteCity_801F2AB0`'s effect-created result as 0/1.
   Original matching C has no defined return value; the PPC instructions leave
   a residual register value. Both callers only use zero/nonzero, in the car's
   x28 field. The port returns 0 on allocation failure, 1 after initialization.
   This intentionally removes an ABI quirk; Mute City still needs runtime tests.

Generated font includes come only from the DOL with verified SHA-1
`08e0bf20134dfcb260699671004527b2d6bb1a45`, using upstream declared ranges.

## Work required for the first browser match

1. Link actual scene/fighter/object scheduling against a portable allocator,
   platform timing, input and local asset store. Fail loudly for unimplemented
   calls. Do not turn the animation lab into a hand-written imitation of combat.
2. Implement typed archive relocation/loading across fighter, common, stage,
   item, effect and material structures. Wasm32 layout similarity does not solve
   big-endian scalar fields, bitfield packing, pointer fixups, or callback IDs.
3. Implement the GX command/material backend and audio path. The lab's opaque
   skinned shader covers only the custom costume subset.
4. Drive one unmodified match with real input, stage collision, action scripts,
   damage, stocks, transitions and audio. Compare recorded input/state traces
   and representative rendered frames against Dolphin before custom integration.
5. Integrate custom roster selection, UI/audio, all required fighter retargets,
   generation/library/sharing/persistence, multiplayer and performance gates.
   See PARITY.md; no percentage-complete claim is implied by the compile count.
