"""Capture real results after a validation-only blast-zone KO; no product shortcuts."""
import argparse, configparser, hashlib, json, os, re, shutil, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from launch_moderngekko import configure_user

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app',type=Path,default=ROOT/'build/native/OpenSmash Melee.app')
    p.add_argument('--costume', type=Path, required=True)
    p.add_argument('--opponent-costume',type=Path)
    p.add_argument('--case', choices=['custom', 'vanilla'], required=True)
    p.add_argument('--frames', type=int, default=600)
    p.add_argument('--output', type=Path, default=ROOT / 'build/results-validation')
    args = p.parse_args()
    for costume in [args.costume,args.opponent_costume]:
        if costume and (costume.parent/"profile.json").exists():
            profile=json.loads((costume.parent/"profile.json").read_text())
            if profile.get("head_style")!="source" or profile.get("fit_version",0)<6:
                raise ValueError("Results review requires the current source-preserving fit, not a legacy retarget: "+str(costume))
    out = args.output.resolve() / args.case
    dol = ROOT / 'assets/game/sys/main.dol'
    if hashlib.sha256(dol.read_bytes()).hexdigest() != 'dc21504513424350bda17a7c65e82371b45112a5dfc1e9f2749a8b7ab0eff646':
        raise ValueError('Expected the verified Melee USA 1.02 executable')
    if out.exists():
        raise ValueError('Use a new output directory to preserve previous evidence')
    out.mkdir(parents=True)
    game = out / 'game'
    shutil.copytree(ROOT / 'assets/game', game, copy_function=os.link)
    if args.case != 'vanilla':
        costume = game / 'files/PlMrNr.dat'
        costume.unlink()  # Never write through a hard link to original game data.
        costume.write_bytes(args.costume.read_bytes())
    if args.opponent_costume:
        from opensmash_melee.costume_variant import costume_variant
        opponent=game/'files/PlMrYe.dat';opponent.unlink()
        opponent.write_bytes(costume_variant(args.opponent_costume.read_bytes(),8,1))
    user = out / 'user'
    configure_user(user, pipe=True)
    saved=ROOT/'build/native-target-smoke/user/SmokeUser/GC'
    if saved.is_dir():shutil.copytree(saved,user/'GC')
    (user/'config.ini').write_text('[Video]\nresolution=1280x1056\nbackend=Metal\nfullscreen=false\n[Input]\ncontroller=Pipe/0/opensmash\n')
    config = configparser.ConfigParser();config.optionxform = str
    ini = user / 'Config/Dolphin.ini';config.read(ini)
    config['Movie'] = {'DumpFrames': 'True', 'DumpFramesSilent': 'True'}
    with ini.open('w') as f: config.write(f)
    (user / 'Config/GFX.ini').write_text('[Settings]\nDumpFramesAsImages = True\nPNGCompressionLevel = 1\n')
    mods = out / 'mods';mods.mkdir()
    include = ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include'
    for name in ('launch_match', 'validate_results'):
        subprocess.run(['clang', '-dynamiclib', '-O2', '-std=c11', '-I', str(include),
                        str(ROOT / f'runtime/mods/{name}.c'), '-o', str(mods / f'{name}.mgm.dylib')], check=True)
    app = args.app.resolve() / 'Contents'
    command = [str(app / 'Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner'),
               '--game', str(game), '--module', str(app / 'MacOS/game-module.dylib'),
               '--user-dir', str(user), '--title', 'OpenSmash results validation',
               '--graphics', 'Metal', '--audio', 'Null', '--mods', str(mods)]
    env = dict(os.environ, OPENSMASH_NATIVE_MODULE=str(app / 'MacOS/game-module.dylib'), OPENSMASH_FIXED_WINDOW='1', OPENSMASH_MATCH='1',
               OPENSMASH_PORT0='8', OPENSMASH_PORT1=str(8 | (1 << 16)),
               OPENSMASH_STAGE='31', OPENSMASH_STOCKS='1')  # Two idle human ports; original Mario opponent.
    with (out / 'game.log').open('w') as log:
        proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env)
        pipe = os.open(user / 'Pipes/opensmash', os.O_RDWR | os.O_NONBLOCK)
        try:
            deadline = time.monotonic() + 180
            step = 0
            advanced = False
            while time.monotonic() < deadline and proc.poll() is None:
                trace = (out / 'game.log').read_text()
                press = '[opensmash] launch fighter=' not in trace and step % 4 == 0
                if '[results-review] frame=240' in trace and 'results identity port=0' not in trace and not advanced:
                    press = True; advanced = True
                os.write(pipe, b'PRESS A\n' if press else b'RELEASE A\n')
                step += 1
                frames = sorted((user / 'Dump/Frames').glob('*.png'), key=lambda f:int(f.stem.split('_')[-1]))
                observed = re.findall(r'\[results-review\] frame=(\d+)', trace)
                if observed and int(observed[-1])>=args.frames and len(frames)>2:break
                time.sleep(.25)
            else:
                raise RuntimeError('Capture did not finish; inspect game.log')
            # Preserve exact native framebuffer samples, without resampling.
            chosen = frames[-2]  # The newest dump may still be writing.
            shutil.copy2(chosen, out / 'capture.png')
            (out / 'capture.json').write_text(json.dumps(dict(case=args.case,
                frame=chosen.name,frames=len(frames),command=command,
                resultsFrames=int(observed[-1]),identityInstalled='results identity port=0' in trace),indent=2)+'\n')
            if args.case=='custom' and 'results identity port=0' not in trace:
                raise RuntimeError('Custom results identity was not installed')
            if args.opponent_costume and 'results identity port=1' not in trace:
                raise RuntimeError('Second custom results identity was not installed')
            print(out / 'capture.png', flush=True)
        finally:
            os.close(pipe)
            proc.terminate()
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired: proc.kill();proc.wait()


if __name__ == '__main__': main()
