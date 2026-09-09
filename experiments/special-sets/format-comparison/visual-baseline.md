# Approved visual baseline: Polka Pressure

The user explicitly selected Weird Al — Polka Pressure on 2026-09-09 as the
style to preserve. Its existing brief and implementation remain unchanged:

- Engine: `experiments/custom-attacks/briefs/weird-al-polka-pressure.md`
- Engine: `experiments/custom-attacks/weird-al-polka-pressure.json`
- Renderer: `decomp/src/ft/ftcustomfx.c`, `fxAccordion`
- Original clip: https://lincoln-attack-clips.turtlesoupy.chatgpt.site/clips/weird-al.mp4

This is a reference selection, not a rewrite of the user's attack principles.
Keep the description-first/implementation-second pipeline and no production
judge loop. Cost reduction must preserve the baseline's visual richness.

## What the comparison got wrong

The historical full-set reference was a later six-move rollout, not the approved
Polka Pressure attack. Its brief had already changed the design into simpler
fork, recovery and mallet actions. Both full and reduced set formats used the
v3 renderer's maximum 16 rectangles over an entire move; Polka Pressure uses a
richer procedural renderer with detailed bellows, timed puffs, a curved pressure
wave and independently moving note trails. Reducing tokens while dropping those
features was not a meaningful same-fidelity comparison.

The reduced neutral/up implementation emitted no decorative particles, and the
props are visible for only 4–5 simulation frames. Down emits only two small chips.
The full-set props also default mostly to z=0, placing them inside/behind the
fighter's silhouette. The earlier bespoke effect deliberately used front layers.

## Capture and rendering audit

Native source frames include the full action, with entry at capture frame 514.
A depth-only diagnostic of the full-set up special made previously obscured
accordion parts visible by increasing only visual z by 120 world units. The
original comparison packages are preserved; this diagnostic is not promoted as
an approved fix and does not modify collision.

A fresh run of the original Polka Pressure using the same engine binary and
capture path shows the detailed accordion, curved wave and musical note trail.
The native ranged probe deals 14% and the move enters/cleans up exactly once.
Evidence hashes, counts and observations are in `evidence/effects-audit.json`.
This rules out a general failure of the current capture path to capture effects;
it does not claim every possible renderer issue has been excluded.

## Implication

Preserve the existing Polka Pressure baseline. The generic format needs enough
reusable effect expressiveness and correct visual depth to reproduce that level
of presentation before cheaper-model results can be judged comparable. Do not
promote the reduced rollout's mechanical passes as evidence of visual success.
