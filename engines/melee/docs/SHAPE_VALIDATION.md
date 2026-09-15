# Source-based shape validation

Revision 6 replaces the mistaken revision 5 “chibi” squash. Chibi means
preserving the authored large head, not compressing it along one axis.
The head uses one uniform scale derived from source and fitted body spans
(ground to head anchor), and keeps the source upright orientation. Limb
fitting, skin weights, and the target skeleton are unchanged.

## Reproduce the loop

```sh
python3 tools/validate_shape.py assets/characters/rowanatkinson --out build/shape-validation/rowanatkinson --turntable
python3 tools/audit_characters.py ../opensmash/pipeline/play/ui --export --out build/character-export-audit-v6.json
python3 -m unittest discover -s tests -q
```

The first command produces the source-proportioned profile and DAT,
front/side/top contact sheet, an optional synchronized source/DAT turntable,
synthetic head/elbow/torso probes, and metrics. It borrows the staged
comparison approach from OpenSmash's `texture_check.py`, `preview_bundle.py`,
and `pose_compare.py`. The renderer uses a Z buffer; an occlusion regression
checks that submission order does not change which triangle is visible.

Every panel uses the same orthographic camera and world-to-pixel scale.
The source has one uniform display scale, aligned at the ground. The fitted
mesh is shown in the authoritative inverse-bind pose. This is close to a
T-pose but not identical: target foot pitch and arm angles differ. It is not
a capture of Melee's live animation stack or a claim of pixel parity.
Textures before export retain source resolution; the independently decoded
DAT view uses the exported 256-pixel texture.

## Gates against the source

Core head vertices (>99% head weight) must retain a similarity transform:
maximum relative residual <=2.5%, affine anisotropy <=1.03. The source-style
head/body height fraction must stay within 5% relative error. These checks
measure the actual weighted output, not the profile's declared scales.
Too few core vertices or unusual ownership is a review flag, not a pass.
The normal character build now checks these gates before export/staging.

For Rowan, source head-height fraction is 31.235%; revision 5 was 19.756%,
revision 4 was 28.683%, and revision 6 is 31.254%. Revision 5 has 1.673
anisotropy and fails. Revision 6 has 1.00064, with 0.183% maximum similarity
residual; the small residual comes from blended boundary weights.
The regression suite checks that the known pancaked profile fails.

The independently decoded DAT is skinned through synthetic joint rotations.
Rowan's maximum position difference against the pre-export mesh is below
0.000001 game units. These probes do not certify Melee action animations.
Actual combat capture remains a separate acceptance step.

All 24 tests pass, including renderer occlusion and the known-bad head
regression. The complete audit independently decoded 4,105,833 triangles
for the 1,064 passing rigs. Rowan was also rechecked in actual combat on
Yoshi’s Story (54% received / 20% dealt observed).

The source-shape audit flags Bigfoot, the Minotaur, and the Headless Horseman
for manual review; 1,064 other rigs pass. Prior reports of 1,067 binary export
passes did not certify shape. Do not relabel the three review cases as fully
validated or loosen the gate merely to reach 100%.

All reports, captures, and profiles are generated locally under build/.
The existing OpenSmash source and the original game assets are untouched.
