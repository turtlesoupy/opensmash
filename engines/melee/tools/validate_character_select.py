"""Capture real VS/Classic CSS paging, hover, confirmation and announcer routing."""
import argparse
import configparser
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from launch_moderngekko import configure_user
from opensmash_melee.character_select import stage_character_select
from opensmash_melee.costume_variant import costume_variant, SCHEMA


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=ROOT / 'build/native/OpenSmash Melee.app')
    parser.add_argument('--runtime', type=Path, help='Integrated desktop runtime directory (instead of the standalone app)')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--entry', action='append', required=True, help='Character directory ID:external fighter:color; first entry must use Mario for the cursor test')
    parser.add_argument('--prepared-game', type=Path, help='Reuse a private disc staged by a prior run with exactly the same entries')
    parser.add_argument('--classic', action='store_true', help='Alias for --mode 3')
    parser.add_argument('--mode', type=int, choices=range(5), default=2, help='Launch protocol mode 0–4')
    args = parser.parse_args()
    mode = 3 if args.classic else args.mode
    entries = []
    for value in args.entry:
        ident, fighter, color = value.rsplit(':', 2)
        if Path(ident).name != ident: raise ValueError('Use a character directory ID')
        entries.append((int(fighter), int(color), ROOT / 'assets/characters' / ident))
    if entries[0][0] != 8: raise ValueError('The cursor test targets Mario’s grid location')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    game = out / 'game'
    original = ROOT / 'assets/game'
    if hashlib.sha256((original / 'sys/main.dol').read_bytes()).hexdigest() != 'dc21504513424350bda17a7c65e82371b45112a5dfc1e9f2749a8b7ab0eff646':
        raise ValueError('Expected the verified USA 1.02 game')
    if args.prepared_game:
        game = args.prepared_game.resolve()
    else:
        shutil.copytree(original, game, copy_function=os.link)
        for fighter, color, source in entries:
            slot = SCHEMA['costumes'][str(fighter)][color]
            neutral = SCHEMA['costumes'][str(fighter)][0]['filename']
            costume = ROOT / 'build/characters' / source.name / neutral
            if not costume.is_file(): raise ValueError('Build the character costume first: ' + str(costume))
            target = game / 'files' / slot['filename']
            target.unlink()
            target.write_bytes(costume_variant(costume.read_bytes(), fighter, color))
        stage_character_select(game, entries)
    user = out / 'user'
    configure_user(user, True)
    config = configparser.ConfigParser();config.optionxform = str
    ini = user / 'Config/Dolphin.ini';config.read(ini)
    config['Movie'] = {'DumpFrames': 'True', 'DumpFramesSilent': 'True'}
    config['DSP'] = {'Backend': 'Cubeb', 'DumpAudio': 'True'}
    with ini.open('w') as stream: config.write(stream)
    (user / 'Config/GFX.ini').write_text('[Settings]\nDumpFramesAsImages = True\nPNGCompressionLevel = 1\n')
    mods = out / 'mods';mods.mkdir()
    for source, name in [('validate_character_select', '00review'), ('launch_match', 'launch')]:
        subprocess.run(['clang', '-dynamiclib', '-O2', '-std=c11', '-I', str(ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include'),
                        str(ROOT / f'runtime/mods/{source}.c'), '-o', str(mods / f'{name}.mgm.dylib')], check=True)
    app = args.app.resolve() / 'Contents'
    module = args.runtime.resolve() / 'gGALE01_recomp.dylib' if args.runtime else app / 'MacOS/game-module.dylib'
    runner = args.runtime.resolve() / 'Melee Engine.app/Contents/MacOS/MeleeRunner' if args.runtime else app / 'Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner'
    env = dict(os.environ, OPENSMASH_MATCH='1', OPENSMASH_FIXED_WINDOW='1', OPENSMASH_NATIVE_MODULE=str(module),
               OPENSMASH_MODE=str(mode), OPENSMASH_PORT0=str(entries[0][0] | entries[0][1] << 16),
               OPENSMASH_PORT1=str((entries[1][0] | entries[1][1] << 16 | 256) if len(entries) > 1 else 268))
    command = [str(runner), '--game', str(game), '--module', str(module),
               '--user-dir', str(user), '--graphics', 'Metal', '--audio', 'Cubeb', '--mods', str(mods)]
    with (out / 'game.log').open('w') as log: process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT)
    pipe = os.open(user / 'Pipes/opensmash', os.O_RDWR | os.O_NONBLOCK)
    try:
        deadline = time.monotonic() + 240
        step = 0
        combat_step = 0
        while process.poll() is None and time.monotonic() < deadline:
            trace = (out / 'game.log').read_text()
            if '[css-review] done' in trace:
                time.sleep(.25)
                break
            if mode == 0 and trace.count('CSS injection entries=') >= 3:
                command_input = b'RELEASE L\nRELEASE R\nRELEASE A\nRELEASE B\nRELEASE START\n'
            elif mode == 0 and '[opensmash] combat started' in trace and '[css-review] hover' not in trace:
                # Pause and use Melee's native L+R+A+Start no-contest shortcut.
                combat_step += 1
                command_input = {12: b'PRESS START\n', 14: b'RELEASE START\n',
                                 20: b'PRESS L\nPRESS R\nPRESS A\nPRESS START\n',
                                 24: b'RELEASE L\nRELEASE R\nRELEASE A\nRELEASE START\n'}.get(combat_step, b'')
                if combat_step > 32:
                    if '[css-review] stage visits=3' in trace:
                        command_input = b'RELEASE L\nRELEASE R\nRELEASE A\nRELEASE START\n' + (b'PRESS B\n' if combat_step % 8 < 4 else b'RELEASE B\n')
                    elif 'results identity' in trace:
                        command_input = b'RELEASE L\nRELEASE R\n' + (b'PRESS A\nPRESS START\n' if combat_step % 8 < 4 else b'RELEASE A\nRELEASE START\n')
                    else:
                        command_input = b'PRESS L\nPRESS R\nPRESS A\nPRESS START\n' if combat_step % 16 < 8 else b'RELEASE L\nRELEASE R\nRELEASE A\nRELEASE START\n'
            else:
                command_input = (b'PRESS A\nPRESS START\n' if mode == 4 else b'PRESS A\n') if 'CSS injection' not in trace and step % 4 == 0 else b'RELEASE A\nRELEASE START\n'
            try: os.write(pipe, command_input)
            except BlockingIOError: pass
            step += 1;time.sleep(.25)
        else: raise RuntimeError('CSS review did not complete; inspect game.log')
        frames = sorted((user / 'Dump/Frames').glob('*.png'), key=lambda p: int(p.stem.split('_')[-1]))
        if len(frames) < 2: raise RuntimeError('No renderer capture')
        shutil.copy2(frames[-2], out / 'capture.png')
        checks = {name: marker in trace for name, marker in {
            'registry': 'CSS injection entries=', 'left': 'CSS page=0', 'right': 'CSS page=1',
            'hover': '[css-review] hover', 'confirm': '[css-review] confirm', 'announcer': 'CSS announcer entry=1',
        }.items()}
        checks['destination'] = f'destination ready mode={mode}' in trace
        if mode == 0: checks['combat'] = '[opensmash] combat started' in trace
        selected = re.search(r'done ports=(\d+):(\d+),(\d+):(\d+)', trace)
        checks['selectedPort0'] = bool(selected and tuple(map(int, selected.group(1, 2))) == entries[0][:2])
        if len(entries) > 1 and mode in (0, 1, 2):
            checks['selectedPort1'] = bool(selected and tuple(map(int, selected.group(3, 4))) == entries[1][:2])
        (out / 'result.json').write_text(json.dumps({'mode': mode, 'checks': checks, 'command': command}, indent=2) + '\n')
        if not all(checks.values()): raise RuntimeError('CSS review failed: ' + str(checks))
        print(out / 'capture.png')
    finally:
        os.close(pipe);process.terminate()
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: process.kill();process.wait()


if __name__ == '__main__': main()
