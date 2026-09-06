#!/usr/bin/env python3
"""Exact RGBA comparison of matching fixed-tick captures in two run folders."""
import argparse,json,pathlib
import numpy as np
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('control',type=pathlib.Path);p.add_argument('candidate',type=pathlib.Path);p.add_argument('--output',required=True,type=pathlib.Path)
a=p.parse_args();a.output.parent.mkdir(parents=True,exist_ok=True)
rows=[]
for before in sorted(a.control.glob('*-tick*.png')):
 after=a.candidate/before.name
 if not after.exists():raise SystemExit(f'Missing candidate: {after}')
 x=np.array(Image.open(before).convert('RGBA'));y=np.array(Image.open(after).convert('RGBA'))
 if x.shape!=y.shape:raise SystemExit(f'Size mismatch: {before.name}: {x.shape} vs {y.shape}')
 if np.count_nonzero(np.any(x[:,:,:3]!=0,axis=2))<100 or np.count_nonzero(np.any(y[:,:,:3]!=0,axis=2))<100:
  raise SystemExit(f'Invalid blank capture: {before.name}')
 delta=np.abs(x.astype(np.int16)-y.astype(np.int16));mask=np.any(delta!=0,axis=2)
 row={'frame':before.name,'changedPixels':int(mask.sum()),'totalPixels':int(mask.size),'maxChannelDifference':int(delta.max()),'meanChannelDifference':float(delta.mean())}
 if mask.any():
  yy,xx=np.where(mask);row['bounds']=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  diff=a.output.parent/(a.output.stem+'-'+before.name)
  Image.fromarray(np.minimum(delta[:,:,:3]*8,255).astype(np.uint8)).save(diff);row['diffImage']=str(diff)
 rows.append(row)
if not rows:raise SystemExit('No fixed-tick captures found')
report={'control':str(a.control),'candidate':str(a.candidate),'comparisons':len(rows),'exactMatches':sum(r['changedPixels']==0 for r in rows),'frames':rows}
a.output.write_text(json.dumps(report,indent=2)+'\n')
print(f"{report['exactMatches']}/{len(rows)} frames exactly match (RGBA)")
for r in rows:
 if r['changedPixels']:print(r)
raise SystemExit(0 if report['exactMatches']==len(rows) else 1)
