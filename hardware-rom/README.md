# Experimental hardware ROM

Use `python3 build.py rom` from the repository root. See
[build targets](../BUILDING.md) for setup, path overrides and native builds.
The ROM target is optional and has separate dependencies and output from
the native engine and website. Generated ROMs and character inputs stay local.

## Loadout

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

## Design and limitations

The atlas is sampled into vertex colors. QEM simplification first welds
UV seam duplicates, then reduces the mesh to a configurable triangle
budget (700 by default). Each remaining triangle follows one joint using
its inverse BIND frame. CAN1 assets use this rigid approximation too;
virtual skeleton reconstruction, smooth skinning and accessory pinning
are not implemented. Expect seams at bending joints and loss of facial
texture detail. The converter currently supports these three annotated
model layouts, not arbitrary fighter assets.

New vertex batches never exceed 30 vertices, fitting the N64's vertex
cache. Display lists are emitted as big-endian F3DEX2 commands and use
vertex shading with texturing disabled. Both detail trees and alternate
hand display lists are redirected. Original animations and combat data
are retained. The model files grow by approximately 40 KiB each; retaining
unused original mesh data is intentional in this first prototype. A later
iteration should reuse vertex batches and reclaim the replaced geometry.

All asset file bodies are copied after the original 16 MiB ROM, and the
original table is rewritten to point there. Moving them together preserves
next-entry boundaries used to calculate external-dependency heap sizes.
Original audio and particle addresses remain intact. The verifier checks
all 2,132 entries, every unchanged payload, external ID suffixes, pointer
chains, vertex alignment and emitted triangle indices.

Menus, portraits, stock icons, names, voices and costume recolors are still
the original game's. The ROM contains three replacement fighters using the
original selection slots; it does not yet offer multiple generated skins
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
