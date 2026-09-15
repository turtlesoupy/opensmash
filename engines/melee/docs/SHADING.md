# Fighter lighting validation

Custom costumes use Melee's textured diffuse lighting (`0x14`) and Mario's
neutral material colors (`0xb3b3b3ff` ambient and diffuse), with diffuse texture
replacement (`0x50010`). The material-only migration preserves textures,
normal arrays, geometry, head fit and animation. Surface conversion also applies
the corrections described below.
Specular is disabled for the single-material costume so skin and clothing do
not acquire a uniform plastic gloss.

The old exporter wrote `0x15`. This is not an additive combination of working
lighting flags: `HSD_SetupChannelMode` in `melee/src/sysdolphin/baselib/state.c`
switches on `rendermode & 7`. Only case 4 selects the ambient/directional diffuse
lights; case 5 falls through to the unlit channel. Original Mario's body
materials use `0x14`. His occasional shiny details use separate materials.

The diffuse texture must also use `TEX_COLORMAP_REPLACE`, as do 54 of Mario's
textured body draw objects. `TEX_COLORMAP_MODULATE` (`0x40010`) multiplies the
texture by the material's 179/255 diffuse color before lighting. Leaving that
operation in the first lighting fix dimmed the retarget by another 30%.
Replacement removes this extra attenuation while retaining Melee's directional
and ambient lighting. It does not add a global exposure adjustment or specular.

`opensmash_melee/materials.py` migrates only the exact unlit and first-lit exporter signatures.
The local asset server migrates previously prepared native/browser caches on
selection. Native packaging migrates cached source costumes before making
color-slot variants. Already-correct archives return byte-for-byte unchanged.
The source-only native builder includes this dependency without requiring NumPy.

## Repeat the isolated comparison

After building the native app and the Alan Turing Mario retarget locally, run
these cases sequentially, using a new output directory for each review:

```sh
python3 tools/validate_shading.py --costume build/characters/alanturing-mario-game-v1/PlMrNr.dat --case mario --frames 300 --output build/shading-comparison
python3 tools/validate_shading.py --costume build/characters/alanturing-mario-game-v1/PlMrNr.dat --case before --frames 300 --output build/shading-comparison
python3 tools/validate_shading.py --costume build/characters/alanturing-mario-game-v1/PlMrNr.dat --case after --frames 300 --output build/shading-comparison
python3 tools/render_shading_review.py build/shading-comparison
```

Each case boots the verified USA 1.02 executable on Battlefield, with two human
Mario ports. The tool confirms the fresh memory-card prompt through its own
controller pipe. It retains the engine's lights, textures, skinning, normals,
and projection. A validation-only mod tracks P1 with a fixed close camera,
hides the HUD/magnifier, and holds the first idle pose by stopping HSD animation
playback. `game.log` records the motion and animation frame. `capture.png` is
an actual native framebuffer dump; `capture.json` identifies its source frame.
The `before` case reconstructs the old material on the exact same retarget
archive; `after` runs the production migration on it.

The mod is not included in either playable build. Its hooks and frame dumping
make this an image-quality check, not an FPS benchmark. Use the ordinary local
browser/native launch for combat and performance validation. Existing CPU-only
shape previews are unlit and cannot validate this bug.

The initial September 9 local comparison in `build/shading-comparison/` verified idle
frame 0 in all three captures. The migration changed exactly seven material
bytes in each of 26 prepared native/browser archives. The rebuilt native app
passed signature and asset-hash verification for all 39 costume slots across
eight custom characters. Two browser combat windows (Alan Turing versus CPU
Mario on Battlefield) measured 59.97 and 59.55 FPS over 30 and 31 seconds,
respectively, with zero audio underruns; the second window had two frames over
33 ms. Warm click-to-match was 1.82 seconds. These samples do not establish
four-player or all-roster performance parity.

The follow-up in `build/shading-texture-response/` compares original Mario,
the first lighting fix, and corrected texture replacement, all at idle frame 0
with identical camera settings. The original and previous captures are reused
unchanged with their provenance recorded in `reference.json`. Upgrading a
first-lit costume changes exactly one texture-operation byte. The generated
mesh's albedo, detailed texture work, and authored normals still differ from
Mario's artwork; matching the material response does not make those identical.

The follow-up migrated 26 cached costumes by one byte each, and the rebuilt
native package passed signature and bundled-asset verification. All 34 Python
and 7 Node tests passed. A fresh local browser combat sample ran at 28.87 FPS
over 31 seconds with no audio underruns; it failed the 60 FPS target. Other
Chrome processes were busy during that sample, but this does not establish the
cause. The earlier 60 FPS result must not be treated as validation of this run.

The change restores the shared lighting response. It does not replace source
artwork, add detailed Mario-style cloth textures, smooth authored normals, or
claim that every generated character has identical art direction.

Regression checks:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.mjs
```

## Source / bind / animated surface diagnosis

`tools/validate_surfaces.py` renders four stages under a shared orthographic
camera: the source GLB T-pose (uniform display scale), fitted bind mesh, geometry
and normals independently decoded from the actual native DAT, and that decoded
mesh skinned with captured Melee idle-frame-0 joint matrices. Each stage has
texture-only, neutral-gray-lit, and textured-lit rows. The CPU light is a
controlled diagnostic, **not** an emulation of Melee's GX lighting. Both texture
rows use bilinear sampling. No geometry or normals are smoothed for these views.

First capture the gray material and runtime matrices, using a fresh output path:

```sh
python3 tools/validate_shading.py \
  --costume build/characters/alanturing-mario-game-v1/PlMrNr.dat \
  --case gray --frames 300 --output build/surface-diagnostic
