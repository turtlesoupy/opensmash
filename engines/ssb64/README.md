# Smash 64 integration

`launcher/launch-options.mjs` translates the shared launcher's match and controller
choices into BattleShip's engine protocol. The old `web-prototype/src/launch-options.js`
path re-exports it so existing callers and tests keep working.

BattleShip remains the pinned/forked upstream engine described in the root README.
Its checkout can remain beside this repository or at `BattleShip/`; it is not
copied into the Melee source tree. Existing `python build.py native` and
`python build.py rom` entry points retain their behavior and output directories.

A unified native desktop shell for both engines is an integration acceptance
requirement. The existing generated SSB64 native launcher is not that shell.
