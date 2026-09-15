# OpenSmash desktop releases

Project: `fun-opensmash-builds`, under the `fun.inc` organization.
Region: `us-central1`. Private bucket: `gs://fun-opensmash-builds-artifacts`.

Cloud Build's `desktop-release` trigger listens to **version tags only**:
`v0.2.1` or `v0.2.1-rc.1`. The tag must match `desktop/package.json` exactly.
The tagged `release.json` selects `buildMode`: `local` skips cloud staging and VM
provisioning; `cloud` runs the configured cloud builders. A local tag still starts
a short Cloud Build coordinator job, but no builder VMs.
Regular pushes and PRs do not launch the release builders. The old GitHub desktop
packaging workflow is manual-only. No always-running CI machine is installed on
this Mac or on tj64-forge.

## Local builds

Set `buildMode` to `local` in `infra/gcp/release.json`, update the desktop version
with `npm --prefix desktop version VERSION --no-git-tag-version`, and commit.
The local command fetches origin and fast-forwards to latest `origin/main` before
building. Pass `--commit FULL_SHA` on each builder to pin a coordinated release;
it fetches and verifies that exact commit, refusing dirty or divergent checkouts.
Keep the checkout unchanged while a build is running. Each machine builds its native
architecture; Apple Silicon builds macOS arm64, and the Windows desktop builds
Windows x64. Linux can be omitted.

With Python dependencies from `desktop/requirements.txt`, Node/npm, CMake and
Ninja installed, run from the repository root:

```sh
python tools/release_desktop.py
```

Use the project's packaging Python environment if available (on the Mac,
`build/desktop-python/bin/python`). Windows also needs the activated MSVC x64
developer environment and `CC=clang-cl`, `CXX=clang-cl`.
The default private inputs are `build/desktop-inputs/native-inputs-v3.tar.gz`
and `build/desktop-inputs/characters.tar.gz`; override with `--inputs` and
`--characters`. The command rebuilds the runtime incrementally, packages the app,
runs tests and the packaged ISO-gate check, and records the source commit and
checksums in `build/desktop-artifacts`. It neither tags nor uploads a release.

After all requested platforms pass, create and push the matching version tag on
that commit and collect each builder's archives, manifest and checksums for the
GitHub release. Version tags for local builds do not launch cloud VMs.

## Cloud builds

Set `buildMode` to `cloud` before committing and tagging to use the cloud path.
The current `cloudbuild.yaml` runs Windows; add a Linux worker step when needed.

## Cloud release flow

1. Develop and validate the launcher locally with `python tools/dev_desktop.py`.
2. Update the desktop version, commit, then push that commit and its version tag.
3. Cloud Build stages the exact tagged source and starts the configured temporary
   builder VMs. They reuse the private engine and character payloads. Missing
   engine payloads are compiled once and saved for later releases.
4. Each platform runs service tests and the packaged ISO-gate smoke check before
   uploading archives, checksums and source metadata under
   `releases/<tag>/<platform>/` in the private bucket.
5. Download those files with `gcloud storage cp --recursive` when publishing a
   GitHub release. Cloud Build's GitHub app has read access to source and write
   access to checks/statuses, not permission to publish GitHub release assets.

**macOS still needs Apple hardware.** Both Mac engine payloads are stored in the
bucket, but GCP does not replace the Mac application-packaging step. Use the local
Mac packaging scripts or the manual GitHub fallback on a Mac runner. The current GCP
trigger packages Windows; Linux worker support is available separately.

`release.json` is the central configuration for the project, bucket, VM size,
maximum duration and versioned inputs. Bump the runtime tag for native changes;
launcher-only changes reuse the runtime. The first Windows/Linux engine build is
still pending validation; creating infrastructure is not evidence those apps run.

## Cost and cleanup

- No persistent builder VMs or boot disks. Both builders are `c3-standard-44`, sized so a fresh engine compile finishes in minutes; they still auto-delete on completion and at the max run duration.
- A VM is deleted in the coordinator's `finally` block, with its boot disk.
- Compute Engine independently enforces a two-hour maximum runtime and DELETE
  termination action, including if the coordinating build is interrupted.
- Startup scripts report completion/failure for prompt deletion. They leave the
  VM running if the coordinator disappears, so its independent delete deadline
  stays active. No inbound firewall ports.
- Source snapshots and build logs expire after 14 days; compiler caches after
  30 days. Versioned inputs and release outputs are retained.
- A project-filtered **$10 monthly budget alert** is configured at 50%, 90%, and
  100%. This is a notification threshold, **not a spending cap**. Multiple release
  tags can each start builds; the timeout limits each VM, not total monthly spend.
