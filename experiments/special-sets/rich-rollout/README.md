# Rich compact special-set rollout

This revision makes the rich score the on-demand pipeline default, with Luna
for both description writing and implementation. Generation has two calls and
no judge, ranking, aesthetic repair or automatic retry. The existing upload job,
validation worker, artifact persistence and equip flow use the new contract.

## Results

- Weird Al and Lincoln: all six contexts each, **54/54 native scenarios**.
- All authored hits apply their exact allocated damage in contact probes, with
  native reaction. Probe targets are positioned at each hit; this does not claim
  every multihit naturally combos against a moving opponent.
- Natural ranged Polka contact additionally deals **4%**, without repositioning
  the target during the attack. The entire set's authored damage is separate.
- Misses, full action completion, windup/active interruption, landing cleanup,
  useful recovery height, and exhausted fall or special landing lag all pass.
- **298 automated tests** pass. All twelve rigs have compiler coverage; the two
  native character samples use Mario's rig. Native and WASM builds pass.
- ASan/UBSan loader tests cover legacy v1/v2 moves, v4 atomic reload, malformed
  parts, effect budgets, immutable snapshots and four-player registries.
- Browser bridge tests cover content/bundle/rig hash binding and player isolation.
- The 14 videos are 1280×960, 180 frames at 60 fps, H.264/yuv420p with faststart.

Displayed API costs include writer and implementer: **$0.01055975 Weird Al** and
**$0.01196145 Lincoln** at the standard rates checked 2026-09-09. They exclude
native validation/capture and hosting. All five development generations total
**$0.05231066**, including failures, across ten model calls. See `attempts.json`.

The displayed scores are unedited recorded model outputs, recompiled after
shared compiler/runtime corrections. They are **not fresh first-pass wins**.
No generated-output hand edits or model judges were used. The original failures
remain in `attempts/`; final packets, native reports and filtered telemetry are
in `weird-al/` and `lincoln/`.

## Representation and visual review

The compact score defines explicit poses and relative action rhythm, reusable
repeated prop details, animated assemblies and small trail glyphs. The compiler
fits action and pose timing together, supplies layered collision-bound curves,
allocates damage, and bakes staggered falling trails. The signature assembly is
sized relative to the fighter, and default depth avoids hiding it in the body.

The minified expanded runtime JSON is roughly 47–49 times larger than its compact
score. That is a byte-size comparison of the **same implementation**, including
computed numeric coordinates; it is not a measured model-token savings factor.
Comparisons against the bespoke Polka reference are different art/choreography.

Development visual inspection checked all twelve action captures and the matched
Polka reference. Signature props, waves and fragments now appear. The original
bespoke accordion remains more intricately authored; generated geometry and
poses are not claimed visually equivalent or balance-qualified. The page shows
both so the differences are reviewable rather than hidden behind mechanical tests.

## Capture and gameplay corrections

The old aerial fixture started just above a platform and could land-cancel after
about twelve frames, hiding the finale. Neutral/down aerial showcases now start
at height 2400, with separate low-height landing checks. The camera clipped a
high aerial-up prop, so that preview uses a wider camera. Its gameplay telemetry
is identical to the ordinary-camera miss (`capture-proof.json`). This is a
capture framing change, not a gameplay alteration.

A horizontal ground impulse formerly switched the fighter into air, then
immediately landed and cancelled itself. It now uses native ground velocity and
friction. Up recovery has an enforced vertical speed floor and immediate air
launch. Recovery tests accept native special landing lag as well as special fall.

The prototype remains offline in isolated worktrees. Shipping requires deploying
the paired pipeline/native/browser builds and configuring the native worker;
production enablement and netplay are not part of this local rollout.
