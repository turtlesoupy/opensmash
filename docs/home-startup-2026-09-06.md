# Homepage startup: deferred intro assets and baked cursor

The normal homepage previously loaded six distinct GLB models plus cartridge
artwork: logo, hand, TV, cartridge, console, and controller. Cartridge and console
also passed through separate GLTF loaders for the launcher and hidden intro.

The normal route now loads only the logo and baked hand. The optional
`is-cartridge-intro` route creates its TV/materials/lights/particle buffers and
loads its hardware only when enabled. Launch-flow models start loading when
`ensureFlowRenderer()` opens a launch or controls flow.

The hand's vertex welding, two smoothing passes, alignment, normal calculation,
bone-weight calculation and fingertip search run offline. The live skeleton and
animation remain in `web-prototype/shared/cursor-rig.js`; the baker uses the same
bone order and bind pose. To regenerate after modifying the source or rig:

```sh
cd web-prototype
node scripts/generate-cursor.mjs
node --test shared/cursor-geometry.test.js
npm run build
```

The original Meshy GLB remains the source asset. The baked GLB is 313,500 bytes
versus 225,356 bytes for the source. The larger hand is outweighed by deferring
about 1.16 MB of other models/artwork (about 1.07 MB net fewer initial asset
bytes, before transport compression).

## Validation

- Production Vite build passed; existing large-chunk warning remains.
- All 242 Node tests passed, including golden hashes captured from the original
  browser-generated cursor for positions, normals, indices and skin weights.
- Headless Chrome checked before/after production builds with identical empty
  roster fixtures and external requests blocked. The resulting geometry arrays
  and cropped RGBA captures matched exactly for point, grab and click poses.
- Point: 24 × 35, SHA-256
  `62d1c0db2b3af9a83c41cf7bdc348cf36f772b52eafbca898fdb26de60be6792`.
- Grab: 30 × 28, SHA-256
  `cafaf7f7f1af91899bef52348813f3e0a8b2052290cc33356760ed96efb73bf2`.
- Click: 28 × 34, SHA-256
  `fbb46daacbaa9180a8a75fdba64ddeec5b9930393a2408fe0363640e7e59635a`.
- Browser requests confirmed only logo/hand GLBs on the normal route. Opening
  the controls preview loaded the controller, cartridge, console and artwork;
  the controller reached its settled visible state. The optional intro loaded
  its TV, cartridge and console successfully. No page errors in these checks.

These checks establish rendering parity and removal of startup work, not a
production load-time benchmark. The logo, CRT overlay and cursor still initialize
three WebGL contexts. Mobile cursor setup is unchanged. Disabled-CRT initialization is addressed in
the shader preparation follow-up below.


## Shader preparation follow-up

CRT initialization now begins only when enabled. Both shader compilations and
linking are submitted together, then `KHR_parallel_shader_compile` completion is
polled between tasks. Link/error queries and uniform setup run after completion.
The settings API exists immediately, so disabling while compilation is pending
keeps the canvas hidden; re-enabling reuses the prepared program. Partial tuning
updates also preserve the enabled state (previously an omitted `enabled` key was
coerced to false).

The cursor and optional hardware prepare both offscreen and direct-output
variants, including cursor-light visibility changes and hidden poof materials.
The native pointer remains available until readiness. The launcher prepares its
screen pass and each model against the actual scene lighting and offscreen render
target before showing it. Closing/reopening a flow invalidates pending reveals.
Temporary render-target changes are restored synchronously, before awaiting the
compiler, so concurrent frames cannot render into the wrong target.

Browsers without the parallel-compilation extension cannot guarantee a
non-blocking readiness check. The raw WebGL fallback yields before querying link
status; Three.js retains its built-in fallback. Context creation, CPU preparation,
and first-use GPU uploads are not moved off the main thread by this change.

Validation: production build and all 250 Node tests passed. The CRT browser check
now covers zero context creation while disabled, enable/disable during pending
compilation, no premature link-status queries, reuse after enabling again, and
menu/game compositor transitions in both reduced-motion modes:

```sh
cd web-prototype
PLAYWRIGHT_PATH=/path/to/playwright PERF_HEADLESS=1 node scripts/perf-crt-state.mjs
```

Instrumented Chrome runs for homepage, controls preview, and optional intro
observed no use of shader programs with incomplete compilation and no page
errors. Point/grab/click pixel captures still matched the corresponding pre-change
captures exactly. These are correctness checks, not production latency claims.

## Gameplay JavaScript follow-up

- The hardware loop now skips animation and both render passes when the
  cursor's disappearance has settled and no poof particles remain. It also
  considers the presence target, so pointer re-entry resumes the animation.
  Chrome diagnostic: hidden desktop cursor went from 120 render calls per
  second to zero; moving back into the page restored the hand and rendering.
- Controller profiles are cached and frozen until a local save or cross-frame
  storage event invalidates them. Hat calibration is cached per profile/axis.
  Polling no longer clones every native button, recreates constant mapping
  tables, or copies the gamepad list twice. Fresh output arrays/proxies remain
  so callers can retain a poll's mapped values. Regression checks cover 120
  polls with zero storage reads, storage clear/change, and existing mappings.
- The companion BattleShip changes replace synchronous roster XHR with fetch
  plus an Asyncify wait at port_fopen_staged. Demand loads join in-flight
  prefetch; errors clear pending requests for retries. Existing MEMFS files
  bypass the asynchronous boundary. This needs matching shell and WASM files.
  Engine test: a cold fighter request delayed 400 ms completed asynchronously,
  then a match reached frame 181 without browser errors. A separate test uses
  the real nested coroutine backend to verify stack preservation, resumed
  execution, event-loop progress, existing files, and failed requests.

Validation: all 251 web tests and Vite build passed; three engine staging
JavaScript tests passed; Emscripten nested-fiber test and full engine build
passed. No claim about overall match FPS has been measured yet.
