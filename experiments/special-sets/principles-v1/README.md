# Principles v1 — first attempts, pending human review

This cohort is an explicit departure from the hand-corrected feasibility demo.
Every new prop, repeated detail, glyph, palette and motion key comes from one
fresh model implementation per character. The new generation schema forbids
named construction presets. No generated output was edited, repaired, ranked
or rerolled, and there was no model judge.

The shared input is `web-prototype/server/specials/principles.md`; both characters
used its identical hash and authoring contract snapshot. Their previous six-move
descriptions were frozen. This cohort makes two implementation calls; it does
not count a fresh description-writing call. Normal uploaded-character generation
still has two creative stages, both receiving the same principles snapshot.

## Results, not approvals

- Weird Al compiled. Twelve ground scenarios passed, then aerial-neutral contact
  delivered 7% instead of the authored 14%, stopping validation. The six untouched
  moves have native review clips, including separately captured remaining air
  moves. Review captures do not change the failed mechanical status.
- Lincoln did not compile: hit onset values decreased/repeated. The untouched
  output and exact failure are retained. No substitute was generated.
- Neither set is ready to equip. Visual evaluation is pending with the human.

`source-manifest.json` hashes the artifacts immediately after generation; publication
verifies those bytes are unchanged. `principles.json` in each case captures the
complete principle text, stage instructions, strict output schema and hashes.
`report.json` records actual provider usage, implementation-only estimates,
source commit, retained failures and clip hashes. `native-traces.json` retains
mechanical telemetry without treating it as an aesthetic score.

The general rigid `mount` control was introduced alongside these principles.
Therefore this is not a principles-text-only A/B test against the old example.
A rigid mount moves with an assembly anchor while keeping the part dimensions and
internal spacing fixed. There are no supplied named silhouettes or automatic
performance curves in fresh generation. Historical hand-corrected examples keep
their replay support and are clearly labeled as reference material.

## Next iteration

Change the shared principles, keep these descriptions fixed, and record a new
attempt directory and principle/contract hashes. Retain failures. A missing
capability should be added as a general control and labeled as a contract change,
not hidden inside a character-specific output repair. Human observations decide
the next principle changes; this cohort contains no automatic visual scores.

## Checks

306 application tests passed, including general rigid attachment behavior,
forbidden preset selection, frozen snapshots on retry, retained raw failures,
owner-only failed-set preview access, and the inability to equip failed sets.
Pipeline and review-site builds passed. Native readiness remains failed as above;
build/unit passes do not override that result. The review collector verifies
capture dimensions/frame count and input hashes and is separate from readiness.
