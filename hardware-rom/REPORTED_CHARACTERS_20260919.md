# Marlon / Christian export investigation

The report shows Marlon over Luigi and Christian over Mario in character
select. The screenshot does not establish the exporter version, flags, or
whether the image came from the native/web engine or an exported ROM.

The rigid exporter described below was subsequently removed. Reproduction
commands and rigid artifacts document the pre-removal investigation. ROM
exports now always use weighted skinning.

## Follow-up: controlled visual reproduction

The single-player character select (scene 17), with Luigi's token held over
his tile rather than selected, reproduces the rotating pose visible in the
report. The original Luigi bundle does not show the stray skin-colored piece
in native captures of this rotation.

A diagnostic conversion using the actual `build_rom.mesh_parts(..., 700)`
output reproduces a close visual match: arm geometry rises behind the head,
the sleeve/arm separates, and the legs twist. The probe re-encodes the rigid
exporter's rounded joint-local vertices as an OSB5 mesh with one joint per
triangle and no CAN1 reconstruction, then renders it in native BattleShip.
It uses resampled texture tiles for visibility; this is a geometry/pose
reproduction, **not an emulator capture of a ROM or a pixel-identical render**.

Two controls isolate the behavior:

- Restoring the original CAN1/TBND metadata to the same simplified rigid mesh
  removes the displaced arm behind the head. Cracks remain at arm joints.
- Coloring the probe by assigned joint (head magenta, arms green) identifies
  the piece behind the head as arm geometry, not a duplicate face.

This substantially strengthens the rigid-export explanation. It does not
establish the reporter's exporter/version. The rigid export path was later removed; see the note above.

Local evidence under `build/reported-rom-20260919`:

- `reproduction-comparison.png`: original/native, rigid/native, rigid with
  canonical retargeting/native at frame 280.
- `css-hover-luigi/contact-sheet.jpg`: native rotating-preview sequence.
- `css-rigid-joint-colors/frame_280.png`: joint-color identification.
- `probe_rigid.py`: diagnostic geometry conversion.
- `css-hover-luigi-pad.txt`: deterministic controller input for the pose.

Capture environment: `SSB64_START_SCENE=17`, `SSB64_SPGAME_FKIND=4`,
`SSB64_INJECT_FKIND=4`, `SSB64_INJECT_PLAYER=0`,
`SSB64_PAD_SCRIPT=<absolute path to css-hover-luigi-pad.txt>`,
`SSB64_SCREENSHOT_FRAMES=280`, `SSB64_MAX_FRAMES=284`, plus absolute
`SSB64_INJECT_BUNDLE` and `SSB64_SCREENSHOT_DIR` paths. Run
`BattleShip/build-us/BattleShip` from its build directory. The original
payload is `bundle-abeabf3a/4.osb`; probe outputs are
`rigid-geometry-probe.osb` and `rigid-canonical-probe.osb`.

## Actual weighted ROM capture in Ares

Ares v148, Expansion Pak disabled, successfully renders the current weighted
Luigi/Mario ROM. Six saved framebuffer captures covering front, side, and rear
idle-preview angles did not show the large displaced arm behind the head or
severe joint tearing seen in the report. This is a limited visual check, not
proof of correctness across every animation or evidence of the reporter's build.

Evidence: `build/reported-luigi-20260919/weighted-rom-idle-angles.png` and the
six `preview-luigi-idle 2026-09-19 15-49-*.png` framebuffer captures. The contact
sheet crops and enlarges the actual framebuffer; it is not a native proxy.

To avoid unreliable automated controller input, a diagnostic ROM copy boots
straight into scene 17 with Luigi selected, and forces the existing idle
rotation branch instead of the selected victory animation. Exact changes from
`opensmash.z64` to `preview-luigi-idle.z64`:

- ROM byte `0x42cd0`: current scene 27 -> 17.
- ROM byte `0x42ce4`: initial fighter 28 (null) -> 4 (Luigi).
- ROM word `0x13d15c`: `0x55c1002c` -> `0x1000002c`, forcing the existing
  idle branch in `mnPlayers1PGameFighterProcUpdate` (RAM `0x80134f5c`).
- Recalculate CIC-6103 header checksums at bytes `0x10..0x17`.

Model assets and skinning runtime are unchanged. The menu retains the selected
puck/ready banner, so this is not an exact recreation of the reporter's UI.
The original unmodified ROM also reached character select normally. An isolated
`ares-test-settings.bml` with controller keys unbound prevents menu activation
keys from accidentally starting a match while saving screenshots.

## Findings

- Both supplied OSB6 bundles parse and contain Mario and Luigi variants.
  Marlon's Luigi payload has CAN1, TBND, and BLNK metadata; Christian's
  Mario payload uses ordinary BIND skinning. No missing Luigi target was found.
