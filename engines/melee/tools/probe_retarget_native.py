"""Smoke-test experimental costumes in the installed native engine, silently."""
import argparse,configparser,json,os,re,shutil,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tools.launch_moderngekko import configure_user

def run(slug,fighter,costumes,base):
 out=base/slug;out.mkdir(parents=True,exist_ok=False)
 game=out/'game';shutil.copytree(ROOT/'assets/game',game,copy_function=os.link)
 for target,code in costumes:
  dest=game/f'files/Pl{code}Nr.dat';dest.unlink();shutil.copy2(ROOT/f'build/retarget-roster-probe/{target}/alanturing.dat',dest)
 user=out/'user';configure_user(user,pipe=True)
 saved=ROOT/'build/native-target-smoke/user/SmokeUser/GC'
 if saved.is_dir():shutil.copytree(saved,user/'GC')
 cfg=configparser.ConfigParser();cfg.optionxform=str;cfg.read(user/'Config/Dolphin.ini');cfg['Core']['FastDiscSpeed']='True';cfg['Movie']={'DumpFrames':'True','DumpFramesSilent':'True'}
 with (user/'Config/Dolphin.ini').open('w') as f:cfg.write(f)
 (user/'Config/GFX.ini').write_text('[Settings]\nInternalResolution = 1\nDumpFramesAsImages = True\nPNGCompressionLevel = 1\n')
 mods=out/'mods';mods.mkdir();include=ROOT/'build/browser-engine/meleepad/ref/ModernGekko/include'
 for name in ['launch_match','probe_retarget_roster']:
  subprocess.run(['clang','-dynamiclib','-O2','-std=c11','-I',str(include),str(ROOT/f'runtime/mods/{name}.c'),'-o',str(mods/f'{name}.mgm.dylib')],check=True)
 app=ROOT/'build/native/OpenSmash Melee.app';module=app/'Contents/MacOS/game-module.dylib'
 env=dict(os.environ,OPENSMASH_FIXED_WINDOW='1',OPENSMASH_MATCH='1',OPENSMASH_NATIVE_MODULE=str(module),OPENSMASH_PORT0=str(fighter),OPENSMASH_PORT1=str(fighter|(1<<16)),OPENSMASH_STAGE='31')
 command=[str(app/'Contents/Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner'),'--game',str(game),'--module',str(module),'--user-dir',str(user),'--title','Experimental retarget smoke test','--graphics','Metal','--audio','Null','--mods',str(mods)]
 with (out/'game.log').open('w') as log:
  proc=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,env=env);pipe=os.open(user/'Pipes/opensmash',os.O_RDWR|os.O_NONBLOCK)
  try:
   deadline=time.monotonic()+180;step=0;captures=set()
   while proc.poll() is None and time.monotonic()<deadline:
    text=(out/'game.log').read_text()
    if 'guest assert' in text:raise RuntimeError('Guest assertion')
    marks=re.findall(r'\[probe-frame\] (\d+)',text);frame=int(marks[-1]) if marks else 0
    # Confirm startup, then move briefly to expose partner following.
    packet=(b'PRESS A\n' if not frame and step%4==0 else b'RELEASE A\n')+(b'SET MAIN 1 0.5\n' if 240<=frame<300 else b'SET MAIN 0.5 0.5\n')
    try:os.write(pipe,packet)
    except BlockingIOError:pass
    step+=1;images=sorted((user/'Dump/Frames').glob('*.png'),key=lambda p:int(p.stem.split('_')[-1]))
    for mark in [180,300,420]:
     if frame>=mark and mark not in captures and len(images)>2:shutil.copy2(images[-2],out/f'frame-{mark}.png');captures.add(mark)
    if frame>=420 and len(captures)==3:
     actors=re.findall(r'\[probe-actor\] frame=(\d+) port=(\d+) kind=(\d+) actor=([0-9a-f]+) motion=(\d+) x=([-0-9.]+) y=([-0-9.]+)',text)
     (out/'actors.json').write_text(json.dumps(actors,indent=2));print(slug,'captured',sorted(set((r[1],r[2],r[3]) for r in actors)),flush=True);return
    time.sleep(.25)
   raise RuntimeError(f'{slug}: did not reach capture; exit={proc.poll()}')
  finally:
   os.close(pipe);proc.terminate()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
   shutil.rmtree(user/'Dump/Frames',ignore_errors=True)
if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--case',choices=['pikachu','ice-climbers','kirby','jigglypuff']);ap.add_argument('--output',type=Path,default=ROOT/'build/retarget-roster-probe/native');a=ap.parse_args()
 for case in [('pikachu',13,[('pikachu','Pk')]),('ice-climbers',14,[('popo','Pp'),('nana','Nn')]),('kirby',4,[('kirby','Kb')]),('jigglypuff',15,[('jigglypuff','Pr')])]:
  if not a.case or a.case==case[0]:run(*case,a.output.resolve())
