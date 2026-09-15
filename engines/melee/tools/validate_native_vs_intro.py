"""Run and capture the shared Classic-to-VS intro on a private disc tree."""
import argparse
import configparser
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from launch_moderngekko import configure_user

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def compact_scene_costume(source, profile):
    """Keep older native apps compatible with demo poses using retail envelopes."""
    from PIL import Image
    from opensmash_melee.archive import Archive
    from opensmash_melee.costume_memory import compact_body_textures
    from opensmash_melee.glb import GLB
    from opensmash_melee.gx import replace_costume
    from opensmash_melee.presentation import panel
    from opensmash_melee.retarget import conform
    from opensmash_melee.skeleton import joints
    assets = ROOT / 'assets/characters' / source.parent.name
    original = (ROOT / 'assets/game/files' / source.name).read_bytes()
    if hashlib.sha256(original).hexdigest() != profile['costume_sha256'] or hashlib.sha256((assets / 'rigged.glb').read_bytes()).hexdigest() != profile['source_glb_sha256']:
        raise ValueError('Compact costume source hash mismatch')
    skeleton = joints(Archive(original), profile['symbol'])
    raw, _ = compact_body_textures(original, skeleton, profile)
    archive = Archive(raw)
    skeleton = joints(archive, profile['symbol'])
    mesh = conform(GLB(assets / 'rigged.glb').mesh(), skeleton, profile)
    mesh['presentation'] = panel(assets)
    mesh['image'] = mesh['image'].resize((256, 256), Image.Resampling.LANCZOS)
    replace_costume(archive, mesh, skeleton, dict(profile, browser_skinning=False))
    return archive.serialize()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=ROOT / 'build/native/OpenSmash Melee Presentation.app')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fighter', type=int, default=8)
    parser.add_argument('--opponent', type=int, default=2)
    parser.add_argument('--stage', type=int, default=31)
    parser.add_argument('--lineup', type=Path, help='JSON array of 2–4 fighters with fighter, color, name, and optional costume path')
    args = parser.parse_args()
    lineup = json.loads(args.lineup.read_text()) if args.lineup else [dict(fighter=args.fighter), dict(fighter=args.opponent)]
    if not isinstance(lineup, list) or not 2 <= len(lineup) <= 4:
        raise ValueError('Lineup must contain two to four players')
    schema = json.loads((ROOT / 'runtime/launch-options.json').read_text())
    slots = set()
    for row in lineup:
        fighter, color = row['fighter'], row.get('color', 0)
        if type(fighter) is not int or not 0 <= fighter < 26 or type(color) is not int or not 0 <= color < len(schema['costumes'][str(fighter)]):
            raise ValueError('Invalid fighter or costume color')
        filename = schema['costumes'][str(fighter)][color]['filename']
        if filename in slots:
            raise ValueError('Use distinct costume files for validation')
        slots.add(filename)
        name = row.get('name', '')
        if not isinstance(name, str) or len(name) > 63 or any(ord(c) < 32 or ord(c) > 126 or c == '%' for c in name):
            raise ValueError('Names must be printable ASCII, at most 63 characters, without percent signs')
    if hashlib.sha256((ROOT / 'assets/game/sys/main.dol').read_bytes()).hexdigest() != 'dc21504513424350bda17a7c65e82371b45112a5dfc1e9f2749a8b7ab0eff646':
        raise ValueError('Requires the verified Melee USA 1.02 executable')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    game = out / 'game'
    shutil.copytree(ROOT / 'assets/game', game, copy_function=os.link)
    for row in lineup:
        if not row.get('costume'):
            continue
        from opensmash_melee.costume_variant import costume_variant
        source = Path(row['costume']).resolve()
        profile = json.loads((source.parent / 'profile.json').read_text())
        if profile.get('fit_version', 0) < 6 or profile.get('head_style') != 'source':
            raise ValueError('Use a current source-preserving custom costume')
        fighter, color = row['fighter'], row.get('color', 0)
        raw = source.read_bytes()
        if sum(bool(p.get('costume')) for p in lineup) >= 3:
            raw = compact_scene_costume(source, profile)
        destination = game / 'files' / schema['costumes'][str(fighter)][color]['filename']
        destination.unlink()  # Break the hard link before staging any costume.
        destination.write_bytes(costume_variant(raw, fighter, color))
    from opensmash_melee.character_select import stage_character_select
    identities=[]
    for row in lineup:
        if row.get('costume'):
            source=Path(row['costume']).resolve().parent
            identities.append((row['fighter'],row.get('color',0),ROOT / 'assets/characters' / source.name))
    stage_character_select(game, identities, cache=ROOT / 'build/character-select-cache')
    user = out / 'user'
    configure_user(user, pipe=True)
    saved = ROOT / 'build/native-target-smoke/user/SmokeUser/GC'
    if saved.is_dir():
        shutil.copytree(saved, user / 'GC')
    (user / 'config.ini').write_text('[Video]\nresolution=640x528\nbackend=Metal\nfullscreen=false\n[Input]\ncontroller=Pipe/0/opensmash\n')
    config = configparser.ConfigParser()
    config.optionxform = str
    ini = user / 'Config/Dolphin.ini'
    config.read(ini)
    config['Movie'] = {'DumpFrames': 'True', 'DumpFramesSilent': 'True'}
    with ini.open('w') as stream:
        config.write(stream)
    (user / 'Config/GFX.ini').write_text('[Settings]\nDumpFramesAsImages = True\nPNGCompressionLevel = 1\n')
    mods = out / 'mods'
    mods.mkdir()
    include = ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include'
    for name in ('launch_match',):
        subprocess.run(['clang', '-dynamiclib', '-O2', '-std=c11', '-I', str(include),
                        str(ROOT / f'runtime/mods/{name}.c'), '-o', str(mods / f'{name}.mgm.dylib')], check=True)
    app = args.app.resolve() / 'Contents'
    command = [str(app / 'Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner'),
               '--game', str(game), '--module', str(app / 'MacOS/game-module.dylib'),
               '--user-dir', str(user), '--title', 'Melee VS intro validation',
               '--graphics', 'Metal', '--audio', 'Null', '--mods', str(mods)]
    env = dict(os.environ, OPENSMASH_NATIVE_MODULE=str(app / 'MacOS/game-module.dylib'),
               OPENSMASH_FIXED_WINDOW='1', OPENSMASH_MATCH='1', OPENSMASH_VS_INTRO='1',
               OPENSMASH_MODE='0', OPENSMASH_PORT0=str(args.fighter),
               OPENSMASH_PORT1=str(args.opponent | 256), OPENSMASH_PORT2='770',
               OPENSMASH_PORT3='777', OPENSMASH_STAGE=str(args.stage), OPENSMASH_STOCKS='4')
    for i, row in enumerate(lineup):
        env[f'OPENSMASH_PORT{i}'] = str(row['fighter'] | (256 if i else 0) | (row.get('color', 0) << 16))

    with (out / 'game.log').open('w') as log:
        proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env)
        pipe = os.open(user / 'Pipes/opensmash', os.O_RDWR | os.O_NONBLOCK)
        try:
            deadline = time.monotonic() + 180
            step = 0
            captured = set()
            while time.monotonic() < deadline and proc.poll() is None:
                trace = (out / 'game.log').read_text()
                if '[opensmash] guest assert' in trace or '[vs-intro] match data mismatch' in trace:
                    raise RuntimeError('Engine validation failed; inspect ' + str(out / 'game.log'))
                press = '[opensmash] launch fighter=' not in trace and step % 4 == 0
                os.write(pipe, b'PRESS A\n' if press else b'RELEASE A\n')
                step += 1
                frames = sorted((user / 'Dump/Frames').glob('*.png'), key=lambda f: int(f.stem.split('_')[-1]))
                for marker, name in [('[opensmash] intro announcer', 'intro'),
                                     ('[opensmash] combat started', 'combat')]:
                    if marker in trace and name not in captured and len(frames) > 2:
                        shutil.copy2(frames[-2], out / (name + '.png'))
                        captured.add(name)
                if 'combat' in captured:
                    if '[opensmash] intro restored VS match' not in trace or 'intro' not in captured:
                        raise RuntimeError('Match started without the expected intro transition')
                    (out / 'result.json').write_text(json.dumps(dict(
                        passed=True, lineup=lineup, stage=args.stage,
                        command=command), indent=2) + '\n')
                    print(out, flush=True)
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('Intro did not complete; inspect ' + str(out / 'game.log'))
        finally:
            os.close(pipe)
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


if __name__ == '__main__':
    main()
