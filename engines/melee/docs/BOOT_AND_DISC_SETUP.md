# Boot screen and local disc setup

The web landing screen exposes the existing five launch destinations before the
character roster: Free-for-All, VS Menu, VS Character Select, Classic Character
Select, and Original Title / All Modes. The last option follows Melee's original
boot flow; use its menus for Adventure, Training, Events and other modes, subject
to the game's normal unlock state. This does not add direct launch hooks for each
individual single-player mode. Players & rules opens the existing four-port setup.

Start local development without a command-line ROM path:

```sh
python3 tools/serve_melee.py
npm --prefix web run dev
```

On the website choose **Melee ISO / GCM**. The browser checks file size, disc ID,
revision and header before sending the file to the loopback server. The server
streams it to a temporary file while calculating the full SHA-256. Only the known
unmodified USA 1.02 image is accepted. The original file is never modified.

Transfer has progress and cancellation; interrupted transfers and hash failures
leave existing game files in place. Extraction uses a staging directory, checks
the executable hash, and only then swaps in the new game. The temporary ISO is
removed after extraction. Provide at least 3 GB of free space for initial setup;
repair temporarily retains the previous extracted game as well. The local release
must include the platform's `dtk` disc extractor and engine/build dependencies.
This is a local-server workflow, not a static hosted site's ROM upload service.

The server writes a hash manifest under `build/web-game/verified.json` and checks
all saved extracted files on subsequent starts. Missing or changed files show a
repair prompt. Supplying `--iso` still supports the existing development workflow
with a full original-disc hash check; selecting through the browser creates the
persistent installation receipt. RVZ, ZIP, other regions/revisions and patched
images are rejected with instructions to choose the supported original image.

The existing macOS native launcher now has **Choose Game Disc…** in its app menu
(Command-O). Cancelling initial selection leaves the picker open instead of
quitting the application, and setup errors allow another selection. Invalid native caches are moved aside
and rebuilt from the verified disc. Native full
ROM verification remains in place. This task does not introduce a new platform UI
framework or claim Windows-native validation.

## Validation

- Real 1,459,978,240-byte USA 1.02 ISO transferred through the HTTP setup endpoint,
  verified, extracted and installed successfully without `--iso`.
- A new setup instance reopened and verified the saved extracted library.
- Browser Classic selection reached the actual Classic character select screen;
  Original Title / All Modes reached the original title screen (60 FPS shown).
- 62 Python tests passed, including interrupted transfer, bad hash, invalid size,
  failed extraction preserving prior files, and corrupt saved-file detection.
- Four shared launch-mode tests passed. Web production build and native Swift
  type-check passed.
