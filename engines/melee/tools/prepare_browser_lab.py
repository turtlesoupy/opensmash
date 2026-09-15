"""Prepare a local animation lab from independently decoded custom DAT meshes."""
import base64, json, shutil, sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests'),str(ROOT/'tools')]
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from test_pipeline import decode_vertices
from validate_shape import decode_texture
OUT=ROOT/'build/browser-port/lab'
OUT.mkdir(parents=True,exist_ok=True)
for path in (ROOT/'browser-port/web').iterdir():
    if path.is_file():shutil.copy2(path,OUT/path.name)
for file in ('melee-animation.wasm','mario-local.json'):
    shutil.copy2(ROOT/'build/browser-port/runtime'/file,OUT/file)
characters=[]
for slug in ('rowanatkinson','stevejobs','countdracula'):
    a=Archive.read(ROOT/f'build/shape-validation/{slug}/PlMrNr.dat')
    skeleton=joints(a,'PlyMario5K_Share_joint')
    tris,_=decode_vertices(a,a.ptr(skeleton[0]['dobj']+12));vertices=[v for tri in tris for v in tri]
    lookup={j['offset']:j['index'] for j in skeleton}
    interleaved=[]
    for pos,normal,uv,env in vertices:
        combined={}
        for offset,w in env:
            j=lookup[offset];combined[j]=combined.get(j,0)+w
        if len(combined)>4:raise ValueError('Four-weight renderer limit exceeded')
        influences=list(combined.items())+[(0,0)]*(4-len(combined))
        interleaved.extend([*pos,*uv,*[j for j,w in influences],*[w for j,w in influences]])
    raw=np.asarray(interleaved,dtype='<f4').tobytes()
    (OUT/f'{slug}.bin').write_bytes(raw)
    decode_texture(a,skeleton[0]['dobj']).save(OUT/f'{slug}.png')
    characters.append(dict(slug=slug,vertices=len(vertices),mesh=f'{slug}.bin',texture=f'{slug}.png'))
(OUT/'characters.json').write_text(json.dumps(characters,indent=2)+'\n')
print(OUT)
