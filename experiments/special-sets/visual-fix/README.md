# Visual regression correction

The prior rich rollout passed mechanics but lost the approved Polka construction.
Its gold fold rectangles overlapped, keys and rigid cases scaled with the body,
and straw was small and low contrast. The trail compiler also ignored vertical
source velocity, faded immediately in steps, and rotated strokes individually.
The renderer attached every trail segment to the fighter's current root.

This correction adds explicit reusable construction to the implementation score:
`bellows`, `music-note`, `straw`, or arbitrary `pieces`. The bellows primitive
preserves the approved original's detailed geometry and compresses at hit onset;
its cases and keyboard remain rigid. Straw has a thick, outlined sheaf silhouette.
All trails receive minimum readable size, a held initial alpha followed by a
continuous fade, connected rotation, and both axes of source velocity.
An optional native v4 `anchorFrame` field retains the root at emission time.
History covers the native parser's full 300-frame duration range and resets on
entry. Dangerous cues cannot detach from their current native hitbox.

## Provenance

There were **zero model calls for this correction**. Weird Al's score was explicitly
migrated to select the three primitives. The original model provenance is retained,
and `visualRevision` records the authored migration. Lincoln's score is unchanged.
All descriptions, body tracks, hitboxes, timings, damage and launch fields are
compared exactly with the previous published packets. This is a library/compiler/
renderer fix, **not a fresh first-pass model result or a model-quality benchmark**.
Future implementation calls select construction through the strict schema. That
fresh selection reliability has not been measured here. The production path
still has a frozen description, one implementation call, deterministic compilation
and mechanical validation; no model judge, scoring, reroll or repair loop.

## Verification

`report.json` identifies the final native binary and packet hashes, all 54 scenarios,
all 12 videos, matched input checks, and the scope of visual review. Native evidence
checks real damage on every phase, misses, windup and active cancellation, landing,
recovery rise and exhausted fall. Each final video is an unmodified native capture:
1280×960, 180 frames, 60 fps, H264/yuv420p, faststart. Aerial up uses the same wider
camera as the prior published capture; aerial neutral/down start higher to complete.

The compiler suite covers rigid keys versus deforming bellows, connected glyph
rotation and opacity, anchor constraints, all supported rigs, budgets, and the
existing two-stage generation flow. Native ASan/UBSan loader tests cover anchors,
atomic rejection and four players. Native and WASM builds and browser binding
checks pass. A separate native 250-frame move exits cleanly, exercising history
past the compact format's 150-frame limit.

Native frames were inspected through setup/action/follow-through, including the
approved original, regressed output, and corrected output. Mechanical passes are
not used as aesthetic scores. The original bespoke body choreography remains
different; this correction intentionally preserves the compact set's body tracks.
