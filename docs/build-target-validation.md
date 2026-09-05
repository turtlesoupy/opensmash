# Local target validation — 2026-09-05

Validated on macOS with the companion BattleShip commit `51d85bb` and its
pinned submodules. Other desktop platforms were not run in this session.

- Full native build: 1,046 public characters, 88 custom pages plus vanilla.
  All selected source assets downloaded and the staged meshes passed header,
  range and triangle-index checks. Content-addressed downloads passed SHA-256
  verification. Incremental build and cached preparation also passed.
- Offline generated launcher: character select displayed the first page's
  custom portraits and names. A separate boot on page 88 displayed the final
  two custom fighters with vanilla entries in the remaining tiles. A scene
  test hook selected a final-page fighter and rendered its custom mesh.
- Four-player native smoke: Donald Trump, Barack Obama, Jesus Christ and
  Marilyn Monroe rendered in the VS introduction and entered a match. The
  bounded 900-frame run exited normally. Maximum resident memory reported by
  macOS `time -l` ranged from about 154 to 198 MiB across the CSS/intro/battle
  runs. These are sample runs, not exhaustive testing of all fighters or a
  long-duration leak test.
- Native runtime character files occupied about 725 MiB, plus a reusable
  source download cache of about 1,664 MiB. Assets are loaded as needed by
  BattleShip; the full download is not held in RAM.
- Twelve-slot ROM: one character on each normal base fighter, 700 triangles
  requested per model (one simplified to 699). All 2,132 relocation entries,
  unchanged file bodies, internal pointers and emitted display lists passed
  the structural audit. Additional model bytes for the four largest replaced
  models total 161,512 bytes. This excludes the original scene heaps and is
  not proof of physical-console memory safety.
- Twelve-slot ROM SHA-256:
  `b906e8ee50ba278a0d33189e397650523081cc3aebd67d8e92bc32e67899a3b7`.
- The original three-character fixture rebuilt byte-for-byte to the v2 hash:
  `dd20e268e7bae5d747fd91fa38fc2ea383b1d937bf5d801b69d73255a3734b43`.
- 25 Python build/selection tests, 5 original ROM regression tests, and 2
  JavaScript build-link tests passed. The selection suite covers copying a
  JavaScript build link into the Python importer, gzip decoding, hash errors,
  private-link redaction, subset ordering, paginated staging, malformed meshes
  and rejection of oversized or conflicting ROM selections.

No real private fighter capability was supplied for a live download test;
private-link transport is covered by fixtures using the existing capability
URL format. The website modal is deliberately left unchanged for the separate
manage-modal work. The new 12-character ROM has structural validation only;
new emulator/physical-hardware and four-player ROM stress tests remain pending.
