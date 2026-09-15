# Browser launch preparation

## Implemented

- Verified Melee ISO/GCM files stream into origin-private browser storage. Refreshing or restarting the browser restores and verifies the saved file automatically. No ISO upload or server-side disc persistence is involved.
- The standalone launcher, shared smash.fun launch gate, and Melee settings use the same disc session. Clicking a fighter during restoration waits for the existing restore operation.
- A completed file replaces the saved copy atomically. Quota failure and cancellation preserve the previous copy; abandoned staging files are reclaimed. Unsupported storage falls back to playing from the selected file. Clear/Forget Disc deletes this cache without touching the original file or memory-card saves.
- Melee touch controls provide analog movement, a labeled yellow C-stick, green A, red B, X/Y jump, Z grab, L/R shields (including trigger values), Start, and D-pad-up taunt. Multiple pointers retain independent ownership; release, cancellation, focus loss, and orientation changes reset input.
- Portrait uses a control deck below the game; landscape places controls beside the game. CSS and components are Melee-only. N64 continues to use its existing colored controller.

## Focused validation

Chrome 152 on macOS, with browser touch emulation (not a physical-phone test):

- Actual 1,459,978,240-byte ISO saved, restored after reload, and restored after browser restart with no ISO POST requests.
- Running match: main stick + A + C-stick simultaneously; release A while both sticks remain held; cancel to neutral; individual action buttons, shields, Start, taunt, and blur recovery.
- 390-pixel portrait, 320-pixel portrait with no overlapping touch targets, 844-pixel landscape, and fullscreen. Screenshots inspected.
- Clear Disc through Settings, then reload: disc is still absent.
- Shared smash.fun production bundle: selected the real ISO, confirmed the complete local cache, reloaded, and selected a fighter during restoration. The disc gate became authorized with no replacement-file prompt.
- Four targeted Melee tests pass (storage transaction failure/cancellation, analog mapping, existing worker/session regressions). All 19 existing N64 mobile tests pass.
- Standalone TypeScript/Vite build and shared smash.fun production build pass.

Run with a standalone local asset server serving the current web build and existing game assets:

```sh
NODE_PATH=/path/to/playwright/node_modules node engines/melee/tools/validate_browser_launch_prep.cjs /path/to/melee.iso
NODE_PATH=/path/to/playwright/node_modules node engines/melee/tools/validate_shared_launch_gate.cjs /path/to/melee.iso
node --experimental-strip-types --test engines/melee/tests/browser_disc_cache.test.mjs engines/melee/tests/browser_session.test.mjs engines/melee/tests/browser_frame_worker.test.mjs
node --test web-prototype/shared/mobile-controls.test.js web-prototype/shared/mobile-input.test.js
```

The browser test defaults to `http://127.0.0.1:5193/`; override with `MELEE_TEST_URL`. It creates an isolated test profile under the output directory.

Browser storage belongs to an origin and browser profile. A localhost cache does not migrate to smash.fun. Clearing site data removes it, and browsers may evict non-persistent storage. The UI requests persistent storage where supported and reports cache failures without blocking play. Deployment itself is not part of this change.
