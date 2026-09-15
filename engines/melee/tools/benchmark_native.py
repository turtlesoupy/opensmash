"""Measure native CPU combat without frame dumping, using an isolated saved-game copy."""
import argparse, csv, hashlib, json, os, shutil, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app',type=Path,default=ROOT/'build/native/OpenSmash Melee.app')
    p.add_argument('--character',default='abrahamlincoln')
    p.add_argument('--target',type=int,help='Optional bundled Melee target ID')
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--seconds',type=int,default=115)
    a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
    app=a.app.resolve()/'Contents';support=Path.home()/'Library/Application Support/OpenSmash Melee'
    build=json.loads((app/'Resources/build.json').read_text())
    module=app/'MacOS/game-module.dylib'
    if hashlib.sha256(module.read_bytes()).hexdigest()!=build['moduleSha256']:raise ValueError('Module hash mismatch')
    base=support/'games/GALE01-r2-original'
    if hashlib.sha256((base/'sys/main.dol').read_bytes()).hexdigest()!=build['dolSha256']:raise ValueError('Game hash mismatch')
    shutil.copytree(base,out/'game',copy_function=os.link)
    character=next(c for c in build['characters'] if c['slug']==a.character)
    if a.target is not None and a.target!=character['fighter']:
        character=character | next(t for t in character.get('targets',[]) if t['fighter']==a.target)
    costume=character['costumes'][0];target=out/'game/files'/costume['filename']
    target.unlink();shutil.copy2(app/'Resources'/costume['path'],target)
    user=out/'user';shutil.copytree(support/'User',user,ignore=shutil.ignore_patterns('Pipes','Dump'))
    import configparser
    config=configparser.ConfigParser();config.optionxform=str;ini=user/'Config/Dolphin.ini';config.read(ini)
    if not config.has_section('Movie'):config.add_section('Movie')
    config['Movie']['DumpFrames']='False'
    with ini.open('w') as f:config.write(f)
    env=dict(os.environ,OPENSMASH_NATIVE_MODULE=str(module),OPENSMASH_FIXED_WINDOW='1',OPENSMASH_MATCH='1',
             OPENSMASH_PORT0=str(character['fighter']|256),OPENSMASH_PORT1=str(12|256),
             OPENSMASH_PORT2=str(2|768),OPENSMASH_PORT3=str(9|768),OPENSMASH_STAGE='31',OPENSMASH_STOCKS='99',
             MELEEPAD_FRAME_PHASE_LOG=str(out/'frames.csv'))
    env.pop('OPENSMASH_SKIN_VERIFY',None)
    command=[str(app/'Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner'),'--game',str(out/'game'),'--module',str(module),
        '--user-dir',str(user),'--title','OpenSmash native performance check','--graphics','Metal','--audio','Cubeb','--mods',str(app/'Resources/Mods')]
    with (out/'game.log').open('w') as log:
        proc=subprocess.Popen(command,env=env,stdout=log,stderr=subprocess.STDOUT)
        (out/'pid').write_text(str(proc.pid))
        try:
            proc.wait(timeout=a.seconds)
            raise RuntimeError('Game exited before the benchmark finished')
        except subprocess.TimeoutExpired:proc.terminate();proc.wait(timeout=10)
        finally:
            if proc.poll() is None:proc.kill();proc.wait()
    rows=list(csv.DictReader((out/'frames.csv').open()))
    rows=[r for r in rows if r.get('draw_calls') is not None]
    # Exclude loading and ten seconds of warm-up; use three independent windows.
    start=int(rows[0]['host_frame_end_unix_ns'])/1e9+10
    windows=[]
    for i in range(3):
        group=[r for r in rows if start+i*30<=int(r['host_frame_end_unix_ns'])/1e9<start+(i+1)*30]
        if len(group)<2:continue
        times=sorted(float(r['total_ms']) for r in group)
        duration=(int(group[-1]['host_frame_end_unix_ns'])-int(group[0]['host_frame_end_unix_ns']))/1e9
        fps=(len(group)-1)/duration
        windows.append(dict(seconds=duration,frames=len(group),fps=fps,p95=times[int(len(times)*.95)],p99=times[int(len(times)*.99)],
            meanDrawCalls=sum(float(r['draw_calls']) for r in group)/len(group),
            passes=duration>=29 and fps>=58.5 and times[int(len(times)*.95)]<=20 and times[int(len(times)*.99)]<=33.34))
    result=dict(character=a.character,target=character['fighter'],moduleSha256=build['moduleSha256'],
        engineSha256=hashlib.sha256(Path(command[0]).read_bytes()).hexdigest(),
        costumeSha256=costume['sha256'],launchModSha256=hashlib.sha256((app/'Resources/Mods/opensmash_launch.mgm.dylib').read_bytes()).hexdigest(),graphics='Metal',audio='Cubeb',window=[960,720],
        capture=False,windows=windows,
        passes=len(windows)==3 and all(w['passes'] for w in windows))
    (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
