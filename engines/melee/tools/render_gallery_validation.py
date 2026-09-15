"""Render shipped gallery geometry and baked HSD poses with the CPU oracle."""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tools.validate_shape import render
SITE=ROOT.parent/'opensmash-melee-gallery/public';OUT=ROOT/'build/gallery/review';OUT.mkdir(exist_ok=True)
catalog={r['slug']:r for r in json.loads((SITE/'catalog.json').read_text())}
dtype=np.dtype([('position','<f4',(3,)),('uv','<f4',(2,)),('joints','u1',(4,)),('weights','<f4',(4,))])
slugs=['alanturing','stevejobs','rowanatkinson','countdracula','alfredhitchcock','barackobama']
size=300;sheet=Image.new('RGB',(size*5,(size+38)*6),(25,19,14));draw=ImageDraw.Draw(sheet)
for row,slug in enumerate(slugs):
 f=catalog[slug];raw=(SITE/f'models/{slug}.bin').read_bytes();v=np.frombuffer(raw,dtype=dtype,count=f['vertices'],offset=16);indices=np.frombuffer(raw,dtype='<u4',offset=16+40*f['vertices']).reshape(-1,3)
 meta=json.loads((SITE/f"motion/{f['target']}.json").read_text());poses=np.frombuffer((SITE/f"motion/{f['target']}.bin").read_bytes(),dtype='<f4');p=np.c_[v['position'],np.ones(len(v))]
 extent=max(np.ptp(v['position'],axis=0))*1.45;cy=(f['bounds'][0][1]+f['bounds'][1][1])/2
 for col,name in enumerate(['bind','idle','run','jab','aerial']):
  if name=='bind':positions=v['position']
  else:
   clip=next(c for c in meta['clips'] if c['id']==name);frame=min(10,clip['frames']-1);offset=clip['offset']+frame*meta['palette']*16
   matrices=poses[offset:offset+meta['palette']*16].reshape(-1,4,4).transpose(0,2,1)
   positions=np.zeros((len(v),3))
   for k in range(4):positions+=np.einsum('nij,nj->ni',matrices[v['joints'][:,k]],p)[:,:3]*v['weights'][:,k,None]
  mesh=dict(positions=positions,uv=v['uv'],triangles=indices,image=Image.open(SITE/f'models/{slug}.webp'))
  im=render(mesh,[2**-.5,0,-2**-.5],[0,1,0],extent,[0,cy],size);im.save(OUT/f'{slug}-{name}.png')
  sheet.paste(im,(col*size,row*(size+38)+38));draw.text((col*size+6,row*(size+38)+7),f"{f['name']} / {f['target']} / {name}",fill='white')
 print(slug,flush=True)
sheet.save(OUT/'all-targets.png')
