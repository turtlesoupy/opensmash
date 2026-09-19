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

## Skeletal skinning

ROM builds always use skeletal skinning and optimized triangle ordering.
LLVM clang with MIPS support, GNU MIPS binutils, and a host C++ compiler are
required; see [setup, memory budgets, and validation](skinning/FORMAT.md).

Meshes are simplified to a configurable triangle budget (700 by default).
Heads retain atlas detail through small per-triangle RGBA16 texture tiles;
bodies use vertex colors. Weighted joint transforms, canonical skeleton
reconstruction, and accessory pinning preserve the source character's pose.
Unreplaced weapons and accessories retain their original geometry and behavior.

Character select loads every fighter model. The exporter reduces texture
resolution to fit the loadout's model-growth budget and checks total asset
growth. If geometry alone cannot fit, reduce `--triangles` or select fewer
fighters. These checks are not a physical-hardware memory guarantee.

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

## Validation

See [skinning validation and performance limits](skinning/FORMAT.md) for the
current runtime tests and emulator/hardware observations. Build reports record
the exact inputs, ROM hash, model sizes, and asset-growth budget.
