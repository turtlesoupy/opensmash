# Engine integration notes

These references use the pinned upstream checkout, not assumptions about a
generic glTF animation engine.

| Upstream source | Consequence for this backend |
|---|---|
| `src/sysdolphin/baselib/archive.h`, `archive.c` | DAT has a 32-byte header, data, relocation offsets, public/extern tables, strings. Preserve original offsets when appending. A relocated zero is a pointer to data offset zero, not null. |
| `src/sysdolphin/baselib/jobj.h` | 64-byte on-disc HSD_Joint; inverse bind pointer at +0x38. Runtime HSD_JObj is a different structure. |
| `src/sysdolphin/baselib/jobj.c:JObjLoad` | Copies archived envelope matrices. Those are authoritative for binding; do not substitute guessed Euler hierarchy products. |
| `src/sysdolphin/baselib/pobj.h` | PObj descriptors reference GX vertex arrays/display lists and null-terminated envelope descriptor lists. |
| `src/sysdolphin/baselib/pobj.c:SetupEnvelopeModelMtx` | Loads at most ten blended matrices per PObj. Each palette entry is a complete weight combination, not an individual bone. |
| `src/sysdolphin/baselib/displayfunc.c:_HSD_mkEnvelopeModelNodeMtx` | Model ownership changes the right-hand skinning matrix. Root-space and other model owners must not be conflated. |
| `src/melee/ft/ftparts.c:ftPartsSetupEnvelopeMtx` | Fighter-specific z-scale path also uses ten entries. Single-weight fast path differs from general inverse-bind blending; root-space exports use two equal entries for those vertices. |
| `src/melee/ft/ftparts.c:ftParts_SetupParts` | Traverses joint and DObj indices into fighter tables. Preserve tree and descriptor count/order; adding an arbitrary new bone can break game logic. |
| `src/melee/ft/ftdata.c:ftData_80085820`, `ftData_800858E4` | Costume data and material-animation symbol lookup. These are candidate integration points for a runtime custom roster, not patched yet. |
| `src/sysdolphin/baselib/tobj.h`, `mobj.h` | Target texture/material descriptors; prototype emits diffuse textured opaque material with RGBA8 tiles. |

The prototype appends custom geometry and changes PObj pointers on existing
DObjs. It leaves unused original archive data in place to keep all offsets
valid, so current DAT size includes the original mesh data. A compacting
rewriter would need full pointer/type reachability, including external chains.

The source reader currently accepts one skinned mesh node, one opaque material,
four influences, explicit inverse binds and embedded textures. Unsupported
features should be expanded deliberately with fixtures, not silently dropped.
