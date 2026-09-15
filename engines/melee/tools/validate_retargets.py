"""Capture matched retarget poses, or exercise real attacks and stock loss."""
import argparse, configparser, json, os, re, shutil, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.launch_moderngekko import configure_user

def capture(app,out,slug,fighter,action=False,original_neutral=False):
    resources=app/'Contents/Resources'
    build=json.loads((resources/'build.json').read_text())
    character=next(c for c in build['characters'] if c['slug']==slug)
    variant=next(c for c in [character]+character.get('targets',[]) if c['fighter']==fighter)
    out.mkdir(parents=True)
    game=out/'game';shutil.copytree(ROOT/'assets/game',game,copy_function=os.link)
    costume=variant['costumes'][0];dest=game/'files'/costume['filename'];dest.unlink();shutil.copy2(resources/costume['path'],dest)
    if original_neutral:
        from opensmash_melee.costume_variant import costume_variant, SCHEMA
        partner=game/'files'/SCHEMA['costumes'][str(fighter)][1]['filename']
        partner.unlink()
        partner.write_bytes(costume_variant((ROOT/'assets/game/files'/costume['filename']).read_bytes(),fighter,1))
    user=out/'user';configure_user(user,pipe=True)
    saved=ROOT/'build/native-target-smoke/user/SmokeUser/GC'
    if saved.is_dir():shutil.copytree(saved,user/'GC')
    (user/'config.ini').write_text('[Video]\nresolution=1280x1056\nbackend=Metal\nfullscreen=false\nshow_fps_in_title=true\n[Input]\ncontroller=Pipe/0/opensmash\n')
    config=configparser.ConfigParser();config.optionxform=str;ini=user/'Config/Dolphin.ini';config.read(ini)
    config['Core']['FastDiscSpeed']='True'
    config['Movie']={'DumpFrames':'True','DumpFramesSilent':'True'}
    with ini.open('w') as stream:config.write(stream)
    (user/'Config/GFX.ini').write_text('[Settings]\nInternalResolution = 1\nDumpFramesAsImages = True\nPNGCompressionLevel = 1\n')
    mods=out/'mods';mods.mkdir();include=ROOT/'build/browser-engine/meleepad/ref/ModernGekko/include'
    for name in ['launch_match','validate_retargets']:
        subprocess.run(['clang','-dynamiclib','-O2','-std=c11','-I',str(include),str(ROOT/f'runtime/mods/{name}.c'),'-o',str(mods/f'{name}.mgm.dylib')],check=True)
    module=app/'Contents/MacOS/game-module.dylib'
    command=[str(app/'Contents/Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner'),'--game',str(game),'--module',str(module),'--user-dir',str(user),'--title','Retarget validation','--graphics','Metal','--audio','Null','--mods',str(mods)]
    env=dict(os.environ,OPENSMASH_FIXED_WINDOW='1',OPENSMASH_MATCH='1',OPENSMASH_NATIVE_MODULE=str(module),OPENSMASH_PORT0=str(fighter),OPENSMASH_PORT1=str(fighter|(1<<16)),OPENSMASH_STAGE='32')
    if action:env['OPENSMASH_VALIDATE_ACTION']='1'
    with (out/'game.log').open('w') as log:
        proc=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,env=env)
        pipe=os.open(user/'Pipes/opensmash',os.O_RDWR|os.O_NONBLOCK)
        last_packet=None
        def send(packet):
            nonlocal last_packet
            if packet==last_packet:return
            try:os.write(pipe,packet)
            except BlockingIOError:return
            last_packet=packet
        try:
            deadline=time.monotonic()+180;step=0;captured=set()
            while proc.poll() is None and time.monotonic()<deadline:
                text=(out/'game.log').read_text()
                if 'guest assert' in text:raise RuntimeError('Guest asserted')
                if not action or '[opensmash] launch fighter=' not in text:
                    send(b'PRESS A\n' if '[opensmash] launch fighter=' not in text and step%4==0 else b'RELEASE A\n')
                step+=1
                frames=sorted((user/'Dump/Frames').glob('*.png'),key=lambda p:int(p.stem.split('_')[-1]))
                poses=re.findall(r'\[retarget\] port=(\d) frame=(\d+) motion=(\d+) anim_bits=([0-9a-f]+)',text)
                if action and len(frames)>2:
                    states=re.findall(r'\[action\] port=(\d) frame=(\d+) motion=(\d+) damage=([0-9.]+) stocks=(\d+)',text)
                    latest=max([int(row[1]) for row in states],default=0)
                    buttons = {'A': 300 <= latest < 390 and latest % 30 < 15 or 640 <= latest < 660, 'B': 450 <= latest < 630, 'L': 780 <= latest < 880}
                    commands = [('PRESS ' if down else 'RELEASE ') + button for button, down in buttons.items()]
                    commands.append('SET MAIN 1 0.5' if 640 <= latest < 660 else 'SET MAIN 0.5 0.5')
                    send(('\n'.join(commands) + '\n').encode())
                    for mark in [270,330,450,570,660,840,930,1140]:
                        if latest>=mark and mark not in captured:
                            shutil.copy2(frames[-2],out/f'action-{mark}.png');captured.add(mark)
                    if latest>=1140:
                        assert any(float(row[3])>0 for row in states), 'No combat damage observed'
                        assert any(row[0]=='0' and int(row[4])<4 for row in states), 'No stock loss observed'
                        (out/'actions.json').write_text(json.dumps(states,indent=2))
                        print(out/'actions.json',flush=True);return
                    time.sleep(.25);continue

                if len(frames)>2 and all(any(p==str(port) and int(f)>=420 and m=='14' for p,f,m,a in poses) for port in (0,1)):
                    shutil.copy2(frames[-2],out/'capture.png')
                    (out/'capture.json').write_text(json.dumps(dict(character=slug,target=fighter,poses=poses,stature=variant.get('stature'),camera=dict(eye=[0,12,68],interest=[0,11,0],fov=35)),indent=2))
                    print(out/'capture.png',flush=True);return
                time.sleep(.25)
            raise RuntimeError('Capture did not reach both idle poses')
        finally:
            os.close(pipe);proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--app',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--character',default='abrahamlincoln');p.add_argument('--action',action='store_true');p.add_argument('--original-neutral',action='store_true');p.add_argument('--targets',type=int,nargs='+',default=[0,2,6,7,8,9]);a=p.parse_args()
    for fighter in a.targets:capture(a.app.resolve(),a.output.resolve()/str(fighter),a.character,fighter,a.action,a.original_neutral)
