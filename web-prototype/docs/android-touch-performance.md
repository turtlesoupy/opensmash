# Android joystick performance — 2026-09-11

Measured on the connected Saga, Android 16 / Jelly / WebView 152, using CDP
touch events on the actual mobile joystick. The game canvas stayed at 1280x960.

## Reproduction

The original warmed game averaged 60.02 ticks/sec idle and 59.96 with movement
sent directly to the engine, but only 50.72 while dragging the touch joystick.
A repeat measured 49.32 during dragging. This distinguished touch/UI work from
the cost of moving the fighter itself.

The browser trace showed extra layer-building work during dragging (about
413 ms across five seconds, versus about 3 ms in the subsequent idle window).
The page contained 1,046 roster portraits and about 7,200 DOM elements.

## Changes

- MobileControls now sends key transitions immediately but updates only the
  knob's transform once per animation frame, without React state updates for
  every pointer coordinate. Joystick geometry is cached during a gesture and
  invalidated by scrolling, resizing, or release.
- Touch events no longer run the desktop glove's raycast/style/hit-test handler.
- Explicitly sized fighter tiles use `content-visibility: auto`, letting the
  browser skip off-screen portrait/caption work. Search and creation controls
  retain their existing rendering behavior.
- In BattleShip's `port/port.cpp`, the rAF pacer's catch-up branch uses a queued
  MessageChannel task instead of `emscripten_sleep(0)`. Those nominally zero-delay
  timers measured a median of 5.4–5.5 ms and p95 around 10 ms during dragging.
  Normal rAF pacing and the explicit timer-pacing option remain as before.

An isolated same-match roster-skipping comparison improved dragging from
44.05 to 52.32 ticks/sec; removing the CSS returned it to 46.07. Freezing the
knob also helped; drawing a canvas knob and adding deck containment did not
provide a reliable improvement, so neither experiment is included.

## Complete build verification

After startup had finished, a five-second sample of each mode produced:

| Mode | Game ticks/sec | p95 tick interval | Longest interval |
| --- | ---: | ---: | ---: |
| Idle | 60.09 | 23.1 ms | 27.1 ms |
| Direct movement | 59.99 | 23.4 ms | 35.0 ms |
| Stationary joystick hold | 58.58 | 23.1 ms | 131.0 ms |
| Joystick dragging | 59.73 | 23.6 ms | 36.0 ms |
| Idle afterward | 60.32 | 23.7 ms | 38.2 ms |

A simultaneous rAF sampler counted 59.55 display intervals containing game
ticks per second during dragging, with no interval containing multiple ticks.
This is a presentation-cadence proxy, not hardware scanout measurement. One
131 ms hitch remained in the stationary-hold window; this does not establish
that all input or first-use stalls are eliminated.

The device reported thermal status 2–3 during the longer investigation, so
absolute results across separate matches/temperature states are not directly
comparable. The final warmed sample reported status 2. No rendering-resolution
reduction was used.

The production frontend build, release Wasm build, 18 mobile-input/caption tests,
and seven engine shell/loading/catch-up tests passed. Added tests cover visual
update coalescing, immediate key transitions, release before paint, geometry
invalidation, and asynchronous FIFO catch-up tasks without timer waits.

## Local test setup

The phone is on `http://localhost:4177/`, forwarded with `adb reverse` to the
Mac. Port 4177 serves the built frontend and proxies API/engine requests to the
local development server on port 4176. The existing ROM is stored in this local
origin. The engine package was rebuilt in BattleShip/web-dist. No live-site
deployment was performed.

This fix spans the pipeline frontend repository and the BattleShip engine
repository; include both when packaging a release, together with the earlier
Android startup-memory fix in BattleShip's libultraship submodule.

## Follow-up after manual testing

A real-finger trace (934 pointer events over 30 seconds) measured 57.32 game
ticks/sec, with several 48–68 ms intervals around presses. This confirms that
the earlier synthetic-drag sample was insufficient to declare input fully
smooth. The trace itself adds overhead, so its absolute rate is not directly
comparable with untraced samples.

On the renderer main thread the trace included 4.55 seconds of intersection
checks, 1.36 seconds of layer building, and 1.35 seconds inside the CRT overlay's
render callback. These are inclusive trace durations, not additive CPU totals.
The frozen CRT still polled window dimensions approximately 120 times/sec.
It now stops scheduling frames for a still image; resize, game-mode changes,
and settings changes explicitly wake it. Tests verify both waking and return
to animated menu rendering.

An experimental explicit offscreen-roster cull improved tick-interval tails,
but is not included: hiding roster content needs to preserve the existing
find-in-page behavior. The normal roster remains mounted and searchable.

The user also encountered a game-frame restart allocation failure. BattleShip
now releases SDL audio nodes and callbacks on unload while preserving the
parent's shared AudioContext. Five consecutive shared-context starts succeeded
on the device; see the engine startup-memory bug document for details.

The first-press trace showed an approximately 130 ms gap in engine iframe
animation callbacks while parent callbacks continued. A parent-clock runtime
experiment appeared to reduce one hitch, but the packaged implementation still
reproduced a 129 ms hold hitch, so that change was removed. The remaining press
hitch is unresolved; the final change does not claim smooth input throughout.
One interrupted run was discarded because the screen timeout stopped the game.
Subsequent comparisons held the display awake over USB; the original stay-awake
setting was restored after testing.


## Analog touch input verification

The touch stick now sends proportional N64 axes through the engine shell's
keyboard port, with a radial center dead zone of 28% and rescaled travel outside
it. Previously it sent digital WASD directions at full strength. Digital events
remain as compatibility fallback; the updated shell overrides their axes while
a touch is held, including an explicit neutral value. Release and interruption
clear the override. Physical gamepads and stock fighter physics are unchanged.

The packaged frontend and engine shell were tested on the connected Saga using
CDP touch events. Two consecutive completed gestures sampled the engine's
`controllerPorts.sampleKeyboard()` at center, 15%, 50%, full right, center, half
left, full left, center, and release. Horizontal values were respectively
0, 0, 24, 80, 0, -24, -80, 0, 0, with vertical values zero. Earlier attempts
returned inconsistent/zero samples and were not counted as successful checks;
the completed checks also confirmed pointer coordinates landed on the joystick.
All 22 focused mapping, component, and engine-shell input tests passed. The
phone's temporary USB stay-awake setting was restored to 0.

This verifies input mapping, not elimination of stock reversal momentum or the
remaining first-press performance hitch. No fighter movement/physics code was
changed. The earlier recording-tool memory-retention issue and startup-memory
limitations are documented in the engine bug report; this input check is not a
memory-stability stress test.
