"""Audit all local generator outputs against the real Mario fit (not gameplay)."""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import json
from pathlib import Path
import sys
import time
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.glb import GLB
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.retarget import conform
from opensmash_melee.__main__ import dump,digest
from tools.fit_mario_profile import fit


def audit(args):
    path,costume=args[:2]
    export=len(args)>2 and args[2]
    try:
        m=GLB(path/'rigged.glb').mesh();p=fit(path,costume)
        s=joints(Archive.read(costume),p['symbol']);c=conform(m,s,p)
        # End-to-end head aspect oracle: apply the effective affine map to
        # three orthogonal unit vectors, not the profile's diagnostic values.
        i=m['names'].index('Head');j=p['joint_map']['Head']
        matrix=np.linalg.inv(s[j]['inverse_bind'])@np.array(p['bone_corrections']['Head'])@np.linalg.inv(m['bind'][i])
        singular=np.linalg.svd(matrix[:3,:3],compute_uv=False)
        anisotropy=float(max(singular)/min(singular))
        scales=p['fit_scales']['Head']
        expected=sorted([scales['length'],scales['width'],scales['width']])
        np.testing.assert_allclose(sorted(singular),expected,rtol=1e-5,atol=1e-5)
        if np.linalg.det(matrix[:3,:3])<=0:raise ValueError('Head transform reflects geometry')
        from tools.validate_shape import shape_metrics
        shape=shape_metrics(m,c,p,s)
        if shape['head_anisotropy']>1.03 or shape['similarity_max_relative_error']>.025:
            raise ValueError('Authored head shape was distorted: '+str(shape))
        if shape['head_fraction_relative_error']>.05:
            raise ValueError('Authored head/body ratio changed: '+str(shape))
        widths=np.ptp(c['positions'],axis=0)
        if not np.isfinite(widths).all() or min(widths)<=0:raise ValueError('Invalid fitted bounds')
        totals=np.array([sum(w for _,w in env) for env in c['envelopes']])
        if not np.allclose(totals,1,atol=1e-6):raise ValueError('Envelope weight loss')
        export_result={}
        if export:
            sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
            from test_pipeline import decode_vertices
            from opensmash_melee.gx import replace_costume,batches
            from PIL import Image
            archive=Archive.read(costume)
            c['image']=c['image'].resize((256,256),Image.Resampling.LANCZOS)
            export_result=replace_costume(archive,c,s,p)
            parsed=Archive(archive.serialize())
            triangles,used=decode_vertices(parsed,parsed.ptr(s[0]['dobj']+12))
            if len(triangles)!=len(c['triangles']):raise ValueError('Triangle loss in binary roundtrip')
            order=np.array([indices for _,tris in batches(c) for indices in tris]).reshape(-1)
            decoded=[v for triangle in triangles for v in triangle]
            np.testing.assert_allclose(np.array([v[0] for v in decoded]),c['positions'][order],atol=2e-5,rtol=1e-6)
            np.testing.assert_allclose(np.array([v[1] for v in decoded]),c['normals'][order],atol=1e-6)
            np.testing.assert_allclose(np.array([v[2] for v in decoded]),c['uv'][order],atol=1e-6)
            lookup={j['offset']:j['index'] for j in s};cache={}
            for index,vertex in zip(order,decoded):
                key=tuple(vertex[3])
                if key not in cache:
                    combined={}
                    for offset,weight in key:
                        joint=lookup[offset];combined[joint]=combined.get(joint,0)+weight
                    cache[key]=tuple(sorted(combined.items()))
                if cache[key]!=c['envelopes'][index]:raise ValueError('Binary envelope does not match fitted weights')
            export_result['binary_roundtrip_verified']=True
        return dict(shape=shape,export=export_result,character=path.name,status='compatible',source_sha256=digest(path/'rigged.glb'),vertices=len(m['positions']),triangles=len(m['triangles']),head_anisotropy=anisotropy,bounds=widths.tolist(),head_scale=p['fit_scales']['Head']['length'])
    except Exception as e:
        return dict(character=path.name,status='rejected',error=type(e).__name__+': '+str(e))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path)
    p.add_argument('--costume',type=Path,default=Path('assets/game/files/PlMrNr.dat'))
    p.add_argument('--out',type=Path,default=Path('build/character-audit.json'))
    p.add_argument('--export',action='store_true',help='Also encode/decode all triangles, UVs, normals and weights')
    p.add_argument('--workers',type=int,default=4);a=p.parse_args()
    files=sorted(a.source.glob('*/rigged.glb'));rows=[];start=time.monotonic()
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        futures=[pool.submit(audit,(f.parent,a.costume,a.export)) for f in files]
        for f in as_completed(futures):
            rows.append(f.result())
            if len(rows)%100==0:print(f'{len(rows)}/{len(files)} audited',flush=True)
    report=dict(scope=('GLB read, actual Mario fit, head aspect, normalized weights'+('; complete GX/HSD binary roundtrip' if a.export else '')+'; no gameplay certification'),fit_version=6,head_style='source',total=len(rows),compatible=sum(r['status']=='compatible' for r in rows),rejected=sum(r['status']=='rejected' for r in rows),elapsed_seconds=time.monotonic()-start,characters=sorted(rows,key=lambda r:r['character']))
    dump(a.out,report);print(json.dumps({k:v for k,v in report.items() if k!='characters'},indent=2))
