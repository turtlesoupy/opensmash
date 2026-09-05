#!/usr/bin/env python3
"""Build OpenSmash targets without changing the website or engine checkout."""
import argparse
import json
from pathlib import Path
import platform
import shlex
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def parser():
    ap = argparse.ArgumentParser(description=__doc__)
    targets = ap.add_subparsers(dest='target', required=True)
    for name in ('rom', 'native'):
        p = targets.add_parser(name, help='Build '+name+' output')
        p.add_argument('--battleship', type=Path, default=ROOT.parent/'BattleShip')
        p.add_argument('--rom', type=Path, help='Base ROM (default: BattleShip/baserom.us.z64)')
        p.add_argument('--output-dir', type=Path, help='Dedicated target build directory')
        p.add_argument('--dry-run', action='store_true', help='Print commands without running or creating files')
    rom = targets.choices['rom']
    rom.add_argument('--decomp', type=Path, help='Default: BattleShip/decomp')
    rom.add_argument('--assets', type=Path, default=ROOT/'play')
    rom.add_argument('--loadout', type=Path, default=ROOT/'hardware-rom/loadout.json')
    rom.add_argument('--vpk0', type=Path, help='Default: decomp/tools/vpk0cmd, then PATH')
    rom.add_argument('--triangles', type=int, default=700)
    native = targets.choices['native']
    native.add_argument('--version', choices=['us','jp'], default='us')
    native.add_argument('--config', choices=['Debug','Release','RelWithDebInfo'], default='Release')
    native.add_argument('--jobs', type=int, default=4)
    native.add_argument('--generator', help='CMake generator; otherwise use platform default')
    native.add_argument('--cmake-arg', action='append', default=[], help='Extra configure option; use --cmake-arg=-DNAME=value')
    return ap


def plan(args):
    engine = args.battleship.resolve()
    version = getattr(args, 'version', 'us')
    default_rom = engine/f'baserom.{version}.z64'
    if args.target == 'native':
        default_rom = next((engine/f'baserom.{version}.{ext}' for ext in ('z64', 'n64', 'v64')
                            if (engine/f'baserom.{version}.{ext}').is_file()), default_rom)
    base = (args.rom or default_rom).resolve()
    if args.target == 'native':
        if args.jobs < 1:
            raise ValueError('--jobs must be positive')
        output = (args.output_dir or ROOT/'build'/f'native-{platform.system().lower()}-{version}-{args.config.lower()}').resolve()
        configure = ['cmake', '-S', str(engine), '-B', str(output),
                     f'-DSSB64_VERSION={version}', f'-DCMAKE_BUILD_TYPE={args.config}',
                     f'-DSSB64_BASEROM={base}']
        if args.generator:
            configure += ['-G', args.generator]
        # Keep caller options from overriding this driver's target isolation.
        if any(not arg.startswith('-D') or arg[2:].split('=')[0].split(':')[0] in ('SSB64_VERSION', 'CMAKE_BUILD_TYPE', 'SSB64_BASEROM') for arg in args.cmake_arg):
            raise ValueError('--cmake-arg accepts additional -D options only; use named options for ROM, version and config')
        commands = [configure + args.cmake_arg,
                    ['cmake', '--build', str(output), '--config', args.config, '--parallel', str(args.jobs)]]
        required = [base, engine/'CMakeLists.txt'] + [engine/sm/'CMakeLists.txt' for sm in ('libultraship','torch')]
        required += [engine/'decomp/src/ft/ftmanager.c']
    else:
        if not 32 <= args.triangles <= 2000:
            raise ValueError('--triangles must be between 32 and 2000')
        output = (args.output_dir or ROOT/'build/rom').resolve()
        decomp = (args.decomp or engine/'decomp').resolve()
        candidate = decomp/'tools/vpk0cmd'
        vpk0 = (args.vpk0 or (candidate if candidate.is_file() else Path(shutil.which('vpk0cmd') or candidate))).resolve()
        loadout_path = args.loadout.resolve()
        loadout = json.loads(loadout_path.read_text())
        if not loadout or len({f['model_file'] for f in loadout}) != len(loadout):
            raise ValueError('Loadout must contain distinct model files')
        required = [base, vpk0]
        for fighter in loadout:
            required += [args.assets.resolve()/fighter['asset'],
                         decomp/'src/relocData'/fighter['model_source'],
                         decomp/'src/relocData'/fighter['main_source']]
        artifact = output/'opensmash.z64'
        commands = [[sys.executable, str(ROOT/'hardware-rom/build_rom.py'),
                     '--rom', str(base), '--decomp', str(decomp), '--vpk0', str(vpk0),
                     '--assets', str(args.assets.resolve()), '--loadout', str(loadout_path),
                     '--triangles', str(args.triangles), '--output', str(artifact)],
                    [sys.executable, str(ROOT/'hardware-rom/verify_rom.py'), str(base), str(artifact),
                     '--models', *[str(f['model_file']) for f in loadout]]]
    if output in (ROOT, engine) or output in ROOT.parents or output in engine.parents:
        raise ValueError('Use a dedicated output directory, not a repository root or its parent')
    return output, required, commands


def main(argv=None):
    ap = parser()
    args = ap.parse_args(argv)
    try:
        output, required, commands = plan(args)
        if args.dry_run:
            for command in commands:
                print(shlex.join(command))
            return 0
        missing = [str(path) for path in required if not path.is_file()]
        if missing:
            raise ValueError('Missing build inputs:\n  '+'\n  '.join(missing)+'\nSee BUILDING.md for target prerequisites.')
        if args.target == 'native' and not shutil.which('cmake'):
            raise ValueError('Native target requires CMake 3.24 or newer')
        marker = output/'opensmash-target.json'
        if marker.exists() and json.loads(marker.read_text())['target'] != args.target:
            raise ValueError('Output directory belongs to a different target')
        output.mkdir(parents=True, exist_ok=True)
        record = dict(target=args.target, status='building', commands=commands)
        marker.write_text(json.dumps(record, indent=2)+'\n')
        for command in commands:
            print('+ '+shlex.join(command), flush=True)
            try:
                subprocess.run(command, check=True, cwd=ROOT)
            except (OSError, subprocess.CalledProcessError):
                record['status'] = 'failed'
                marker.write_text(json.dumps(record, indent=2)+'\n')
                raise
        record['status'] = 'complete'
        marker.write_text(json.dumps(record, indent=2)+'\n')
        print(f'{args.target} build complete: {output}')
        return 0
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as exc:
        print(f'Build failed: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
