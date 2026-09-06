# Experimental hardware ROM

Use `python3 build.py rom --characters queen,50cent,abrahamlincoln` from the repository root. See
[build targets](../BUILDING.md) for setup, path overrides and native builds.
The ROM target is optional and has separate dependencies and output from
the native engine and website. Generated ROMs and character inputs stay local.

## Original local sample loadout

Use `--loadout hardware-rom/loadout.json --assets /path/to/play` for this
original fixture. Website selection also supports all twelve base slots.

| Select this original slot | Baked model | Triangles |
|---|---|---:|
| Mario | Queen Elizabeth II | 700 |
| Luigi | 50 Cent | 700 |
| Captain Falcon | Abraham Lincoln | 700 |

Selection masks in VS, 1P, Bonus and Training are patched to expose all
fighters, regardless of the save's unlock mask. The four instruction
preimages were verified against the matching US ELF and base ROM;
`unlock-patches.json` records each offset and replacement. Each replacement
loads `0x0fff` into the same register instead of reading the saved mask.
These instructions lie outside the CIC checksum range. Saves are not
rewritten by this patch. Existing game behavior still controls save writes.

## Default skinning path

ROM builds use skeletal skinning and optimized triangle ordering by default.
See [skinning setup, memory budgets, and validation](skinning/FORMAT.md).
Use `--no-skinning` to build with the earlier rigid implementation described below.
Both the top-level driver and the standalone builder/auditor accept this flag.

## Rigid fallback design and limitations (`--no-skinning`)

The head retains atlas detail through small per-triangle RGBA16 texture tiles;
the body uses vertex colors. QEM simplification first welds
UV seam duplicates, then reduces the mesh to a configurable triangle
budget (700 by default). Each remaining triangle follows one joint using
its inverse BIND frame. CAN1 assets use this rigid approximation too;
virtual skeleton reconstruction, smooth skinning and accessory pinning
are not implemented. Expect seams at bending joints and loss of facial
detail outside the textured head. All twelve normal US fighter model layouts are supported. Later joint trees
and separate weapon/accessory tables retain their original forms.

New vertex batches never exceed 30 vertices, fitting the N64's vertex
cache. Display lists are emitted as big-endian F3DEX2 commands and use
vertex shading for the body. Head tiles use `LoadTile` and linear big-endian
RGBA16 data; source UV seams are preserved by sampling the nearest original
surface. Nearly uniform tiles use vertex shading when every RGB555 channel
stays within two levels of the texture samples; sharp facial details stay textured.
The head combiner uses `DECALRGBA, PASS2`: fighters render in two
cycles, so the second cycle must preserve the first cycle's color rather
than sample an unloaded adjacent tile. Tiles default to 12x12 and reduce to 8x8 or 4x4 to fit the 256 KiB
reloc-file limit and a shared 320 KiB model-growth budget. Character select loads
all twelve models, including fighters that are not selected. The build and audit
also enforce a conservative 352 KiB growth limit across all changed assets; this
is not a measured hardware memory guarantee. If geometry alone cannot fit,
reduce `--triangles` or select fewer fighters. Local loadouts can set `face_texture_size` to 0 for the
earlier vertex-color path. Both detail trees and alternate
hand display lists are redirected. Original animations and combat data
are retained. Head textures add memory beyond the earlier ~40 KiB geometry growth;
unused original mesh data is also retained. A later
iteration should reuse vertex batches and reclaim the replaced geometry.

All asset file bodies are copied after the original 16 MiB ROM, and the
original table is rewritten to point there. Moving them together preserves
next-entry boundaries used to calculate external-dependency heap sizes.
Original particle addresses remain intact. New announcer samples are appended,
with only their existing sound-bank sample offset and length updated. The verifier checks
all 2,132 entries, every unchanged payload, external ID suffixes, pointer
chains, vertex alignment and emitted triangle indices.

Website builds also bake OSBV portraits, custom name lettering on the selection
and versus screens, stock icons (all costume palettes), menu/HUD emblems and
announcer audio. Menu emblems use private sprites per slot, so replacing Mario
does not change Luigi's emblem. Stage-series symbols and opening art remain
vanilla. Voices use the original ADPCM predictor books and compensate for the
game's per-name pitch; samples stream from ROM through the existing DMA path.
No full PCM clips are added to RAM.

Website loadouts set `menu_scale: 1.15` to enlarge previews. This adjusts the
menu/results scale table only; gameplay scale and collision data are unchanged.
Local loadouts default to 1.0 and may override it from 0.5 to 2.0.

Name texel row widths match the render tile line stride calculated from the
drawn width (8-byte alignment). Using an unrelated 64-texel row length causes
scrambled text on hardware even when an offline sprite decoder looks correct.

For a local loadout, add `ui` and `voice` paths relative to `--assets` alongside
`asset`. Omit either field to retain that part of the vanilla presentation.
ROM UI needs an OSBV pack; regenerate older OSBU assets.

The ROM contains up to twelve replacement fighters using
the original selection slots; it does not yet offer multiple generated skins
per slot. Physical-console validation and a full four-player/scene stress
test remain necessary before calling this hardware-ready.

## Emulator validation

The prototype was tested using [ares v148](https://github.com/ares-emulator/ares/releases/tag/v148).
The automatic tutorial exercises the Mario and Luigi replacements. See
`VALIDATION.json` for the exact artifact and limits of those observations.
Physical hardware and manual four-player validation remain pending.

## v2: bind orientation correction

The v1 exporter transposed serialized BIND matrices a second time. The
OSB writer already converts its basis-vector arrays into matrix rows,
and BattleShip reads those nine floats directly into `jm[row][column]`.
The exporter now follows that convention before solving for joint-local
positions. This corrects the backwards Queen and applies to all fighters.
A regression test uses a quarter-turn and nonuniform scale so an accidental
transpose cannot pass. The Queen input's worst bind round-trip error drops
from 256.45 units to floating-point noise (2.85e-14). V1 is superseded.