- A current default build with both direct download URLs assigns Marlon to
  Fox and Christian to Mario. Both manifests prefer Mario, and the slot
  allocator moves the first fighter to another available variant. An explicit
  local loadout is necessary to reproduce the reported Luigi/Mario pairing.
- The explicit Luigi/Mario build at 700 triangles passes the ROM structural
  audit. The actual compiled MIPS runtime passes all 17 existing runtime tests
  against these assets, including menu pose, shoulder lift, interior translation,
  normal/position comparisons, and four distinct output buffers.
- Native BattleShip captures of Marlon's Luigi payload in character select and
  the versus introduction did not reproduce the reported torn geometry. These
  are native captures, not evidence of emulator or hardware visual correctness.

The older rigid exporter is a plausible explanation, not a confirmed diagnosis.
It assigns whole triangles to individual joints, which permits cracks during
animation, and explicitly does not reconstruct CAN1 virtual skeletons. Luigi's
canonical payload needs that reconstruction. The default weighted exporter
supports it. Do not change Luigi's joint mapping based solely on this report.

## Local reproduction

Artifacts are under `build/reported-rom-20260919` (downloaded inputs, explicit
`luigi-loadout.json`, native screenshots) and `build/reported-luigi-20260919`
(compiled ROM, build report, generated MIPS source). Capability URLs and ROM
bytes are intentionally not included in this document.

From the pipeline repository root:

```sh
python3 build.py rom \
  --loadout build/reported-rom-20260919/luigi-loadout.json \
  --assets build/reported-rom-20260919 \
  --vpk0 ../ssb-decomp-re/tools/vpk0cmd \
  --output-dir build/reported-luigi-20260919

PYTHONPATH=build/debug-test-deps \
SKIN_ROM=build/reported-luigi-20260919/opensmash.z64 \
SKIN_CANONICAL_MODEL=323 \
python3 -m unittest discover -s hardware-rom/skinning -p 'test_mips.py'
```

The test harness now accepts model IDs via `SKIN_BASE_MODEL` and
`SKIN_CANONICAL_MODEL`, and derives the corresponding fighter kind correctly.
Defaults remain Mario (296) and Samus (320).

## Slot sweep and actual rigid-ROM control

Marlon's OSB6 provides ten variants: Mario, Fox, Samus, Luigi, Link,
Captain Falcon, Kirby, Pikachu, Jigglypuff, and Ness. Donkey Kong and Yoshi
are absent. All ten were individually built with the current weighted
exporter at 700 triangles and passed structural verification. Face texture
size is 12 except Kirby/Jigglypuff (8, reduced to fit the model budget).

Ares framebuffer captures of each slot's rotating idle preview did not
reproduce the reported displaced arm behind the head or severe tearing.
Fox and Luigi use the earlier two-character ROM captures; the other eight
use the individual sweep builds. Kirby and Jigglypuff have different body
proportions; this check does not validate every animation or judge those
proportions against the native engine. Native accessories (Fox's tail,
Samus's cannon, Link's equipment, Pikachu's tail) are intentionally retained
by `convert_rigged.py` and must not be classified as stray geometry.

The staged Marlon mesh in the automatic two-character build exactly matches
`extract(bundle, 1)` (Fox). Both characters prefer Mario. `assign_rom`
reassigns the earlier character to Fox when the later one takes Mario;
reversing their input order reverses which character takes Fox. Exporting
Marlon alone selects Mario. No target/payload mismatch was found. All 21
`tests/test_characters.py` tests pass.

An actual `--no-skinning` Luigi ROM, using the same explicit Luigi/Mario
loadout and 700-triangle budget, also passed structural verification but
visually reproduces the failure class: displaced arm beside/behind the
head and separated/distorted arm/torso geometry. This is now actual Ares
ROM evidence, superseding the earlier native proxy as the strongest
reproduction. It is not a pixel-identical comparison to the report.

Artifacts under `build/reported-sweep-20260919`:

- `weighted-sweep.png`: ten-slot contact sheet, four angles per slot.
- `rigid-luigi-angles.png`: actual rigid ROM framebuffer crops.
- `build_sweep.py`: reproducible ten-slot builds and diagnostic boot patches.
- `contact.py`: builds the weighted contact sheet from saved Ares frames.
- Each named slot directory contains its local loadout, extracted mesh,
  build log, original exported ROM, and diagnostic preview copy.
- `rigid-luigi/` and `rigid-build.log`: rigid control build and captures.

All preview copies use the startup/idle-only patches described above;
model data and skinning routines are unchanged by these diagnostic patches.

## Unresolved

The rigid export path has been removed. The reporter's ROM/exporter version remains unknown.
The ten-slot current weighted preview sweep did not reproduce the failure;
the actual rigid Luigi export did reproduce the failure class. Physical
hardware, all gameplay animations, and Christian's full variant set were
not tested. The next decisive input is the affected ROM or exporter
command/version, to confirm whether it used rigid export.