- Windows license, VM, disk, public IP, Cloud Build coordination and storage
  charges can apply. Cached app releases still install their build tools on fresh
  VMs; no paid idle machine or long-lived Windows disk is retained.

The service accounts use attached VM/Cloud Build identities. No personal GitHub
PAT or downloadable service-account key is copied onto builders. The Cloud Build
GitHub app is restricted to `turtlesoupy/opensmash-melee`.

## Operations

After initial GitHub authorization, `bash infra/gcp/connect-trigger.sh` creates the
repository link and tag trigger. Inspect the existing trigger instead of silently
replacing its policy on reruns.

Run the bounded infrastructure check explicitly:

```sh
gcloud builds submit . --config=infra/gcp/smoke.yaml \
  --gcs-source-staging-dir=gs://fun-opensmash-builds-artifacts/jobs/smoke-source \
  --project=fun-opensmash-builds --region=us-central1 --account=thomas@fun.inc
```

It boots both OSes, verifies their bucket credentials, writes success, and deletes
them. It does not compile Melee or build an app. Smoke VMs expire after 10 minutes.
Inspect `jobs/<build-id>/<platform>/serial.log` for bootstrap failures and
`build.log` for compiler/package failures. Failed builds never publish successful
completion records.

Private inputs were copied from the existing verified local release caches:
`inputs/desktop-inputs-v3/native-inputs-v3.tar.gz`,
`inputs/desktop-characters-v1/characters.tar.gz`, and the two Mac ZIPs under
`inputs/desktop-runtime-v1/`. No ISO or extracted game filesystem is staged.

## Infrastructure validation

The 2026-09-10 smoke run verified Linux and Windows VM provisioning and bucket
writes using the attached service account. The Windows run also parsed the actual
release startup script with Windows PowerShell. A byte-array metadata decoding
issue was corrected during this check. Local tests: 74 passed, including release
ref validation and cleanup on provisioning failure. Full application compilation
is deliberately deferred to a release tag.

## Windows installer

Use `--artifacts build/installer-candidate --commit FULL_SHA` for an isolated
local candidate output directory.

The local release command builds `OpenSmash-Melee-VERSION-win-x64-Setup.exe`.
NSIS uses a guided per-user setup with an installation directory picker, an
optional desktop shortcut, a Start menu shortcut, and uninstall support. The
finish page offers to launch the app. Elevation and app-data deletion are disabled.
User data stays in the existing Electron profile outside the install directory.
Never choose the app-data profile as the installation destination. Linux archive
packaging is unchanged; macOS DMG packaging is described below. Manifests, cloud workers and manual CI
collect the installer executable.

Before publishing, test clean installation, installed launcher startup and
`python tools/verify_desktop_package.py "INSTALL_DIR/resources"`, reinstall,
upgrade and uninstall using a disposable profile. Verify retained data and
shortcut/registry cleanup. Record duration, file count, bytes and SHA256. State
the extraction tool and disk/cache conditions for ZIP comparisons; a command-line
benchmark does not establish Explorer speed. Upload private candidates under
`installer-candidates/COMMIT/windows-x64/`, separate from published releases.

The offline NSIS installer uses a ZIP payload (`useZip: true`,
`differentialPackage: false`). The first Windows trial installed this payload in
33.7 seconds versus roughly 2.5 minutes for the default 7z payload; these are
single-machine warm-cache trials, not Explorer benchmarks. ZIP trades a larger
download for faster extraction. There is no automatic updater or differential
update feed; upgrades use the full installer. Revisit this setting if adding one.

## macOS disk images

Normal macOS release builds now produce a branded drag-to-Applications DMG.
`desktop/installer/dmg-background.png` and its Retina variant are generated with
`python tools/draw_dmg_background.py` using Pillow and the bundled OFL fonts.
The Finder window is 640 by 400 points; the app and Applications link are placed
at the two icon centers configured in `desktop/package.json`.

The manual Desktop launcher apps workflow has a `mac_dmg_only` migration option
for wrapping an existing published Apple Silicon ZIP without rebuilding the app.
It requires the ZIP and its original platform manifest on the selected release;
`release_tag` must match the desktop version. The job verifies that source archive,
builds the DMG, verifies/mounts it read-only, checks the Applications link and
Finder metadata, copies the app to a temporary directory, runs the package tests,
and checks isolated launcher startup. Screenshots are collected when the hosted
runner supports them. It uploads workflow artifacts only, never a public release.
The manifest distinguishes packaging source from original application source.

Before replacing a release ZIP, inspect the mounted Finder layout and confirm the
DMG checksum and package test report. Keep platform manifests and SHA256SUMS in
sync. A DMG does not add code signing or notarization to an unsigned app.
