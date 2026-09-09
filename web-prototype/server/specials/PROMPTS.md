# Prompt ownership

- `principles.md` owns attack design: what the player should recognize, feel and
  understand. Both rich-generation stages receive this same text.
- `RICH_DESCRIBE` in `generate.js` owns the description writer's contract: six
  contexts, frozen names/timing/damage, supported mechanics and timing bounds.
  It does not specify a second creative baseline or geometry representation.
- `RICH_IMPLEMENT` and `richGenerationSchema` in `rich.js` own implementation:
  coordinates, half-extents, rigid mounts, layering, readable geometry, particle
  controls, compilation behavior and budgets. Only the implementor receives these.

Human review is separate from generation. No judge, automatic repair, reroll or
per-output hand-polishing is part of either stage.

New rich runs snapshot the principles and both stage contracts before any model
call. The principles hash identifies design text; contractHash identifies the
complete snapshot (including the implementation schema). Existing attempts resume
with their original snapshot, including older mixed guidance. Historical outputs
are not regenerated or relabeled by editing these files. The snapshot envelope
still uses `principles-only-v1`; the design document revision is independent.

The legacy `full` format keeps its historical prompts for replay/comparison. This
separation applies to the current rich pipeline. A controlled eval must pin the
format, stage contracts, model settings and inputs as well as the variable being
tested; this prompt refactor alone is not evidence of improved generated quality.

Timing uses the shared description schema bounds (startup 8–40 frames, duration
35–150 frames), plus the existing minimum duration/startup relationship. These
are capability limits, not per-slot pacing templates. The writer chooses timing
for the action; the rich compiler still reserves 12 frames after the final hit.
Landing cancellation and up-special launch behavior remain engine constraints.

Effect variety: new rich scores explicitly select `presentation` per move:
`body` uses skeletal animation without synthetic hit effects; `prop` names authored
geometry bound to the collision trajectory and lifetime; `wave` uses curved cues.
These are renderer choices, not quotas for the describer. Trails, assemblies and
the prop library may be empty. Body/prop choices can still include optional
particles or supporting assemblies. Old scores without `presentation` replay as
waves. Body presentation is carried as `dangerSource: "body"` in v4 packets and
requires the matching updated native/WASM loader. Other moves still require
collision-bound danger geometry. Body/collision visual alignment remains human
review; the flag is not proof of readability or quality.


## Predictable baseline (`explicit-v2`)

New implementations carry `authoringVersion: "explicit-v2"`. The version selects
compiler semantics, so old scores and frozen attempts retain their old geometry,
particle sizing, assembly padding and air-shift behavior. It is separate from the
principles revision and from native packet version 4.

| Category | Behavior for new implementations |
| --- | --- |
| Hard bounds | Schema limits, expanded geometry budgets, increasing keys, valid native hit windows, and usable up-special launch remain enforced. |
| Optional presentation | Body, weapon, or curved-wave presentation; particles and supporting assemblies are optional. |
| Authored geometry | Prop and glyph dimensions stay authored. No minimum 400-unit prop or 100-unit glyph enlargement. |
| Authored lifetime | Assemblies exist only between authored first/last keys. No special padding or treatment of the first assembly. Existing endpoint fades remain explicit in the prompt. |
| Weapon handoff | Supporting assemblies naming the active weapon may not overlap any active hit window after remapping, in either context. Overlap is rejected, never repaired or hidden. |
| Aerial position | `air.hitShift` moves supporting assemblies and collision together. Hit-bound weapons and particle origins inherit collision movement once. Skeletal poses still require deliberate air overrides. |
| Timing transformations | First-delay subtraction, overlap clipping, action compression, ground-to-air mapping, and integer rounding remain deterministic. The generation report records removed delay, clipped hit indices, compression factor, and actual hit times and positions for every context. |
| Style guidance | Readability and useful contrast remain guidance. Dark outlines, bright accents, fixed sweep distances, and preferred beat lengths are not mandatory. |

This baseline does not verify body-to-hitbox visual alignment or choose aesthetically
successful outputs. Reports mark alignment pending human review. No new model
calls, retries, or output polishing are introduced by these changes.


Uploaded fighters may include optional `character.moveDirection` (up to 600
characters). It is saved on the owner job, screened with the existing submission
inputs, and pinned into each special-generation job. The writer uses it as the
creative brief for the whole set, including unfamiliar characters, within the
mechanical contract. The implementor follows the frozen description. Empty or
missing direction requires no extra call or clarification. The raw direction is
not added to public roster metadata.
