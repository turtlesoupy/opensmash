# Launch modes shared by web and native

Both launchers use `runtime/launch-options.json` and the same native/Wasm scene
hooks in `runtime/mods/launch_match.c`. Settings persist between launches.
New settings default to a random stage; a saved stage choice takes precedence.
The desktop's File → Settings menu (app menu on macOS), or Ctrl/Cmd+comma,
opens the same settings dialog as the launcher navigation.

On first boot, Melee creates its own save through the normal missing-save flow
without requiring controller input. The save persists in the local user profile.
Only the create-save prompt and its success acknowledgement are automatic;
formatting, damaged cards, other errors, and later card-menu visits retain their
normal handling. Existing saves are loaded normally.

| Mode | Destination | Settings |
|---|---|---|
| Free-for-All | Immediate controllable match | Four ports, stage/random, level, stocks, time |
| VS Menu | Original VS menu | Lineup/rules seeded for entering Melee |
| VS Character Select | Original VS roster | Lineup/rules seeded; Start advances to stage selection |
| 1P Character Select | Classic roster | P1, stocks, five Classic difficulties mapped from levels 1–9 |
| Full Boot | Original intro/title | Original menus control the session |

The scene redirect happens once. Subsequent Back, stage choice and mode changes
use the original game flow. Classic launch settings are seeded only on the first
entry, so returning to its roster preserves subsequent choices. Integrated desktop and browser launches stage custom
portraits, names and announcers for their prepared lineup. The arrows in the
original character select page through injected identities; see
[Character select](CHARACTER_SELECT.md) for controls, validation and scope.

Web: expand **Launch settings** above the roster, then click a character. Each
port can use that roster selection, another searchable custom character, or a
standard fighter. Native: use the searchable picker, configure ports, then Play.
Up to four distinct human controllers are assignable; one keyboard cannot occupy
two ports. Different custom characters sharing a moveset receive distinct colors,
with standard color zero reserved when a vanilla version is in the lineup.

## Reproducible checks

- `node --test tests/launch_options.test.mjs` checks shared protocol values,
  costume allocation, invalid inputs, controller uniqueness and stage selection.
- `python3 -m unittest discover -s tests` includes actual DAT export/relocation
  checks against all 29 costume targets and native package validation.
- `python3 tools/test_native_launch_modes.py --app APP --rom ROM --output DIR`
  runs five destinations plus a mixed four-player lineup when samples exist.
- `python3 tools/test_native_first_run.py --app APP --rom ROM --output FRESH_DIR`
  rejects a same-size wrong ROM, verifies the package and imports/runs fresh.
- `python3 tools/report_browser_fps.py` groups combat windows by runtime build,
  session and character. Three consecutive 30-second CPU-combat windows must
  meet the FPS/frame-time/audio gates for a sustained-performance pass.

Native evidence: `build/moderngekko-validation/native-launch-final/result.json`
and `native-first-run-launch-final/result.json`. Browser sessions are recorded in
`build/moderngekko-validation/browser-trace.jsonl`.

The native package currently bundles eight prepared customs, while the website
has the full 1,067-entry roster with on-demand conversion. Neither launch-mode
parity nor these checks certify complete OpenSmash product parity, all original
Melee modes, every roster character in combat, or physical gamepad compatibility.

## Renderer compatibility

WebGL rejects reversed API depth ranges. The OGL fork now uses Dolphin's forward
range convention, inverts depth comparisons and regional depth clears, and
handles negative guest ranges in vertex depth. The latter is necessary because
WebGL does not expose desktop GL depth-clamp capabilities. Verify both VS menus
and character selectors after renderer changes: a successful scene transition
alone previously hid blank menu graphics.

The native four-player sample rendered correctly but measured approximately
31–34 FPS in the isolated local test. A reduction from 3× to 1× internal resolution
did not resolve it; CPU sampling points to recompiled matrix/paired-single work
and mod dispatch. Native four-player sustained 60 FPS remains an acceptance gap.

The final O3 browser build is `649124c7433b0adb`. Four-player combat measured
46–48 FPS; two-player windows measured 59.73, 57.13 and 60.03 FPS, including one
audio-underrun window. Neither final run passes the sustained-60 acceptance gate.
See `launch-modes-browser-performance.json` and `docs/PERFORMANCE.md`.
