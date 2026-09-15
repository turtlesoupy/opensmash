"""Run production exports against stock opponents and retain combat telemetry."""
import argparse,configparser,json,os,shutil,subprocess,sys,time,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.targets import PLAYABLE,BY_SLUG
from opensmash_melee.retarget_probe import TARGETS
KINDS={slug:kind for slug,code,kind in TARGETS}
from tools.launch_moderngekko import configure_user

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--target',action='append',choices=list(PLAYABLE));parser.add_argument('--timeout',type=int,default=90);parser.add_argument('--backend',choices=['static','jit'],default='static');args=parser.parse_args()
 out=ROOT/'build/roster-integration/combat';out.mkdir(parents=True,exist_ok=True)
 mods=out/'mods';mods.mkdir(exist_ok=True)
 for name in ['launch_match','probe_retarget_roster']:
  subprocess.run(['clang','-dynamiclib','-O2','-std=c11','-I',str(ROOT/'build/browser-engine/meleepad/ref/ModernGekko/include'),str(ROOT/f'runtime/mods/{name}.c'),'-o',str(mods/(name+'.mgm.dylib'))],check=True)
 runtime=ROOT/'build/desktop-runtime';manifest=json.loads((runtime/'runtime.json').read_text());results=json.loads((out/'report.json').read_text()) if (out/'report.json').exists() else []
 for target,option in PLAYABLE.items():
  if args.target and target not in args.target:continue
  if any(r['target']==target and r['passed'] for r in results):continue
  results=[r for r in results if r['target']!=target]
  folder=out/target;folder.mkdir(exist_ok=True);game=folder/'game'
  if not game.exists():shutil.copytree(ROOT/'assets/game',game,copy_function=os.link)
  for slug in [target]+(['nana'] if target=='popo' else []):
   filename=BY_SLUG[slug]['costumes'][0]['filename'];src=ROOT/f'build/characters/roster-v1-alanturing-{slug}/browser'/filename
   dest=game/'files'/filename
   if dest.exists():dest.unlink()
   shutil.copy2(src,dest)
  user=folder/'user';configure_user(user,pipe=True)
  cfg=configparser.ConfigParser();cfg.optionxform=str;cfg.read(user/'Config/Dolphin.ini');cfg['Core']['FastDiscSpeed']='True'
  with (user/'Config/Dolphin.ini').open('w') as file:cfg.write(file)
  fighter=option['fighter'];log=folder/'combat.log'
  env=dict(os.environ,OPENSMASH_CPU_BACKEND=args.backend,OPENSMASH_FIXED_WINDOW='1',OPENSMASH_MATCH='1',OPENSMASH_NATIVE_MODULE=str(runtime/manifest['module']),OPENSMASH_MODE='0',OPENSMASH_PORT0=str(fighter|256),OPENSMASH_PORT1=str(fighter|256|(1<<16)),OPENSMASH_PORT2=str(770),OPENSMASH_PORT3=str(777),OPENSMASH_STAGE='31')
  with log.open('w') as f:
   proc=subprocess.Popen([str(runtime/manifest['runner']),'--game',str(game),'--module',str(runtime/manifest['module']),'--user-dir',str(user),'--graphics','Metal','--audio','Null','--mods',str(mods),'--title','Retarget combat validation'],env=env,stdout=f,stderr=subprocess.STDOUT)
   start=time.monotonic();passed=False
   try:
    while proc.poll() is None and time.monotonic()-start<args.timeout:
     text=log.read_text(errors='replace');frames=re.findall(r'\[probe-frame\] (\d+)',text)
     if 'guest assert' in text:break
     if frames and int(frames[-1])>=900 and '[opensmash] combat started' in text:
      actors=re.findall(r'\[probe-actor\].*',text);passed=len(actors)>10 and any(f'port=0 kind={KINDS[target]} ' in actor for actor in actors);break
     time.sleep(.5)
   finally:
    proc.terminate()
    try:proc.wait(timeout=8)
    except subprocess.TimeoutExpired:proc.kill();proc.wait()
   results.append(dict(target=target,backend=args.backend,passed=passed,seconds=round(time.monotonic()-start,1)));(out/'report.json').write_text(json.dumps(results,indent=2));print(results[-1],flush=True)
 return 0 if all(r['passed'] for r in results) else 1
if __name__=='__main__':sys.exit(main())
