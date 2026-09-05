# Build targets

The build driver uses Python's standard library. Native builds use BattleShip's
CMake build and dynamic character injection. ROM builds use an optional exporter
with separate Python dependencies. Neither changes the website build.

## Checkouts and prerequisites

Use sibling `pipeline/` and `BattleShip/` checkouts, or pass `--battleship PATH`.
Initialize BattleShip's submodules and install its platform prerequisites from
its `BUILDING.md` (CMake 3.24+, a compiler and platform libraries).
Both targets consume your local `BattleShip/baserom.us.z64`; use `--rom PATH`
for another location. No ROM is uploaded or committed.

The BattleShip revision needs the optional `SSB64_BASEROM` CMake cache setting
included in the companion `feature/build-targets` branch. Its ordinary direct
CMake workflow remains supported.

## Desktop: the full roster by default

```sh
python3 build.py native --rom /path/to/baserom.us.z64
```

This builds BattleShip, fetches the public website catalog, and stages every
character's mesh, portraits, names, stock UI and announcer audio. Each character
retains the website's assigned moveset. The engine loads assets from disk when
needed; it does not keep every mesh in RAM. The normal vanilla roster is page 0;
custom characters occupy pages 1 onward, 12 per page. Use L/R or the on-screen
arrows to change pages. BattleShip supports up to 2,048 custom entries.

Outputs live in `build/native-PLATFORM-REGION-CONFIG/`, for example
`build/native-darwin-us-release/`. Launch the injected roster with:

```sh
python3 build/native-darwin-us-release/play.py
```

Or open `Play.command` on macOS / `Play.bat` on Windows. The launcher opens VS
character select and enables the original locked slots. It works offline after
preparation. Running the BattleShip executable directly keeps its ordinary
launch behavior. Python 3 is needed for the generated launcher.

A 1,046-character catalog staged about 725 MiB of runtime character files and
1.6 GiB of reusable download cache in local testing. `character-cache/` can be
removed after a successful build if disk space matters; the next preparation
will download those source assets again. Only the requested skeleton variant
is staged into each runtime mesh.

```sh
python3 build.py native --characters queen,50cent,abrahamlincoln
python3 build.py native --characters queen 50cent --config Debug --jobs 4
python3 build.py native --vanilla
python3 build.py native --vanilla --version jp --rom /path/to/baserom.jp.z64
```

Character IDs are website **slugs**, not display names. Commas and spaces both
separate slugs. `--vanilla` skips roster preparation entirely; use the BattleShip
executable directly for this mode. Custom injection has been tested with US;
JP vanilla builds remain available.

## Private characters and copied links

Copy the **Character download URL** from custom fighter settings and pass it
as `--character-url`. Both targets accept repeatable `--character-url` arguments. Links are added to
the selected public roster, or replace a matching slug. To build *only* linked
characters, use `--characters none`:

```sh
python3 build.py native --characters none --character-url 'COPIED_DOWNLOAD_URL'
python3 build.py native --characters queen --character-url 'COPIED_BUILD_LINK'
python3 build.py rom --characters none --character-url 'COPIED_BUILD_LINK'
```

Quote links so the shell does not interpret `&` or other URL characters.
The URLs shown by the custom-character modal work directly, including private
`/engine/bundles/SLUG-CAPABILITY.osb6` URLs and public versioned object-store
URLs. The importer reads the associated manifest for the character's name,
then downloads the mesh, `.osbui` pack, announcer WAV and portrait. Emblems,
stock icons and menu art are embedded in `.osbui`; the raw emblem PNG is not
used by BattleShip. Native preparation validates the WAV format and checks
that a custom download has a nonempty embedded emblem, failing visibly when
these assets are missing. `characters.json` records `announcer` and `emblem`
booleans for each staged fighter.

The immutable download URL does not encode the separate, editable website
moveset setting; raw downloads default to Mario. A self-contained
`characterBuildLink` can carry a specific base/fkind. Existing engine launch
links and unknown standalone `.osb6` URLs also remain supported; unknown mesh
URLs carry no companion-asset information and import only a mesh.

