#!/usr/bin/env python3
"""Finish a failed first-pass suite for comparison; preserve its original report.
Reuses completed native logs, runs missing scenarios, records every failure, and
encodes even mechanically failed captures. Never marks such a set ready.
"""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('engine',type=Path);p.add_argument('bundle',type=Path);a=p.parse_args()
v=a.run/'validation';packet=json.loads((a.run/'package.json').read_text());original=json.loads((v/'report.json').read_text())
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert digest(a.run/'package.json')==original['packageFileHash']
assert digest(a.bundle)==original['bundleHash']
assert digest(a.engine/'build/BattleShip')==original['binaryHash']
report={k:original[k] for k in ['packageFileHash','bundleHash','binaryHash']}
report.update(reusedSlots=original.get('reusedSlots',[]),reusedPackageFileHash=original.get('reusedPackageFileHash'),status='failed',runtimeValidated=False,judges=0,contexts=[],method='Completed all scenarios after fail-fast report; reused existing finished logs. No attack repairs or regeneration.')
for m in packet['sets'][0]['moves']:
 slot=m['slot'];c=dict(slot=slot,scenarios=[]);report['contexts'].append(c)
 for scenario in ['probe','miss','wavecancel']:
  out=v/f'slot-{slot}'/scenario;logfile=out/scenario/'game.log';reused=logfile.exists()
  if not reused:
   cmd=['python3',str(a.engine/'experiments/custom-attacks/run.py'),'--move',str((a.run/'package.json').resolve()),'--bundle',str(a.bundle.resolve()),'--fkind',str(m['fkind']),'--slot',str(slot),'--test',scenario,'--output',str(out.resolve()),'--name',packet['character']['name'],'--short','WEIRD AL']
   if scenario=='miss':cmd.append('--capture')
   subprocess.run(cmd,env=dict(os.environ,SSB64_CUSTOM_MOVE_CANCEL_TICK='121'),check=True,stdout=subprocess.DEVNULL,timeout=110)
  log=logfile.read_text(errors='replace');rows=[s.split(',') for s in log.splitlines() if s.startswith('CM_TEST,')];actor=[r for r in rows if r[3]=='0'];target=[r for r in rows if r[3]=='1'];damage=max(int(r[5]) for r in target)
  checks={'enteredOnce':log.count('CUSTOM_MOVE begin')==1,'cleanedOnce':log.count('CUSTOM_MOVE end')==1,'hitboxesCleared':all(int(r[12])==0 for r in actor[-10:])}
  if scenario=='probe':checks.update(contactDamage=damage>0,hitReaction=any(int(r[6])>0 or int(r[7])>0 for r in target))
  if scenario=='miss':checks['noOutOfRangeDamage']=damage==0
  if scenario=='wavecancel':checks['windupInterrupted']='CUSTOM_MOVE active' not in log
  record=dict(scenario=scenario,damage=damage,checks=checks,reusedLog=reused,sourcePackageFileHash=original.get('reusedPackageFileHash') if slot in original.get('reusedSlots',[]) else original['packageFileHash'])
  if slot%3==1 and scenario=='miss':
   initial=1100 if slot>=3 else 0;top=max(float(r[9]) for r in actor);record.update(initialY=initial,maximumY=top,rise=top-initial,requiredRise=350)
   checks.update(recoveryRise=top>initial+350,exhaustedFall=any(int(r[4])==58 for r in actor))
  record['passed']=all(checks.values());c['scenarios'].append(record)
  if scenario=='miss':
   frames=out/scenario/'frames';assert all((frames/f'frame_{i}.png').exists() for i in range(500,680))
   clip=v/f'slot-{slot}.mp4'
   if not clip.exists():subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate','60','-start_number','500','-i',str(frames/'frame_%d.png'),'-frames:v','180','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',str(clip)],check=True)
   c['preview']=str(clip.resolve())
  print(json.dumps(dict(slot=slot,**record)),flush=True)
 c['passed']=all(s['passed'] for s in c['scenarios'])
 (v/'comparison-report.json').write_text(json.dumps(report,indent=2))
report['status']='ready' if all(c['passed'] for c in report['contexts']) else 'failed';report['runtimeValidated']=report['status']=='ready'
(v/'comparison-report.json').write_text(json.dumps(report,indent=2))
