# Experimental N64 skinning

ROM builds use skinning by default. Use `build.py rom --no-skinning` for the
earlier rigid-joint builder. The website and native target are unaffected;
all the usual loadout and private-character arguments still apply.

```sh
python3 build.py rom --characters thomasdimson --vpk0 /path/to/vpk0cmd --output-dir build/skinned-rom
```

The builder needs LLVM clang with a MIPS backend and GNU `mips-linux-gnu-as` /
`mips-linux-gnu-ld`. On macOS it uses Homebrew LLVM when available. The build
records its native source fingerprint under `mips-runtime/native_pose.json`.

## Parity with Battleship

`native_pose.py` extracts the canonical pose algorithm and its math helpers
straight from the configured BattleShip `ftport.c`. The ROM compiles that source,
including torso/limb/head alignment, dynamic head pitch, interior animation
translation, shoulder lift, and ground contact. It specializes array capacity
for the asset's joint count without changing those calculations.

The adapter also implements:

- Canonical arm-weight damping and shoulder proximity, baked after simplification.
- SCAL fit and native Kirby/Purin menu fit factors.
- The exact BLNK replacement list, including keeping mapped accessories such as
  Samus's cannon when BLNK intentionally omits that joint.
- Reblanking body parts every draw, including animation/LOD pointer swaps.
- Corrected transforms for retained accessories and their ancestors, plus
  ACC2/ACC3 surface pins, inset, orientation, pitch, and scale.
- Animated weighted normals, the native custom-character light, and restoration
  of conventional material state before downstream geometry renders.

`native_contract.json` guards the source regions the adapter depends on. A change
in those regions stops the build until the adapter and differential tests have
been reviewed. Do not update hashes merely to silence the check.

### Deliberate target differences

This is rendering parity, not a change to the game's collision rules. The ROM
applies accessory matrices and root fit during drawing, then restores the game’s
part pointers, matrix snapshots, lock modes, and root scale. Native code also
reseats joints during updates; the ROM deliberately preserves vanilla gameplay
state outside drawing.

N64 meshes remain simplified, positions/weights are quantized, and head textures
use small per-triangle tiles. Body materials use one base color per triangle,
modulated by interpolated animated lighting; they do not retain the full native
body atlas. Native debug environment overrides and optional, default-off dual
quaternion skinning are not ROM features.

## Memory and binary layout

The default is 700 triangles per fighter. The builder reserves 32 KiB per
context for generated vertices and caps model growth at 152 KiB / total character
select asset growth at 160 KiB. It checks four simultaneous output buffers. Face
tile size falls back when necessary; the build report records the selected size.
Use fewer fighters or lower `--triangles` if a loadout exceeds the budget.

Each shared vertex has one 16-byte bind record and one output Vtx. Cache windows
load runs from that output buffer. Skinning allocates from the engine's buffered
graphics arena, and its normal cache writeback synchronizes vertices for RSP.
Segment D holds the output vertices; E/F remain owned by the engine.

A 228-byte wrapper preserves vanilla skeleton/afterimage paths and recognizes a
SKN1 marker at joint 4. The relocatable MIPS runtime is shared through the
engine's fighter-common file (163), with one copy per required joint capacity.
An uncached bootstrap writes back data and invalidates instructions on first use,
then reuses the initialized module. Descriptor offset 16 is a common-file offset;
84 tracks initialization, and 76/80 point to pose and render metadata. SKC1 headers
record each module's capacity, size, and offset. The builder resolves GOT pointers,
initializes BSS, rejects unresolved imports, and includes shared code in the memory
budget. Output buffers require no additional per-vertex float scratch space.

To recover space, the exporter reuses only proven-unreachable tails of replaced
body display lists and vertex blocks referenced exclusively by those tails.
Original entry addresses and retained prop geometry remain intact. Incoming
references, animated part entry points, overlaps, and relocation bounds are
checked before reuse. All instruction patches get CIC-6103 checksums.

## Validation

The MIPS tests execute the actual compiled hook and runtime in Unicorn. A host
reference compiles the extracted Battleship algorithm with host libm; positions
and normals are compared for battle/menu poses, raised shoulders, interior
translation, and non-upright targets. Other checks cover accessory pins, hidden
part swaps, state restoration, duplicate buffers, insufficient memory,
degenerate transforms, and vanilla skeleton/afterimage behavior.

```sh
python3 -m pip install unicorn
SKIN_ROM=build/skinned-rom/opensmash.z64 python3 -m unittest discover -s hardware-rom/skinning -p 'test_*.py'
```

The current runtime fixture expects Thomas in Mario's slot and Casey in Samus's
slot. Emulator testing uses Ares v148 with Expansion Pak disabled. The user tested the four-character, 250-triangle build on a physical console
and reported improved skinning. Hardware frame rate has not been measured.
Never distribute the debug scene/roster ROMs.

Rigid output (`--no-skinning`) is checked byte-for-byte against the production fixture at
pipeline commit `5afc823` (SHA-256
`2e1453bfa2c9391fb22bb7841902babb330145fae45b8c91acd266c51c04f760`).

### Current performance limit

The Thomas/Mario + Casey/Samus build passes the pose tests and runs character
select and a four-CPU match in 4 MB Ares. At 700 triangles per fighter, that match
currently draws roughly 17–20 frames per second; this remains a performance limitation of the default ROM path. Both characters currently use 8-pixel face tiles to fit the memory
budget. A four-character Joey/Thomas/Obama/Frida loadout builds and passes the
structural audit at 250 triangles each. Its reordered successor was checked in
Ares character select and a four-character match, then tested on the user's
console with improved skinning reported.

### Triangle ordering

Skinned ROM exports use the configured Battleship checkout's vendored
meshoptimizer at build time (a host C++ compiler is required). They compare FIFO
and adaptive ordering against both source order and the existing greedy order,
using the ROM's 30-vertex windows. The lowest vertex-load count wins; contiguous
load-command count breaks ties. This optimization never changes vertex records,
weights, triangle winding, or triangle-associated colors and texture tiles.
Opaque body and textured-face groups remain separate. The build report records
before/after counts and the selected method for each group.

The upstream `eddd0c9` skinning change was reviewed: its Wasm SIMD path does not
change the extracted canonical pose core (the recorded pose hash is identical).
The guarded full-function fingerprint was updated after that review.
