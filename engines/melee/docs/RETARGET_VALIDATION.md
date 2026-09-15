# Retarget validation — 2026-09-09

Installed app: `build/native/OpenSmash Melee.app`. Previous app retained as `build/native/OpenSmash Melee Before Equipment Fit.app`.

## Changes

- Uniform, measured stature normalization against each original target; source chibi proportions preserved.
- Original Link and Marth weapons retained, with native weapon size independent of body normalization.
- Link shield clearance measured against the custom forearm. Stowed shield, sheath and sword use one assembly transform, with torso/head clearance.
- Custom combat stock emblems and damage-panel marks; bow charge effect follows the normalized fighter position.

## Validation

- 50 Python tests passed; `git diff --check` clean.
- All 48 bundled variants (8 characters × 6 targets) passed asset checks, including transparent emblem pixels, original attachment materials and uniform weapon geometry transforms.
- Lincoln inspected against all six native targets. Final Link/Marth idle views are in `build/retarget-final-idle`.
- Final Link/Marth controller-driven combat, bow/guard inputs, damage and stock loss passed. Checkpoint images and action logs: `build/retarget-final-equipment-combat`.
- Native package signature, module identity, 8 bundled characters and 5 launch modes verified: `build/retarget-final-package.json`.
- Shared browser runtime rebuilt with the release optimization settings; local servers restarted at port 5174 and 8781. Browser FPS was not measured in this pass.

## Installed native performance

Metal, Cubeb audio, 960×720 floating window, frame dumping disabled; Lincoln retargeted to Link against a CPU. Three 30-second windows after warm-up.

| Window | FPS | p95 frame time | p99 frame time |
| --- | ---: | ---: | ---: |
| 1 | 59.9404 | 17.105 ms | 17.571 ms |
| 2 | 59.9407 | 17.205 ms | 17.515 ms |
| 3 | 59.9406 | 17.177 ms | 17.631 ms |

Launch mod SHA-256: `af6166f13dc2aa79ff8bebf6df8bd5ad9ad7fb2f662da8e2b38a342b00869be9`.
Lincoln/Link costume SHA-256: `a90669019e148db8557ff82456a53c50adaa0dac5db7eba56a1c4b35ea09a8fa`.

Full timing result: `build/retarget-shipping-performance/result.json`.

## Scope

The stature and attachment corrections are visual; Melee physics and hitboxes remain original. Asset coverage includes every bundled variant; detailed visual combat review focused on Lincoln/Link and Lincoln/Marth rather than every animation of all 48 combinations.

## Hatless follow-up: Alan Turing

Ran the installed costumes without character-specific adjustments against Mario,
Luigi, Captain Falcon, Fox, Link and Marth. The matched idle screenshots show
consistent overall stature. Comparison sheet:
`build/hatless-turing-idle/comparison.jpg`.

Controller-driven Link and Marth combat passed damage and stock-loss checks.
Link's held and stowed shield, sword and sheath were visually inspected during
idle, attacks, bow use and guarding. Captures:
`build/hatless-turing-combat`.

**Initial Marth placement failure (corrected below):** descriptor-matched idle matrices confirm
Turing's sword reaches Y=-1.013 and his sheath Y=-0.389, against stage ground Y=0.
The body minimum is approximately Y=-0.045. Native weapon size was preserved,
but the shorter custom arm/hip placement can lower the weapon tips too far.
This needs a general reach/clearance rule; body-height normalization alone does
not solve every attachment pose. No runtime or costume changes were made during
this initial follow-up.

The validation mod now records original joint descriptors, and
`tools/inspect_captured_equipment.py` matches those descriptors when measuring
weapon positions. Runtime traversal indices cannot be treated as archive indices:
Link adds a shield-related joint. Verified measurements are in
`build/hatless-turing-ground-check/{6,9}/clearance.json`.

### Marth sword/scabbard identity

Compared the retarget against the original neutral (blue) Marth costume using
`--original-neutral`. Both have identical attachment visibility: scabbard joint
19 DObjs 6–9, sword hilt joint 75 DObjs 0–1, and blade joint 76 DObj 0.
The second long object at the hip is the original silver/blue scabbard, not a
second drawn sword. Earlier screenshots used red Marth, whose scabbard is brown,
which made that comparison misleading. The original low attachment placement measurements were: visible sheath minimum Y=-0.389, visible sword blade minimum Y=-1.013.
Same-costume comparison: `build/marth-sheath-original-neutral/9/capture.png`.


### Marth mount and floor clearance correction

The attachment exporter now derives a minimal outward rotation from the verified
original neutral Marth idle pose. Sword hilt and blade rotate together around the
original grip; the scabbard rotates around its belt mount. The correction preserves
native equipment dimensions and the original floor gap relative to the custom
body height, with a minimum safety gap of 0.25 model units. It is computed for each
mesh's stature fit, without character-name exceptions or hat assumptions.

Position and normal streams are transformed together and compacted per draw list.
The asset verifier checks all 48 bundled variants, including exact transformed
weapon vertices, retained materials, rigid dimensions, and Marth idle clearance.
The reference pose and original costume hash are in
`runtime/attachment-poses/marth-idle.json`.

Final comparison captures: `build/marth-placement-final-turing/9/capture.png`
and `build/marth-placement-final-lincoln/9/capture.png`. Turing's measured blade
minimum is now Y=1.099 and scabbard minimum Y=2.118, above ground Y=0.
Lincoln's blade minimum is Y=1.064 and scabbard minimum Y=1.853.
These measurements validate the reference idle pose; they do not certify collision
clearance in every animation. The correction leaves Melee's hitboxes unchanged.

Final Turing and Lincoln combat runs passed damage and stock-loss checks, with
visual review of attacks, charged neutral special, forward smash, and guarding:
`build/marth-placement-final-turing-combat/9` and
`build/marth-placement-final-lincoln-combat/9`. The validated candidate replaced
`build/native/OpenSmash Melee.app`; the prior app was retained as a local backup.
All 51 tests and the 48-variant asset/package checks passed.
