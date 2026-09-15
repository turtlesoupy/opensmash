"""Capture original Mario and an identical retarget before/after material lighting.

Runs the actual native GX renderer with a validation-only close camera.
Requires the local native build, verified extracted game, and a Mario costume.
All game-derived output stays under build/. No ROM is packaged or downloaded.
"""
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
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.materials import upgrade_cached_lighting
from launch_moderngekko import configure_user


def material_variant(raw, legacy, gray=False):
    a = Archive(raw)
    symbol = next(k for k in a.roots() if k.endswith('_joint'))
    active = []
    for j in joints(a, symbol):
        d = j['dobj']
        while d is not None:
            if a.ptr(d + 12) is not None:
                active.append(a.ptr(d + 8))
            d = a.ptr(d + 4)
    if len(set(active)) != 1:
        raise ValueError('Expected a single-material exported costume')
    m = active[0]
    a.pack('I', m + 4, 0x15)
    mat = a.ptr(m + 12)
    a.pack('II', mat, 0xffffffff, 0xffffffff)
    a.pack('I', a.ptr(m + 8) + 64, 0x40010)
    if gray:
        from PIL import Image
        from opensmash_melee.gx import rgba8
        descriptor = a.ptr(a.ptr(m + 8) + 76)
        width, height, fmt = a.unpack('HHI', descriptor + 4)
        if fmt != 6:
            raise ValueError('Gray validation requires exported RGBA8')
        pixels = rgba8(Image.new('RGBA', (width, height), (180, 180, 180, 255)))
        start = a.ptr(descriptor)
        a.data[start:start + len(pixels)] = pixels
    raw = a.serialize()
    return raw if legacy else upgrade_cached_lighting(raw)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--costume', type=Path, required=True)
    p.add_argument('--case', choices=['mario', 'before', 'after', 'gray'], required=True)
    p.add_argument('--frames', type=int, default=480)
    p.add_argument('--output', type=Path, default=ROOT / 'build/shading-validation')
    args = p.parse_args()
    out = args.output.resolve() / args.case
    dol = ROOT / 'assets/game/sys/main.dol'
    if hashlib.sha256(dol.read_bytes()).hexdigest() != 'dc21504513424350bda17a7c65e82371b45112a5dfc1e9f2749a8b7ab0eff646':
        raise ValueError('Expected the verified Melee USA 1.02 executable')
    if out.exists():
        raise ValueError('Use a new output directory to preserve previous evidence')
    out.mkdir(parents=True)
    game = out / 'game'
    shutil.copytree(ROOT / 'assets/game', game, copy_function=os.link)
    if args.case != 'mario':
        costume = game / 'files/PlMrNr.dat'
        costume.unlink()  # Never write through a hard link to original game data.
        costume.write_bytes(material_variant(args.costume.read_bytes(), args.case == 'before', args.case == 'gray'))
    user = out / 'user'
    configure_user(user, pipe=True)
    config = configparser.ConfigParser();config.optionxform = str
    ini = user / 'Config/Dolphin.ini';config.read(ini)
    config['Movie'] = {'DumpFrames': 'True', 'DumpFramesSilent': 'True'}
    with ini.open('w') as f: config.write(f)
    (user / 'Config/GFX.ini').write_text('[Settings]\nDumpFramesAsImages = True\nPNGCompressionLevel = 1\n')
    mods = out / 'mods';mods.mkdir()
    include = ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include'
    for name in ('launch_match', 'validate_shading'):
        subprocess.run(['clang', '-dynamiclib', '-O2', '-std=c11', '-I', str(include),
                        str(ROOT / f'runtime/mods/{name}.c'), '-o', str(mods / f'{name}.mgm.dylib')], check=True)
    app = ROOT / 'build/native/OpenSmash Melee.app/Contents'
    command = [str(app / 'Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner'),
               '--game', str(game), '--module', str(app / 'MacOS/game-module.dylib'),
               '--user-dir', str(user), '--title', 'OpenSmash shading validation',
               '--graphics', 'Metal', '--audio', 'Null', '--mods', str(mods)]
    env = dict(os.environ, OPENSMASH_FIXED_WINDOW='1', OPENSMASH_MATCH='1',
               OPENSMASH_PORT0='8', OPENSMASH_PORT1=str(8 | (1 << 16)),
               OPENSMASH_STAGE='31')  # Two idle human ports; original Mario opponent.
    with (out / 'game.log').open('w') as log:
        proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env)
        pipe = os.open(user / 'Pipes/opensmash', os.O_RDWR | os.O_NONBLOCK)
        try:
            deadline = time.monotonic() + 90
            step = 0
            while time.monotonic() < deadline and proc.poll() is None:
                trace = (out / 'game.log').read_text()
                press = '[opensmash] launch fighter=' not in trace and step % 4 == 0
                os.write(pipe, b'PRESS A\n' if press else b'RELEASE A\n')
                step += 1
                frames = sorted((user / 'Dump/Frames').glob('*.png'), key=lambda f:int(f.stem.split('_')[-1]))
                observed = re.findall(r'\[shading\] frame=(\d+) motion=(\d+) anim_bits=([0-9a-f]+)', trace)
                if observed and int(observed[-1][0]) >= args.frames and len(frames)>2:
                    locked = len(observed)>1 and observed[-1][1]=='14' and observed[-1][1:]==observed[-2][1:]
                    if locked:
                        break
                    if int(observed[-1][0]) >= args.frames + 180:
                        raise RuntimeError('Idle pose did not hold; refusing an uncontrolled comparison')
                time.sleep(.25)
            else:
                raise RuntimeError('Capture did not finish; inspect game.log')
            # Preserve exact native framebuffer samples, without resampling.
            chosen = frames[-2]  # The newest dump may still be writing.
            shutil.copy2(chosen, out / 'capture.png')
            (out / 'capture.json').write_text(json.dumps(dict(case=args.case,
                frame=chosen.name, frames=len(frames), command=command,
                motion=14, animationFrameBits=observed[-1][2], poseHeld=True,
                camera=dict(eyeOffset=[18,9,28], interestOffset=[0,8,0], fov=30)), indent=2)+'\n')
            print(out / 'capture.png', flush=True)
        finally:
            os.close(pipe)
            proc.terminate()
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired: proc.kill();proc.wait()


if __name__ == '__main__': main()
