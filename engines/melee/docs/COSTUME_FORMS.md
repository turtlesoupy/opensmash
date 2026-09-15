# Bowser / Yoshi custom costume visibility — 2026-09-14

Custom costume generation removed the original alternate forms, even though
Melee still switches away from the custom body during those moves. Preserve
Bowser's shell (neutral costume joint 23, global DObjs 65–99) and Yoshi's egg
(joint 3, global DObjs 34–35), including their original materials, textures and
polygon data. The original visibility tables continue to control transitions.
The custom body remains in its existing slot; no joints or DObj indices change.

`costume_forms.py` identifies these forms by the original exported symbol, which
also supports older profiles without `base_fighter`. Both ordinary exports and
the compacted host-skinning export retain the forms. Cache version checks rebuild
old affected costumes during preparation, including the compact variant used
for larger matches. Other fighters do not need a cache rebuild for this change.

Validation:

- `python3 -m unittest discover -s tests`: 156 tests, successful, one skipped.
- The new costume regression checks use optional local Melee data to verify
  original geometry and texture preservation, unchanged DObj counts, suppression
  of unwanted body geometry, and drawable alternate visibility states in
  ordinary and compacted exports.
- Native static-recompiled engine, Metal, controller-driven Turing/Bowser:
  jump, double jump, shell visibility and return to the custom body captured.
  `build/costume-forms-validation/native/bowser/frame-300.png` shows the custom
  fighter's green shell; frame 350 shows the custom body after the jump.
- Turing/Yoshi Egg Roll captured with a visible egg in
  `build/costume-forms-validation/native/yoshi/frame-300.png`.
- Turing and Lincoln Bowser/Yoshi cached neutral costumes were refreshed locally,
  including compact host exports. Turing compact outputs are approximately
  740 KiB (Bowser) and 552 KiB (Yoshi), below the 2 MiB slot limit.

This changes costume assets and preparation only. It adds no per-frame hook or
recompiler change. Frame dumping was enabled for visual validation; these runs
are not performance measurements. No release or deployment was performed.
