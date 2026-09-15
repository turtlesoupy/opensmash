"""Build every assigned custom mesh for the Melee roster gallery."""
from pathlib import Path
import concurrent.futures, hashlib, json, sys, struct, time
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.glb import GLB
from opensmash_melee.multi_fighter import load_target,fit,TARGETS
from opensmash_melee.retarget import conform
from tools.validate_shape import shape_metrics
from tools.extract_browser_animations import extract
OUT=ROOT/'build/gallery/export';OUT.mkdir(parents=True,exist_ok=True);(OUT/'models').mkdir(exist_ok=True);(OUT/'motion').mkdir(exist_ok=True)
SITE=ROOT.parent/'opensmash-melee-gallery'
CATALOG=json.loads((SITE/'public/catalog.json').read_text())
TARGET_DATA={slug:load_target(ROOT/'assets/game/files',slug) for slug in TARGETS}
for slug,t in TARGET_DATA.items():
    t['palette']=sorted(set(t['mapping'].values()))
    animations=extract((ROOT/f"assets/game/files/Pl{t['code']}AJ.dat").read_bytes())
    wanted=['Wait' if slug=='link' else 'Wait1','Run','AttackAirF','Attack11']
    t['animations']=[next(a for a in animations if a['name'].endswith('ACTION_'+name+'_figatree')) for name in wanted]
    (ROOT/f'build/gallery/{slug}.json').write_text(json.dumps(t,separators=(',',':')))

def one(row):
    path=ROOT.parents[1]/'play/ui'/row['slug']/'rigged.glb'
    try:
        m=GLB(path).mesh();t=TARGET_DATA[row['target']];p=fit(m,t);c=conform(m,t['skeleton'],p)
        lookup={joint:i for i,joint in enumerate(t['palette'])}
        # Float positions/UVs/weights are retained. Joint ids use bytes, no dominant-bone simplification.
        n=len(c['positions']);indices=np.asarray(c['triangles'],dtype='<u4').reshape(-1)
        dtype=np.dtype([('position','<f4',(3,)),('uv','<f4',(2,)),('joints','u1',(4,)),('weights','<f4',(4,))])
        vertices=np.zeros(n,dtype=dtype);vertices['position']=c['positions'];vertices['uv']=c['uv']
        for i,env in enumerate(c['envelopes']):
            if len(env)>4:raise ValueError('More than four blended target joints')
            for k,(joint,w) in enumerate(env):vertices['joints'][i,k]=lookup[joint];vertices['weights'][i,k]=w
        if not np.isfinite(vertices['position']).all():raise ValueError('Non-finite mesh')
        if not np.allclose(vertices['weights'].sum(axis=1),1,atol=2e-6):raise ValueError('Weights do not sum to one')
        if np.max(indices)>=n:raise ValueError('Invalid mesh index')
        raw=struct.pack('<4sIII',b'OSMG',1,n,len(indices))+vertices.tobytes()+indices.tobytes()
        # Independent layout read-back guards buffer stride, offset and index errors.
        roundtrip=np.frombuffer(raw,dtype=dtype,count=n,offset=16)
        np.testing.assert_allclose(roundtrip['position'],c['positions'],atol=2e-6)
        np.testing.assert_array_equal(np.frombuffer(raw,dtype='<u4',offset=16+n*40),indices)
        (OUT/'models'/f"{row['slug']}.bin").write_bytes(raw)
        image=c['image'].convert('RGBA').resize((256,256),Image.Resampling.LANCZOS)
        image.save(OUT/'models'/f"{row['slug']}.webp",quality=87,method=4)
        try:
            metrics=shape_metrics(m,c,p,t['skeleton'])
            shape_ok=metrics['head_anisotropy']<=1.03 and metrics['similarity_max_relative_error']<=.025 and metrics['head_fraction_relative_error']<=.05
        except ValueError as error:metrics={'reason':str(error)};shape_ok=False
        return dict(row,vertices=n,triangles=len(indices)//3,palette=len(t['palette']),bounds=[c['positions'].min(axis=0).tolist(),c['positions'].max(axis=0).tolist()],review=not shape_ok,metrics=metrics,mesh_sha256=hashlib.sha256(raw).hexdigest(),source_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    except Exception as error:return dict(row,error=str(error))

start=time.monotonic();rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    for row in pool.map(one,CATALOG):
        rows.append(row)
        if len(rows)%100==0:print(f'{len(rows)}/{len(CATALOG)} prepared',flush=True)
report=dict(total=len(rows),built=sum('error' not in r for r in rows),review=sum(r.get('review',False) for r in rows),failed=[r for r in rows if 'error' in r],elapsed_seconds=time.monotonic()-start,characters=rows)
(ROOT/'build/gallery/model-validation.json').write_text(json.dumps(report,indent=2)+'\n')
(OUT/'catalog.json').write_text(json.dumps([{k:v for k,v in r.items() if k not in ['metrics','source_sha256','mesh_sha256']} for r in rows],separators=(',',':')))
print(json.dumps({k:v for k,v in report.items() if k!='characters'},indent=2))
if report['failed']:raise SystemExit(1)
