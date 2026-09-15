"""Separate source art, bind conformation, DAT export and real Melee idle skinning.

CPU rows use a shared diagnostic light, not simulated Melee lighting. The
separate native captures remain the authoritative check of the game's lighting.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from opensmash_melee.archive import Archive
from opensmash_melee.glb import GLB
from opensmash_melee.skeleton import joints
from opensmash_melee.retarget import conform
from opensmash_melee.gx import batches
from tools.validate_shape import render, decode_texture, ORIENTATION
from tests.test_pipeline import decode_vertices


def normalize(n):
    lengths = np.linalg.norm(n, axis=1)
    if np.any(lengths < 1e-10):
        raise ValueError('Degenerate diagnostic normal')
    return n / lengths[:, None]


def pose_mesh(mesh, worlds, inverse):
    """HSD blends envelope matrices, then inverse-transposes for normals."""
    points, normals = [], []
    cache = {}
    for p, n, env in zip(mesh['positions'], mesh['normals'], mesh['envelopes']):
        if env not in cache:
            matrix = sum(w * (worlds[j] @ inverse[j]) for j, w in env)
            cache[env] = matrix, np.linalg.inv(matrix[:3, :3]).T
        matrix, normal = cache[env]
        points.append((matrix @ np.r_[p, 1])[:3])
        normals.append(normal @ n)
    return dict(mesh, positions=np.array(points), normals=normalize(np.array(normals)))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--character', type=Path, required=True)
    ap.add_argument('--costume', type=Path, required=True)
    ap.add_argument('--profile', type=Path, required=True)
    ap.add_argument('--pose-log', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args();out = args.output;out.mkdir(parents=True, exist_ok=True)
    mesh = GLB(args.character).mesh()
    profile = json.loads(args.profile.read_text())
    archive = Archive.read(args.costume);skeleton = joints(archive, profile['symbol'])
    fitted = conform(mesh, skeleton, profile)
    d = skeleton[profile.get('mesh_joint', 0)]['dobj']
    triangles, _ = decode_vertices(archive, archive.ptr(d + 12))
    vertices = [v for t in triangles for v in t]
    lookup = {j['offset']:j['index'] for j in skeleton}
    decoded = dict(positions=np.array([v[0] for v in vertices]),
        normals=np.array([v[1] for v in vertices]),uv=np.array([v[2] for v in vertices]),
        envelopes=[tuple((lookup[j],w) for j,w in v[3]) for v in vertices],
        triangles=np.arange(len(vertices)).reshape(-1,3),image=decode_texture(archive,d))
    order = np.array([ids for _, tris in batches(fitted) for ids in tris]).reshape(-1)
    errors = {k:float(np.abs(decoded[k]-fitted[k][order]).max()) for k in ('positions','normals','uv')}
    if max(errors.values())>3e-5:raise ValueError(f'DAT roundtrip mismatch: {errors}')
    log=args.pose_log.read_text()
    states=re.findall(r'\[shading\] frame=(\d+) motion=(\d+) anim_bits=([0-9a-f]+)',log)
    if len(states)<2 or states[-1][1:]!=('14','00000000') or states[-2][1:]!=states[-1][1:]:
        raise ValueError('Require a verified held Melee idle frame 0')
    rows = [line.split()[1:] for line in log.splitlines() if line.startswith('[pose-joint]')]
    if len(rows)!=len(skeleton):raise ValueError(f'Runtime joint count {len(rows)} != archive {len(skeleton)}')
    worlds=[]
    for joint, row in zip(skeleton, rows):
        if int(row[0])!=joint['index'] or int(row[1])!=(joint['parent'] if joint['parent'] is not None else -1):
            raise ValueError('Runtime hierarchy does not match archived joint order')
        m=np.eye(4);m[:3]=np.array(row[3:],float).reshape(3,4);worlds.append(m)
    inverse=np.array([np.eye(4) if j['inverse_bind'] is None else j['inverse_bind'] for j in skeleton])
    # Normalize the captured fighter's root world placement/facing for shared views.
    remove_root=np.linalg.inv(worlds[0])
    worlds=np.array([remove_root@m for m in worlds])
    posed=pose_mesh(decoded,worlds,inverse)
    expected=pose_mesh(fitted,worlds,inverse)
    errors['animated_positions']=float(np.abs(posed['positions']-expected['positions'][order]).max())
    errors['animated_normals']=float(np.abs(posed['normals']-expected['normals'][order]).max())
    if max(errors.values())>5e-5:raise ValueError(f'Animated roundtrip mismatch: {errors}')
    scale=profile['fit_scales']['Head']['length']
    source=dict(mesh,positions=mesh['positions']@ORIENTATION.T*scale,normals=mesh['normals']@ORIENTATION.T)
    source['positions'][:,1]+=profile['head_reference']['fitted_body_ground']-mesh['positions'][:,1].min()*scale
    models=[('SOURCE T-POSE',source),('FITTED BIND',fitted),('DECODED DAT BIND',decoded),('MELEE IDLE FRAME 0',posed)]
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',18)
    size=440;gap=34
    right=np.array([.84,0,-.54]);up=np.array([0,1,0]);light=right*.35+up*.65+np.cross(right,up)*.7
    points=np.concatenate([m['positions'] for _,m in models]);proj=np.c_[points@right,points@up]
    extent=np.ptp(proj,axis=0).max()*1.04;center=(proj.min(axis=0)+proj.max(axis=0))/2
    sheet=Image.new('RGB',(size*4,(size+gap)*3+88),'#111419');draw=ImageDraw.Draw(sheet)
    for col,(label,m) in enumerate(models):
        draw.text((col*size+12,12),label,font=font,fill='white')
        for row,(mode,title) in enumerate([('texture','Texture only / no light'),('gray','Neutral gray / diagnostic light'),('lit','Texture + diagnostic light')]):
            y=48+row*(size+gap)
            draw.text((col*size+12,y),title,font=font,fill='#c8cbd0')
            im=render(m,right,up,extent,center,size,mode,light,'linear')
            im.save(out/f'{col}-{mode}.png');sheet.paste(im,(col*size,y+gap))
    draw.text((12,sheet.height-28),'Shared camera, scale and light. CPU diagnostic rows; last column uses captured Melee joint matrices.',font=font,fill='white')
    sheet.save(out/'comparison.png')
    # High-resolution detail views use one framing for all models in each region.
    for name,lo,hi in [('head',.62,1.01),('upper-body',.32,.74)]:
        ymin=source['positions'][:,1].min();height=np.ptp(source['positions'][:,1])
        bounds=[]
        for _,m in models:
            select=(m['positions'][:,1]>ymin+lo*height)&(m['positions'][:,1]<ymin+hi*height)
            bounds.append(m['positions'][select])
        p=np.concatenate(bounds);q=np.c_[p@right,p@up];ex=np.ptp(q,axis=0).max()*1.08;ce=(q.min(axis=0)+q.max(axis=0))/2
        detail=Image.new('RGB',(size*4,(size+gap)*2+40),'#111419');dd=ImageDraw.Draw(detail)
        for col,(label,m) in enumerate(models):
            dd.text((col*size+12,8),label,font=font,fill='white')
            for row,mode in enumerate(('texture','gray')):
                detail.paste(render(m,right,up,ex,ce,size,mode,light,'linear'),(col*size,40+row*(size+gap)))
        detail.save(out/f'{name}.png')
    metrics=dict(roundtrip_max_absolute_errors=errors,runtime_joint_count=len(worlds),
        source_vertices=len(mesh['positions']),source_triangles=len(mesh['triangles']),
        source_texture_size=mesh['image'].size,exported_texture_size=decoded['image'].size,
        inputs={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (args.character,args.costume,args.profile,args.pose_log)},
        light=light.tolist(),camera_right=right.tolist(),extent=float(extent),center=center.tolist(),
        warning='Diagnostic lighting is not GX. Animation matrices are from the native held idle pose.')
    (out/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    np.savez_compressed(out/'pose-matrices.npz',worlds=worlds,inverse_bind=inverse)
    print(json.dumps(metrics,indent=2))

if __name__=='__main__':main()
