#!/usr/bin/env python3
"""Compose native captures and measured results; never change generated attacks."""
import argparse,json,subprocess,shutil
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('site',type=Path);args=p.parse_args()
root=args.run;site=args.site;public=site/'public';media=public/'clips/format-comparison';media.mkdir(parents=True,exist_ok=True)
files=public/'comparison-data';files.mkdir(parents=True,exist_ok=True)
input=json.loads((root/'input.json').read_text());brief=input['brief']
(files/'descriptions.json').write_text(json.dumps(brief,indent=2))
ids=['gpt-6-astra-full','gpt-6-astra-reduced','gpt-5.6-luna-full','gpt-5.6-luna-reduced','original-full']
runs=[];raw=[]
def read_validation(d):
 q=d/'comparison-report.json'
 if not q.exists():q=d/'report.json'
 return json.loads(q.read_text()) if q.exists() else None
for id in ids:
 d=root/id;r=json.loads((d/'result.json').read_text());v=read_validation(d/'validation')
 label=('Earlier full-set attempt · Astra' if id=='original-full' else ('Astra' if 'astra' in id else 'Luna')+' · '+r['format'])
 checks=sum(bool(s.get('passed')) for c in v['contexts'] for s in c['scenarios']) if v else 0
 failure='; '.join(f"slot {c['slot']}: {name}" for c in v['contexts'] for z in c['scenarios'] for name,ok in z.get('checks',{}).items() if not ok) if v else None
 status=(f'{checks}/18 passed' if v and v['status']=='ready' else f'{checks}/18; failed' if v else 'Compiler rejected' if r['status']=='failed' else 'Running')
 u=r.get('provenance',{}).get('usage',{})
 runs.append(dict(id=id,label=label,outputTokens=u.get('output_tokens'),reasoningTokens=u.get('output_tokens_details',{}).get('reasoning_tokens'),generationMs=r.get('generationMs'),estimatedUsd=r.get('estimatedUsd'),validationLabel=status,error=r.get('error') or (v or {}).get('error') or failure))
 raw.append(dict(**r,nativeValidation=v))
 shutil.copyfile(d/'response.json',files/f'{id}.json')
 report=dict(protocol='Frozen descriptions; one first-pass sequential Standard request per cell; no judges or repairs. Historical full reference is separate.',runs=raw)
(files/'report.json').write_text(json.dumps(report,indent=2))
correction=read_validation(root/'luna-reduced-launch-fix/validation')
fixed=bool(correction and correction['status']=='ready')
clips=[]
left=root/'original-full/validation';right=root/('luna-reduced-launch-fix/validation' if fixed else 'gpt-5.6-luna-reduced/validation')
font='/System/Library/Fonts/Supplemental/Arial.ttf'
header=Image.new('RGB',(1280,48),'#101720');draw=ImageDraw.Draw(header);face=ImageFont.truetype(font,23)
draw.text((20,8),'Original full - Astra',font=face,fill='white');draw.text((660,8),'Reduced - Luna',font=face,fill='#f3ce78')
headerpath=media/'labels.png';header.save(headerpath)
for slot,m in enumerate(brief['moves']):
 # Fixture descriptions are not required to be in slot order.
 slotname=['neutral-ground','up-ground','down-ground','neutral-air','up-air','down-air'][slot]
 m=next(x for x in brief['moves'] if x['slot']==slotname)
 suffix='-fixed' if fixed and slot==4 else ''
 out=media/f'{slotname}{suffix}-close.mp4';src=None;poster=None
 if (left/f'slot-{slot}.mp4').exists() and (right/f'slot-{slot}.mp4').exists():
  if not out.exists() or out.stat().st_size==0:
   filt='[0:v]crop=640:720:0:0[l];[1:v]crop=640:720:0:0[r];[l][r]hstack=inputs=2[pair];[2:v][pair]vstack=inputs=2[v]'
   subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(left/f'slot-{slot}.mp4'),'-i',str(right/f'slot-{slot}.mp4'),'-loop','1','-framerate','60','-i',str(headerpath),'-filter_complex',filt,'-map','[v]','-frames:v','180','-c:v','libx264','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(out)],check=True)
   subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',str((15+m['startup'])/60),'-i',str(out),'-frames:v','1',str(out.with_suffix('.jpg'))],check=True)
   out.with_suffix('.vtt').write_text('WEBVTT\n\n00:00.000 --> 00:03.000\nLeft: earlier full implementation, Astra. Right: reduced implementation, Luna. Out-of-range animation preview.\n')
  src=f'/clips/format-comparison/{out.name}';poster=src.replace('.mp4','.jpg')
  for label,d in [('original',left),('reduced',right)]:shutil.copyfile(d/f'slot-{slot}.mp4',media/f'{slotname}-{label}{suffix if label=="reduced" else ""}.mp4')
  if slot==4:shutil.copyfile(root/'gpt-5.6-luna-reduced/validation/slot-4.mp4',media/'up-air-first-pass.mp4')
 evidence=[]
 for label,d in [('Original',left),('Reduced',right)]:
  if read_validation(d):
   v=read_validation(d);c=next((x for x in v['contexts'] if x['slot']==slot),None)
   if c:
    hit=next((s for s in c['scenarios'] if s['scenario']=='probe'),None)
    if hit:evidence.append(f"{label} contact probe: {hit['damage']}% damage")
    for z in c['scenarios']:
     if not z['passed'] and 'rise' in z:evidence.append(f"FAILED {label.lower()} recovery: {z['rise']:.0f} units of rise; must exceed {z['requiredRise']}")
 clips.append(dict(slot=slot,title=m['name'],description=slotname.replace('-',' · '),src=src,poster=poster,originalSrc=f'/clips/format-comparison/{slotname}-original.mp4' if src else None,firstPassSrc='/clips/format-comparison/up-air-first-pass.mp4' if slot==4 and src else None,reducedSrc=f'/clips/format-comparison/{slotname}-reduced{suffix}.mp4' if src else None,unavailable='Capture is not available yet.',evidence=' · '.join(evidence)+'. Videos show misses to keep the full movement unobstructed; damage is measured in separate native contact checks.'))
summary='Luna used 33% fewer output tokens in the reduced format; Astra used 22% fewer. Only Luna/reduced compiled on this fresh trial. Luna/reduced then failed the native air-recovery check. No fresh attempt qualified as a complete set. The videos include that failed recovery, without repairs.'
if fixed:
 summary+=' A compiler-only correction now launches air up immediately; its three scenarios were rerun successfully. The other fifteen scenarios reuse evidence from byte-identical moves.'
 (files/'compiler-correction.json').write_text(json.dumps(dict(change=json.loads((root/'luna-reduced-launch-fix/change.json').read_text()),validation=correction),indent=2))
 report['compilerCorrection']=correction
 (files/'report.json').write_text(json.dumps(report,indent=2))
data=dict(runs=runs,summary=summary,corrected=fixed,groups=[dict(id='clips',label='Earlier full-set attempt vs reduced Luna (both below target)',note=('The reduced side includes the compiler correction to air-up launch timing. All other moves are unchanged. ' if fixed else '')+'Synchronized at normal speed, with identical crops for a closer view. Full-stage originals are linked below each clip. Same descriptions, bundle and capture window.',clips=clips)])
(site/'app/format-comparison/results.json').write_text(json.dumps(data,indent=2))
print(json.dumps({'clips':sum(bool(c['src']) for c in clips),'runs':runs}))