The modal's existing download field needs no changes or additional website
deployment for this import behavior. The optional self-contained link helper
is described in [the integration note](docs/character-build-links.md).
Private downloads reuse the existing asset capability without publishing the
fighter. Anyone with that URL can download its assets. Build logs and reports
omit copied URLs; local asset files and caches stay in the ignored build
output. No browser cookies or account tokens are imported.

## Hardware ROM: select a subset

The current ROM exporter has **12 fixed fighter slots**, with one generated
character per slot. It does not implement paginated character selection on the
N64. With the full public roster, the command fails with selection instructions
before downloading character assets. It never silently truncates a loadout.

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r hardware-rom/requirements.txt
python3 build.py rom --characters queen,50cent,abrahamlincoln --vpk0 /path/to/vpk0cmd
```

On Windows, activate `.venv\Scripts\Activate.ps1`. `vpk0cmd` is the external
VPK0 decompressor from the decompilation project; use its installation
instructions. The driver checks `BattleShip/decomp/tools/vpk0cmd`, then `PATH`.
`--decomp PATH` supports a separate decomp checkout.

The resolver extracts OSB5 variants from the website's OSB6 bundles and assigns
unique available base slots, preferring the website movesets. Conflicting
movesets may be reassigned; `build/rom/characters.json` records the actual bases.
If there is no valid assignment, the build fails with a useful error. Private
characters count toward the 12-slot limit.

The result is `build/rom/opensmash.z64`, a generated `loadout.json`, and hash/size
reports. The exporter verifies the original US v1.0 ROM and audits the output
before reporting success. `--triangles 700` controls the per-character triangle
budget (32–2,000). A 12-slot/700-triangle build passes the structural audit;
that is not a physical-hardware or four-player memory guarantee.

The ROM bakes supplied OSBV portraits, name lettering, stock icons and menu/HUD
emblems, plus announcer WAVs converted to N64 ADPCM. Local loadout entries may
include `ui` and `voice` paths relative to `--assets`; omitted assets stay vanilla.
Heads retain texture detail using small per-triangle tiles; bodies use vertex
colors. Website loadouts enlarge menu previews by 15% (`menu_scale` in local
loadouts overrides this without changing gameplay scale). This remains a rigid
approximation. Movesets and move-specific
props/forms remain vanilla. BattleShip's smooth
skinning and canonical retargeting are not reproduced on the N64. See
[ROM details](hardware-rom/README.md) for limitations.

The earlier local OSB5 loadout format still works without network access:

```sh
python3 build.py rom --loadout hardware-rom/loadout.json --assets /path/to/play
```

`--loadout` cannot be combined with website character selection.

## Configuration and validation

`--site URL` selects another website (default `https://smash.fun`). `--catalog`
accepts an API-shaped JSON file or URL; by default it uses `SITE/api/characters`.
Selections refresh on each build, while cached asset downloads are reused.
Use separate `--output-dir` directories to keep different loadouts installed.
Each successful preparation publishes a new `roster.txt` containing exactly the
selection, so old cached fighters do not appear in a smaller roster.

`--generator Ninja` and `--cmake-arg=-DNAME=value` customize the native build.
CMake owns incremental compilation and resource extraction. `--dry-run` prints
commands without accessing the network or creating files (legacy `--loadout`
still reads the JSON). Each executed build writes `opensmash-target.json` with
its target and completion status. Failed preparation does not report success.

```sh
python3 build.py native --dry-run
python3 build.py rom --characters queen --dry-run
python3 -m unittest discover -s tests -p 'test_*.py'
node --test web-prototype/shared/character-build-link.test.js
```

For the original three-character ROM regression fixture, run
`python3 hardware-rom/test_packer.py --base /path/to/baserom.us.z64 --rom PATH`.
The orientation regression always runs; corruption tests explicitly skip when
the local fixture is absent. The build itself audits arbitrary selected slots.
