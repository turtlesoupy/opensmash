# Build targets

`python3 build.py native` builds the native game through BattleShip's CMake
build. `python3 build.py rom` builds an experimental N64 ROM with a baked
fighter loadout. Neither command changes the website's build or starts any
asset-generation services. The driver uses only the Python standard library;
ROM conversion dependencies are loaded only by the ROM target.

## Checkouts and inputs

Use the existing sibling layout:

```
workspace/
  BattleShip/              # with its decomp, libultraship and torch submodules
  pipeline/                # this repository
    build.py
    play/                  # your generated fighter assets, needed only for ROM
```

Initialize BattleShip's submodules as described in its `BUILDING.md`.
`--battleship PATH` supports another checkout. Both targets default to the
user's `BattleShip/baserom.us.z64`; pass `--rom PATH` to use another location.
The ROM is always an input and is never copied into source control.

## Native

Install BattleShip's platform prerequisites (CMake 3.24+, a C/C++ compiler,
and its platform libraries). Then:

```sh
python3 build.py native
python3 build.py native --config Debug --jobs 4
python3 build.py native --version jp --rom /path/to/baserom.jp.z64
```

Outputs are isolated by host platform, region and configuration, for example
`build/native-darwin-us-release/`. CMake owns the incremental build and asset
extraction. The driver invokes the default build target so runtime archives,
Torch and other supporting files are built too. Run BattleShip from that
build directory (on Windows, check the configuration subdirectory).

Use `--generator Ninja` to select Ninja explicitly or let CMake choose the
platform default. Additional CMake definitions can be passed as
`--cmake-arg=-DNAME=value`. The selected BattleShip revision needs the
optional `SSB64_BASEROM` cache setting for an external ROM path; its own
normal `cmake -S . -B build-us` workflow remains supported.

This target builds the existing native game. It does not apply the ROM's
model replacements or unlock patches to BattleShip. Native character
injection remains the engine's existing runtime feature.

## ROM (experimental)

This is an asset-packing target, not a full MIPS source rebuild. It accepts
only the original US v1.0 ROM and converts existing OSB5 fighter files.

Install the exporter dependencies in a virtual environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r hardware-rom/requirements.txt
python3 build.py rom --assets /path/to/play --vpk0 /path/to/vpk0cmd
```

On Windows, activate `.venv\Scripts\Activate.ps1` instead. `vpk0cmd` is the
decompilation's external decompressor: install a binary appropriate to your
host using that project's instructions. The driver checks
`BattleShip/decomp/tools/vpk0cmd`, then `PATH`; `--vpk0` overrides both.
`--decomp` can select a separate decomp checkout, but it is not required.
The driver does not download or install dependencies automatically.

```sh
python3 build.py rom --loadout hardware-rom/loadout.json --triangles 700
```

The result is `build/rom/opensmash.z64` with a JSON asset/hash report. A
structural audit runs before the target reports success. The sample loadout
uses three local assets (`queen.osb`, `50cent-luigi.osb`,
`abrahamlincoln-captain.osb`); those are not distributed with the code.
[ROM details and limitations](hardware-rom/README.md) describe supported
model layouts and the remaining visual/hardware validation.

## Inspection and verification

Either target accepts `--dry-run` to print its commands without executing,
creating directories or requiring installed target dependencies. ROM dry
runs still read the loadout JSON. `--output-dir` selects a dedicated custom
build directory; do not share it between targets. Each executed build writes
`opensmash-target.json` there with its command list and completion status.

```sh
python3 build.py native --dry-run
python3 build.py rom --dry-run
python3 -m unittest discover -s tests -p 'test_build.py'
```

No default/all target automatically builds a ROM. Existing website and
BattleShip build commands continue to work independently. The additions can
land as an optional exporter and a small top-level dispatcher, with the
BattleShip ROM-path option as a separate engine change.
