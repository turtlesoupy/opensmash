# Experimental roster sweep

The local sweep exports Turing (hatless) and Lincoln (hat) onto all 27 fighter rigs, including separate Popo and Nana costumes. All 54 exports succeeded. The native picker now exposes all 26 selectable targets for the two probed characters. New targets are labeled experimental; Kirby and Jigglypuff are labeled big head. Other custom characters retain their previously bundled choices.

Run from the repository:

```sh
python3 tools/probe_retarget_roster.py
python3 tools/probe_retarget_native.py --case ice-climbers --output build/retarget-roster-probe/native-texture-fixed
python3 -m unittest discover -s tests
```

Requires the locally extracted game, sibling opensmash character sources, existing animation Wasm, and installed native build. Native output directories must be new. Generated game data stays under ignored `build/`.

Open `build/retarget-roster-probe/index.html` for the overview, three detailed comparison sheets and JSON report. Columns compare bind, idle, run, jab and the second source character. Each row shares a camera across its poses; camera scale differs between rows. Pose sheets use texture-only CPU rendering and omit retained native equipment. They are geometry diagnostics, not lighting or performance evidence.

## Repairs and validation

- Added explicit experimental mappings for missing finger/hand endpoints, shared head anchors, and Kirby's different neutral skeleton.
- Collapsed target segments retain source volume rather than producing singular scales. Existing six-target fit positions remain unchanged in regression checks.
- Reapplied head proportion preservation after surface fitting. The initial humanoid sweep had maximum head-height fraction error 0.55%. Big-head fits intentionally change this ratio; their dedicated regression test checks uniform core-head scaling and intact topology.
- Retained Ice Climbers' hammers and selected Roy/Young Link equipment. Unbound rigid equipment is accepted only with unit-scale ancestry.
- Redirected original body texture animation frames to the replacement texture while preserving animation IDs/counts. Removing those animations caused a fighter initialization assertion; preserving and rebinding them passed the native check.
- All 56 Python tests pass; JavaScript syntax and diff whitespace checks pass.

## Native evidence

Pikachu boots and moves with Turing (`native/pikachu`). Ice Climbers spawns both retargeted actors and follows during movement, with correct blue body textures and both hammers (`native-texture-fixed/ice-climbers`). Actor telemetry records distinct Popo and Nana actors on both ports. Captures are on Battlefield, using the fixed native window. Frame dumping is not an FPS benchmark.

The earlier `native/ice-climbers` capture shows the overwritten body texture; `native-fixed/ice-climbers` records the rejected animation-removal attempt. Use `native-texture-fixed` for the successful result.

## Remaining judgement and coverage

Kirby and Jigglypuff now use the OpenSmash-inspired big-head fit: uniformly enlarged head, hidden internal torso, independent hands and shoes. Idle/run native captures pass; copy abilities, inhale/inflation and the full attack set remain experimental. Pikachu/Pichu, Bowser and Mewtwo have intentionally unusual crouches/stances worth visual review. Samus still needs cannon state handling. Roy/Young Link equipment exports have not received full native mounting/combat validation. Game & Watch's 2D mechanics need native review with the 3D source mesh.

Other targets have sampled original-animation and export validation only. The matrix-only preview skips DK visibility channels and cannot decode Yoshi's selected aerial format. Global in-game sizing, attack coverage, transformations and all-character combat acceptance remain unverified.

## Native picker packaging

`tools/bundle_probe_targets.py` bundles probe profiles into optimized native costumes, including every original color slot and compact textures for larger lineups. The native app build calls it when local probe outputs exist. To refresh an existing local app's assets, run it with the app's `Contents/Resources` directory, then rebuild the launcher and re-sign the bundle. `runtime/retarget-options.json` records the original costume table order from each fighter's decompiled `Fighter_CostumeStrings` table.

Ice Climbers slots carry matching Nana companion files through launch planning and integrity validation. Game & Watch uses one shared archive for all colors, so mixed original/custom or distinct custom Game & Watch lineups are rejected with an explanation. The picker launch was checked with Lincoln as Ice Climbers against Link: both Lincolns, hammers and stock icons rendered, and the window reported 59.9 FPS. This brief observation is not a full performance benchmark. The new choices are native-only; the browser launch path is unchanged.

## Big-head validation

The latest `big-head.jpg` compares Turing and Lincoln on Kirby and Jigglypuff. `opensmash_melee/ball_fit.py` uses the source skin weights and jaw/collar geometry to keep the head shell intact, tuck the torso inside it, and attach hands/feet to their own animated anchors. It preserves every triangle and UV. The original OpenSmash reference is the ball-mode block in `pipeline/pipeline/convert_rigged.py`.

Kirby's neutral body occupies different visibility variants. Root DObj 0 is hidden during ordinary play; the custom body now occupies root DObj 6, in the common limb group. Presentation metadata is mirrored onto the first root material for the runtime's fast identity lookup, preserving its original texture-animation inputs. Native captures: `native-ball-visible/kirby` and `native-ball-diag/jigglypuff`. Earlier `native-ball/kirby` captures intentionally retain the invisible-body failure for diagnosis.

## Hand clearance refinement

Ball-mode fists now use a smaller uniform scale (0.42 rather than 0.58 times the head radius divided by source fist span). The compressed shoulder/forearm bridge starts lower inside the head, away from the face and ears. `tools/fit_ball_hands.py` fits per-hand bind offsets against the head's convex hull over 67 Kirby and 182 Jigglypuff samples from idle/run/jab/aerial clips. SciPy is an offline fitting dependency; the runtime receives ordinary skinned vertices and has no added per-frame solver.

All tested fist-hull vertices are outside the head hull after fitting. This sampled diagnostic does not certify every triangle, intervening animation frame or move. `tools/preview_ball_hands.py` writes `hand-clearance.jpg` for visual comparison. Feet retain the source shoe geometry, original UVs and source texture; their dark appearance comes from the characters' authored shoes. Regression checks ensure the hand adjustment leaves shoe positions and UVs unchanged.
