# OpenSmash parity acceptance

The target is the full OpenSmash experience on the Melee engine. A costume
converter or animation viewer does not satisfy the request.

## Primary product requirement

Selecting a character on the website must start a controllable Melee match
using that character and its assigned base fighter. The player must be able to
fight an opponent, deal and receive damage, lose stocks, finish the match, and
rematch or choose another character. Animation previews are developer tools,
not the character-selection destination. The gallery deployment did not meet
this requirement; it must not be described as the delivered game.

The local browser now runs an actual match using the pinned MeleePad /
ModernGekko static recompiler fork. See LOCAL_RUNTIME.md. This is local Wasm
execution with WebGL; game frames do not come from a streamed native process.
The older portable-animation lab remains useful for isolated shape checks.

The actual costume build command now accepts `--target` for Mario, Luigi,
Captain Falcon, Fox, Marth, and Link. Representative builds for all six pass
export and source-shape gates. These builds are not browser gameplay evidence.

| Capability | Current Melee implementation | Acceptance still required |
|---|---|---|
| Existing generated character library | Artifacts import; 1,064 revision-6 source-shape/export passes, 3 manual-review flags | Resolve flagged rigs; representative in-game library coverage |
| Source proportions and blended weights | Independent source/GX comparison; corrected source-head fit | Full animation/contact review across body types |
| Existing base fighter movesets / arbitrary retargets | Costume builds for Mario, Luigi, Captain Falcon, Fox, Marth and Link | In-game coverage across body types, equipment and visibility |
| Combat | Native Dolphin and ModernGekko smoke tests; six custom moveset samples pass browser Battlefield combat/performance checks | Full action/mode coverage, match completion and multiple custom players |
| Browser engine | Actual Melee static recompilation, WebGL 2, input and local roster launch | Repeated human matches, additional devices and multiplayer performance |
| Browser validation | 195 animation streams; 24 GPU pose cases; bind/matrix gates | Dolphin trace/pose equivalence, browser/device matrix, four-player sustained performance |
| Custom roster alongside vanilla | Four-port custom lineup planning; distinct costume colors preserve a simultaneous vanilla fighter | Full-roster native conversion, on-demand in-game roster loading |
| Portrait/name/stock/emblem/announcer | Prepared lineup CSS portraits/names/announcers; results and HUD identity | Full-catalog in-game loading; standalone Swift CSS staging |
| Name/photo generation, retry/resume/costs | Existing OpenSmash pipeline remains available | Wire Melee outputs into its product flow |
| Download/share/public roster | Existing OpenSmash remains intact | Melee character packaging and product integration |
| Local assets/offline behavior | Verified ISO extraction for local build; local browser lab | Browser-local loading/persistence and offline product flow |
| Controllers/local multiplayer/modes | Both launchers expose the five OpenSmash modes, stages/rules and four distinct input assignments | Physical gamepads, sustained four-player browser performance and broader original-game modes |
| Performance and reliability | Exact browser skinning; sustained two-fighter combat near 60 FPS on local M5 for tested movesets | Sustained 60 FPS combat, four-player load, effects/items, memory, mobile tests |

The local ISO matches the known NTSC-U 1.02 MD5; the upstream matching build
matches the reference DOL. Neither fact certifies the portable runtime.

Current detailed evidence: [PERFORMANCE.md](PERFORMANCE.md), [LOCAL_RUNTIME.md](LOCAL_RUNTIME.md), [BROWSER_PORT.md](BROWSER_PORT.md),
[SHAPE_VALIDATION.md](SHAPE_VALIDATION.md), and [VALIDATION.md](VALIDATION.md).
The private phone review page contains renders/videos, not a browser game.

## Finish gates

1. A real vanilla match runs locally in the browser with input, sound, damage,
   stocks and match transitions, with replayable reference scenarios.
2. Custom characters retain source proportions and work in all tested actions,
   including equipment/visibility, grabs, damage, ledges, death and respawn.
3. The existing OpenSmash generation, character library, sharing, UI and control
   flows work with Melee outputs and all required retarget profiles.
4. Representative multiplayer/device/performance and visual suites pass. The
   complete library is audited without converting failures into silent fallbacks.

Launch options and current validation details: [LAUNCH_MODES.md](LAUNCH_MODES.md).
