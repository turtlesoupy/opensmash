"""Launch a private Melee runtime with a 960x720 floating viewport beside Codex."""
import argparse
import configparser
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

from prepare_moderngekko import CHECKOUT, ROOT


def configure_user(user, pipe=False):
    config_dir = user / 'Config'
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_dir / 'Dolphin.ini'
    config = configparser.ConfigParser()
    config.optionxform = str
    config.read(path)
    for section, settings in {
        'Display': {'Fullscreen': 'False', 'RenderWindowWidth': '960',
                    'RenderWindowHeight': '720', 'RenderWindowAutoSize': 'False',
                    'RenderWindowSaveOnExit': 'False'},
        'Interface': {'ConfirmStop': 'False', 'OnScreenDisplayMessages': 'False'},
        'Core': {'CPUThread': 'False', 'EnableCheats': 'False'},
        'Input': {'BackgroundInput': 'True'},
    }.items():
        if not config.has_section(section):
            config.add_section(section)
        config[section].update(settings)
    with path.open('w') as stream:
        config.write(stream)
    frontend = user / 'config.ini'
    frontend.write_text('[Video]\nresolution=1280x1056\nbackend=Metal\nfullscreen=false\nshow_fps_in_title=true\n[Input]\n' +
                        ('controller=Pipe/0/opensmash\n' if pipe else ''))
    pad = config_dir / 'GCPadNew.ini'
    if pipe:
        pipes = user / 'Pipes'
        pipes.mkdir(exist_ok=True)
        fifo = pipes / 'opensmash'
        if not fifo.exists():
            os.mkfifo(fifo)
        mapping = ['[GCPad1]', 'Device = Pipe/0/opensmash']
        mapping += [f'Buttons/{name} = `Button {name}`' for name in ('A', 'B', 'X', 'Y', 'Z', 'Start')]
        mapping[-1] = 'Buttons/Start = `Button START`'
        mapping += [f'D-Pad/{direction} = `Button D_{direction.upper()}`'
                    for direction in ('Up', 'Down', 'Left', 'Right')]
        for group, prefix in [('Main Stick', 'MAIN'), ('C-Stick', 'C')]:
            mapping += [f'{group}/{direction} = `Axis {prefix} {axis} {sign}`'
                        for direction, axis, sign in [('Up', 'Y', '+'), ('Down', 'Y', '-'),
                                                      ('Left', 'X', '-'), ('Right', 'X', '+')]]
        mapping += ['Triggers/L = `Button L`', 'Triggers/R = `Button R`',
                    'Triggers/L-Analog = `Axis L +`', 'Triggers/R-Analog = `Axis R +`',
                    '[GCPad2]', '[GCPad3]', '[GCPad4]']
        pad.write_text('\n'.join(mapping) + '\n')
    elif not pad.exists():
        shutil.copy2(CHECKOUT / 'apple/macos/default-GCPadNew.ini', pad)


def windows():
    return json.loads(subprocess.check_output(
        ['aerospace', 'list-windows', '--all', '--json'], text=True))


def launch(game, user, module=None, pipe=False, headless=False, match=None):
    runner = CHECKOUT / 'ref/ModernGekko/build-desktop-tools-meleepad/moderngekko-run'
    if not runner.is_file():
        raise ValueError('Build the runtime with prepare_moderngekko.py first')
    if module is None:
        pointer = CHECKOUT / 'ref/ModernGekko-Template/build/modules-macos14-r2/GALE01/active-module.txt'
        module = Path(pointer.read_text().strip())
        if not module.is_absolute():
            module = CHECKOUT / 'ref/ModernGekko-Template' / module
    if not module.is_file() or not (game / 'sys/main.dol').is_file():
        raise ValueError('Game extraction or generated module is missing')
    if hashlib.sha256((game / 'sys/main.dol').read_bytes()).hexdigest() != 'dc21504513424350bda17a7c65e82371b45112a5dfc1e9f2749a8b7ab0eff646':
        raise ValueError('This launcher requires the verified USA 1.02 executable')
    configure_user(user, pipe)
    before = windows() if shutil.which('aerospace') and not headless else []
    old = {w['window-id'] for w in before}
    codex = [w for w in before if w.get('app-name') == 'Codex']
    workspace = None
    if codex:
        workspace = subprocess.check_output(['aerospace', 'list-windows', '--all', '--format',
                                             '%{window-id} %{workspace}'], text=True)
        workspace = dict(line.split(maxsplit=1) for line in workspace.splitlines())[str(codex[0]['window-id'])]
    command = [str(runner), '--game', str(game), '--module', str(module), '--user-dir', str(user),
               '--title', 'OpenSmash Melee', '--graphics', 'Null' if headless else 'Metal',
               '--audio', 'Null' if headless else 'Cubeb']
    if headless:
        command.append('--headless')
    env = os.environ.copy()
    env['MODERNGEKKO_ENABLE_SAVESTATE_SIGNALS'] = '1'
    if match is not None:
        mods = user / 'Mods'
        mods.mkdir(exist_ok=True)
        subprocess.run(['clang', '-dynamiclib', '-O2', '-std=c11',
                        '-I', str(CHECKOUT / 'ref/ModernGekko/include'),
                        str(ROOT / 'runtime/mods/launch_match.c'), '-o',
                        str(mods / 'opensmash_launch.mgm.dylib')], check=True)
        command += ['--mods', str(mods)]
        env.update(OPENSMASH_MATCH='1', OPENSMASH_FIGHTER=str(match[0]),
                   OPENSMASH_OPPONENT=str(match[1]), OPENSMASH_STAGE=str(match[2]))
    with (user / 'launch.log').open('w') as log:
        proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env)
    (user / 'pid').write_text(str(proc.pid))
    if before:
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline and proc.poll() is None:
            for window in windows():
                if window['window-id'] not in old and window.get('window-title', '').startswith('OpenSmash Melee'):
                    wid = str(window['window-id'])
                    subprocess.run(['aerospace', 'layout', '--window-id', wid, 'floating'], check=True)
                    if workspace:
                        subprocess.run(['aerospace', 'move-node-to-workspace', '--window-id', wid, workspace], check=True)
                    return proc
            time.sleep(.2)
        proc.terminate()
        proc.wait(timeout=10)
        raise RuntimeError(f'No game window appeared; see {user / "launch.log"}')
    return proc


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('game', type=Path)
    parser.add_argument('--user', type=Path, default=ROOT / 'build/moderngekko-user')
    parser.add_argument('--module', type=Path)
    parser.add_argument('--pipe', action='store_true')
    parser.add_argument('--headless', action='store_true')
    parser.add_argument('--match', type=int, nargs=3, metavar=('FIGHTER', 'OPPONENT', 'STAGE'))
    args = parser.parse_args()
    proc = launch(args.game.resolve(), args.user.resolve(), args.module, args.pipe, args.headless, args.match)
    print(f'OpenSmash Melee PID {proc.pid}; log: {args.user / "launch.log"}', flush=True)
    raise SystemExit(proc.wait())
