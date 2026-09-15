# VS matchup intro

`launch_match.c` includes `vs_intro.h` in both native and WebAssembly builds.
It borrows Melee USA 1.02's Classic intro (`GS_INTRO_EASY`) before a two-to-four-player
VS match. Set `OPENSMASH_VS_INTRO=0` to disable the native detour.

The detour runs after normal VS setup, replaces only the scene descriptor, and
suppresses the VS results callback until real combat. On completion it repeats
the VS state, restoring its descriptor and temporary name storage before entry.
Match rules, stage, fighter code, costume colors and teams remain Melee's own.
No ISO or original extracted game file is modified by the runtime.

Custom identities are copied from the injected character-select registry before
its archive is released. Names and announcer samples are matched by fighter and
costume color, so different characters can share a moveset. The registry stores
clip durations to sequence names. The first name starts after one-third of a
second, followed by “versus,” then the remaining names, with no added inter-name gap. Custom recordings have
quiet leading/trailing edges trimmed, preserving 15 ms around speech.
Vanilla fighters use Melee's
name scripts. A or Start skips the intro after its first half-second.

The browser holds the intro while its graphics settle, then reveals its canvas
and connects audio. Combat retains its separate graphics preparation barrier.
Three/four players use two models on the left and one/two on the right; ALLY tags
are hidden. This visual grouping does not create teams. Classic's stage strip
and VS heading remain.

## Validation

```sh
python3 -m unittest tests.test_vs_intro tests.test_character_select
node --test tests/scene_preparation.test.mjs tests/launch_options.test.mjs
npm --prefix web run build
python3 tools/validate_native_vs_intro.py --output build/vs-intro-validation/native
NODE_PATH=/path/to/node_modules node tools/validate_vs_intro.cjs /path/to/melee.iso build/vs-intro-validation/browser 4
```

The native capture helper requires an existing app and verified extraction at
`assets/game`; it stages a private game tree. The browser helper requires
Playwright, Chrome, the built runtime, local asset server on 8781 and Vite on 5174.
It checks intro visibility, one name cue per active port, and transition to combat.
The C memory test checks full match-buffer preservation, descriptor/scratch
restoration, repeat-state handling, and distinct custom names/samples sharing a moveset.

Compatibility still depends on valid costume exports. The original prototype
validated compact retail-envelope costumes with four custom models; the shared
browser runtime also has host skinning for the Classic scene's generic HSD draw path.

Verified locally on 2026-09-14: native Mario/Fox and four custom characters
sharing Mario; browser Link/Samus and four custom characters using Mario/Fox.
Inspected intro captures for posed models and distinct labels. Browser logs
confirmed all four custom samples reached the mixer and both lineups reached
combat. Browser validation used the development link (`O1`); this is a functional
check, not a full performance certification across every moveset.
