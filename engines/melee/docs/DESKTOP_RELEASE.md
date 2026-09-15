# Shared desktop launcher

The React launcher in `web/` serves both browser and desktop. `desktop/main.cjs`
is a thin Electron shell: a native disc picker, an isolated renderer, and process
lifetime management. The local Python service owns ISO verification, conversions,
and launching the game. No platform-specific UI is needed for roster or mode edits.

## Embedded native gameplay

Desktop gameplay stays inside Electron on macOS, Windows, and Linux. The game
engine remains native. The game toolbar toggles fullscreen; F11 toggles it and
Escape exits it. Returning to the roster stops the engine and clears keyboard
state. Keyboard input follows canvas focus; gamepads retain the native SDL path.

macOS uses three shared IOSurface GPU textures. A texture is reused only after
Electron releases every GPU reference. Windows/Linux render Vulkan into an
offscreen framebuffer and transfer uncompressed RGBA frames through a bounded
shared-memory queue. This portable path incurs GPU readback and upload costs;
it does not use video encoding or a browser game runtime. It creates no native
game window, including under Wayland. Both paths render at 960×720 and preserve
the game aspect ratio when the launcher resizes.

The updated runtime advertises `embeddedSurfaces` in `runtime.json`. Old runtime
payloads fail with an update message instead of opening another window. Build
and publish a new `desktop-runtime-v3` cache before packaging releases. The app
packaging scripts build the macOS N-API bridge automatically. For a local
portable-path check on macOS, set `OPENSMASH_FRAME_TRANSPORT=memory` when launching.

Checks: `node --test tests/embedded_frame.cjs` verifies ordering, backpressure,
and input cleanup. Native runtime builds run `opensmash-embedded-test` on every
platform to check shared mappings and keyboard pulses. Local validation covered
Metal/IOSurface and the portable path with Metal and Vulkan/MoltenVK, fullscreen,
return to roster, and relaunch. The shared-memory test also ran on Linux and
cross-compiled for Windows. Actual Windows/Linux gameplay and gamepads still need
platform validation; the macOS results do not certify those drivers or performance.

## Frequent launcher changes

Install `desktop/requirements.txt`, run `npm --prefix web ci` and
`npm --prefix desktop ci`, and prepare the versioned runtime and character inputs
once with `tools/prepare_desktop_release.py`. Then run:

```sh
python tools/dev_desktop.py
```

This refreshes the shared UI and application code without rebuilding the engine
or freezing Python. Rerun it after code changes. Development and packaged desktop
use the same service and launch protocol. User assets, converted characters, and
saves live in Electron's per-user application-data directory, separate from app
resources. Replacing an app does not overwrite those folders.

## Build layers

- `desktop-runtime.yml`: manually builds the native engine, generated game module,
  extraction tool and controller helper for macOS Apple Silicon/Intel, Windows
  x64 and Linux x64. Its private `desktop-runtime-v3` release is the engine cache.
- `desktop-characters-v1`: one shared generated character source library. It
  includes 1,063 complete entries; four incomplete local entries are excluded.
  It excludes original source photos and prompts.
- `desktop-app.yml`: manual fallback that downloads those two versioned inputs,
  builds React, freezes the service, and packages native apps. It never compiles
  the engine. Artifacts remain private and are retained for 30 days.

Increment the runtime tag when changing native code or the protocol. Increment
the character-library tag when publishing a new source library. UI changes only
need app packaging. Update `desktop/package.json` for release versions.

Release tags now use the fun.inc GCP project for Windows and Linux. See
[`infra/gcp/README.md`](../infra/gcp/README.md) for the active trigger, caches,
cleanup limits, and the separate macOS packaging requirement. Ordinary pushes no
longer trigger the GitHub app matrix.

## Character payload size

`prepare_desktop_release.py` compacts the staged roster after extracting the
versioned cache, so existing `desktop-characters-v1` inputs benefit without
republishing them. `package_desktop_characters.py` applies the same transform
when creating future caches. Both transforms are idempotent and print model and
portrait byte totals during preparation. Install `desktop/requirements.txt`
before preparation; the GitHub and GCP build paths do this automatically.

`tools/compact_desktop_portraits.py` replaces staged `portrait_raw.png` files
with `portrait_raw.webp` at quality 90, method 4—the settings used in the reviewed
comparison. Dimensions and alpha are preserved; RGB compression is lossy. Already
compressed portraits are not encoded again. Original PNG sources and cache
archives remain unchanged. Local character import and menu rendering accept
either format; source-link downloads retain their existing PNG contract.