python3 tools/validate_surfaces.py \
  --character assets/characters/alanturing-mario-game-v1/rigged.glb \
  --costume build/characters/alanturing-mario-game-v1/PlMrNr.dat \
  --profile build/characters/alanturing-mario-game-v1/profile.json \
  --pose-log build/surface-diagnostic/gray/game.log \
  --output build/surface-diagnostic/review
```

The validation-only native mod records the completed display's joint matrices
once the idle pose has settled. The renderer verifies the held motion/frame and
every runtime joint's index and parent against the DAT hierarchy. It removes
root placement/facing for display, blends the archived envelope transforms, and
inverse-transposes the blended matrix for normals, following HSD's envelope
path. It checks decoded and pre-export positions/normals under the same pose.
The native `gray/capture.png` is the separate real-GX lighting reference. Gray
changes only the custom texture pixels; the validation material and mesh stay
identical to the current lit costume.

September 9 results for this Mario-host retarget:

- All 61 runtime joints matched. Bind-position error was below `4.77e-7`, bind
  normal error below `2.98e-8`, and UVs matched exactly. Animated position error
  was below `4.76e-7` and normal error below `3.68e-8`.
- The angular forehead, cheek and collar are visible in the **source** neutral
  gray view. They are not introduced by DAT serialization. This does not rule
  out improving source normals, but smoothing should be evaluated separately
  from silhouette/topology and preserve intentional hard edges.
- The source atlas is 2048×2048; the shipped test costume is 256×256. The fitted
  and decoded bind meshes have matching geometry/normals, while decoded eyes,
  moustache and collar lose texture detail. This isolates a texture-resolution
  loss independent of animation or lighting.
- Hand orientation, sleeve width, leg length and foot shape change at the bind
  fitting stage. Source hands already have simple mitten-like geometry. Further
  hand/foot-fit work should compare bind and animated views rather than assume
  a renderer bug or expect normal smoothing to repair the silhouette.
- Hair and shoes respond to directional light in the native gray capture. Their
  nearly solid dark source colors conceal much of that response when textured.

These checks cover one native costume and one real idle pose, not every action,
character or the browser's alternate skinning implementation. They are image
quality checks, not an FPS measurement. The 36 Python tests include gray-mode
texture independence and a nonuniform blended-transform normal oracle.


## Applied surface corrections

Surface profile version 1 now ships in the converter, cache updater and local
native/browser builds. `opensmash_melee/surfaces.py` makes three changes:

- Both exporters prefer a 512×512 atlas (four times the texels of 256×256).
  Browser conversion falls back to 256 for unusually large costumes that would
  overflow the existing 2 MiB warm-launch slot. All eight prepared browser
  characters fit at 512. This adds 768 KiB per 512-pixel texture, no polygons.
- Hands use a uniform source-shape scale and the forearm's rotation at the wrist,
  rather than aiming the hand at one target finger joint. Feet use a uniform
  source-shape scale, upright source orientation and the target ankle anchor,
  rather than stretching and pitching the shoe toward a toe marker. Torso and
  head corrections are unchanged.
- Two bounded neighborhood passes filter authored normals using a 55-degree
  compatibility threshold. Connected UV duplicate corners share a smoothing
  group, so filtering cannot create a new seam there. Authored sharp normal
  splits remain separate. No source positions, UVs, skin weights, triangle count
  or head geometry are changed by smoothing. Some angular silhouettes remain
  because this does not subdivide or replace the source topology.

`tools/upgrade_character_surfaces.py IDENTIFIER` rebuilds native and any existing
browser cache from the hash-pinned source GLB and original costume. It preserves
old artifacts under `previous-surfaces/`, replaces artifacts atomically one file
at a time, and writes the versioned profile last so interrupted migrations can
be retried. The local server invokes it before preparation; the full-project
native packager invokes it before bundling costumes. The ROM-only source builder
continues to work without the character converter or NumPy.

Evidence for the accepted correction is in `build/surface-fix/`:

- `native-v3/after/capture.png`: actual GX render of the accepted normals,
  texture and fitting. Earlier trial captures are retained but were not shipped.
- `native-comparison/comparison.png`: original Mario, previous surface, corrected
  surface with the same camera and held idle frame; no image color adjustment.
- `review/`: source, fitted/decoded bind, and captured idle matrix diagnostics.
- `cache-checks.json`: all 16 cached core head meshes are byte-for-byte equal in
  floating-point position arrays before/after; migration is idempotent.
- `six-targets.json`: Alan's source-head shape gates pass on all six target rigs.
- Native package signature/hash verification passed for eight characters and
  five launch modes. All 40 Python and 7 Node tests passed, including sharp-edge,
  UV seam, terminal-shape, head-preservation and browser-slot regression tests.
- Browser session `2278cc58-08c6-4748-b3c3-72bb09de0801`, 960×720, human Alan vs
  CPU Mario on Battlefield: 59.10 FPS/31 seconds and 59.07 FPS/30 seconds, with
  no audio underruns. Those intervals had 12 and 2 frames over 33 ms. Warm
  click-to-match was 3.46 seconds. This is bounded two-player combat evidence,
  not a claim of perfect frame pacing or all-character/four-player parity.
