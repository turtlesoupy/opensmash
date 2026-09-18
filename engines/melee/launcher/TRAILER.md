# Melee trailer capture

Open `/melee?demo=1` in Chrome and select your local Melee disc if needed.
Thomas is the first fighter in the grid. The trailer controls automatically
prepare Thomas (Mario), Gandhi (Sheik), Eliezer Yudkowsky (Young Link), and
vanilla Marth on Peach’s Castle. Saved mode, targets and multiplayer assignments
do not override this preset.

Wait for **VS ready**, press **H** to hide capture controls, then click Thomas.
The already-mounted engine releases its real VS animation on that click.
Press **Escape** to reset and prepare another take. Choose a different trailer
player in the controls before recording and wait for readiness again. Clicking
an unprepared player arms that player; it cannot reveal instantly on the first
click. H shows the controls again.

This is a browser capture path. It requires the matching hold/reveal protocol
in `melee-pc/platforms/browser/runtime.mjs`; deployments must include that updated
runtime as well as the launcher changes. No WASM rebuild is needed for this
JavaScript-only runtime change. Normal `/melee` launches retain their usual flow.

Validation: launcher preset tests cover cast, devices and four distinct targets;
runtime tests cover the held VS scene, explicit reveal, and normal auto-release.
Browser grid order was checked, but the full local-disc reveal was not verified
because the browser automation file chooser rejected the local ISO selection.