`tools/compact_desktop_glb.py` removes normal, metallic/roughness, occlusion and
emissive texture maps that `opensmash_melee/glb.py` does not consume. It preserves
base-color image bytes, every geometry/skin accessor, shared resources and all
characters. It does not resize or recompress visible art. Models containing
unknown extensions are left untouched. Original source exports and downloaded
cache archives are never modified. Revisit this transform if the converter
starts consuming additional material maps.

Run `python -m unittest tests.test_desktop_compaction tests.test_desktop_portraits`
for resource-sharing, alpha/dimension preservation, idempotence, import/rendering
and cached-release integration checks. `verify_desktop_package.py` also decodes
every catalog portrait through the frozen backend, so a missing bundled WebP
decoder fails package verification.

Local measurement against the 0.2.0 macOS arm64 archive: all 1,063 characters
produced identical decoded mesh arrays and base-color pixels before and after
compaction. Model data fell from 626,696,660 to 361,923,588 bytes. Repacking the
archive reduced it from 1,060,826,969 to 855,709,993 bytes (19.3%); only 64,519
bytes of that saving came from recompressing other entries. This was a size
measurement, not a newly signed release or a gameplay validation.

Additional compression experiments on that compacted macOS payload:

| Encoding | Download bytes | Notes |
| --- | ---: | --- |
| ZIP after model compaction only | 855,709,993 | Before portrait compaction |
| Maximum macOS ZIP (`zip -9 -r -y`) | 855,720,751 | Same entry sizes and CRCs; no meaningful saving |
| tar + XZ (`xz -6 -T4`) | 770,834,132 | Lossless; different distribution format |
| tar + Zstandard (`zstd -19 -T4`) | 795,441,510 | Lossless; different distribution format |
| ZIP with quality-90 WebP portraits | approximately 588,020,609 | Projected from encoding and DEFLATE-compressing all 1,063 portraits; now integrated into packaging |

The portrait experiment preserves dimensions and alpha, but changes RGB pixels.
Portrait files alone fell from 285,806,226 to 18,197,574 bytes before outer
compression. The archive formats remain ZIP on macOS/Windows and tar.gz on Linux.
General archive compression and image compression solve
different problems; PNG/JPEG art leaves limited redundancy for outer compressors.

## Disc and release checks

No ISO or extracted game filesystem is bundled. On first launch, select a full
Melee USA 1.02 ISO/GCM. The service checks the complete disc hash before extraction
and verifies its saved asset receipt on subsequent launches. Native game modules
and internal compiler inputs contain game-derived code; private build inputs are
not a public source distribution.

macOS archives are currently unsigned/ad-hoc development builds; Windows archives
are unsigned. Signing/notarization credentials are a separate release step.
Linux targets x64 on Ubuntu 24.04-compatible systems. A successful CI build is not
proof of gameplay on Windows or Linux; record platform smoke tests before calling
those platforms release-validated. The first native run also asks Melee to create
its local memory-card save; accept that once in the game window.

## Validation recorded during development

The Apple Silicon packaged app passed clean-profile ISO gating, invalid-disc
rejection and local-session authentication checks. The shared launcher reached
Classic selection and custom-character combat at approximately 60 FPS. A four
custom-character lineup also reached 180 combat frames. Large lineups use the
existing 256-pixel texture budget and shared host skinning to stay within Melee's
preload memory limits. Mode preferences are stored outside the changing service
origin and survive app restarts.

The common launcher currently exposes the web roster's six standard retarget
families. The earlier macOS picker and its separately built experimental retarget
variants remain in the repository; those experimental variant controls have not
yet been moved into the shared launcher.

## Preview build status (2026-09-10)

Apple Silicon has a packaged preview using the successful GitHub-built engine.
It passes the clean-profile checks and reaches four-custom-fighter combat. The
packaging smoke check now also loads the native tools and checks the exact plugin
filename expected by each platform, catching missing libraries and undiscovered
launch plugins before distribution.

New GitHub Actions jobs are currently refused by account billing/spending limits.
Windows and Linux compiler fixes are committed but still require successful CI
retries; Intel Mac app packaging is also pending. These are not yet all-platform
release artifacts. After restoring Actions billing, rerun the targeted native
runtime jobs, collect the four platform ZIPs into the private `desktop-runtime-v1`
release, then run `desktop-app.yml`. Subsequent launcher edits use that cached
runtime automatically.
