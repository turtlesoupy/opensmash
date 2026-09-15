"""Isolated source/fit/GX shape comparison using shared orthographic cameras.

Inspired by OpenSmash texture_check.py and pose_compare.py. Renders actual
bind geometry, not gameplay poses. No per-panel auto-framing; no stage/HUD.
"""
import argparse, copy, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.glb import GLB
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.retarget import conform

ORIENTATION=np.array([[0,0,-1],[0,1,0],[1,0,0]],float)


from opensmash_melee.proportions import source_head_fit


def render(mesh,right,up,extent,center,size=480,mode='texture',light=(.4,.7,.6),texture_filter='nearest'):
    """Orthographic, double-sided textured rasterization with a real Z buffer."""
    right=np.asarray(right,float);up=np.asarray(up,float);forward=np.cross(right,up)
    points=mesh['positions'];xyz=np.column_stack((points@right,points@up,points@forward))
    scale=(size-32)/extent;xy=(xyz[:,:2]-np.asarray(center))*[scale,-scale]+size/2
    rgb=np.full((size,size,3),240,dtype=np.uint8);depth=np.full((size,size),-np.inf)
    texture=np.asarray(mesh['image'].convert('RGB'));th,tw=texture.shape[:2]
    if mode not in ('texture', 'lit', 'gray', 'normals'):
        raise ValueError('Unknown surface diagnostic mode')
    if mode != 'texture':
        normals=np.asarray(mesh['normals'],float)
        normals=normals/np.linalg.norm(normals,axis=1)[:,None]
        light=np.asarray(light,float);light/=np.linalg.norm(light)
        # Controlled diagnostic light, deliberately not an emulation of GX.
        brightness=.25+.75*np.maximum(normals@light,0)
    for tri in mesh['triangles']:
        p=xy[tri];lo=np.maximum(np.floor(p.min(axis=0)).astype(int),0);hi=np.minimum(np.ceil(p.max(axis=0)).astype(int),size-1)
        if np.any(lo>hi):continue
        x,y=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
        a,b,c=p;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-9:continue
        u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
        v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;w=1-u-v
        z=u*xyz[tri[0],2]+v*xyz[tri[1],2]+w*xyz[tri[2],2]
        sub=depth[lo[1]:hi[1]+1,lo[0]:hi[0]+1];visible=(u>=-1e-7)&(v>=-1e-7)&(w>=-1e-7)&(z>sub)
        if not visible.any():continue
        uv=u[...,None]*mesh['uv'][tri[0]]+v[...,None]*mesh['uv'][tri[1]]+w[...,None]*mesh['uv'][tri[2]]
        tx=np.clip((uv[:,:,0]*tw).astype(int),0,tw-1);ty=np.clip((uv[:,:,1]*th).astype(int),0,th-1)
        colors=texture[ty,tx].astype(float)
        if texture_filter=='linear':
            sx=np.clip(uv[:,:,0]*tw-.5,0,tw-1);sy=np.clip(uv[:,:,1]*th-.5,0,th-1)
            ix=sx.astype(int);iy=sy.astype(int);fx=(sx-ix)[...,None];fy=(sy-iy)[...,None]
            jx=np.minimum(ix+1,tw-1);jy=np.minimum(iy+1,th-1)
            colors=(texture[iy,ix]*(1-fx)+texture[iy,jx]*fx)*(1-fy)+(texture[jy,ix]*(1-fx)+texture[jy,jx]*fx)*fy
        elif texture_filter!='nearest':raise ValueError('Unknown texture filter')
        if mode in ('lit','gray'):
            shade=u*brightness[tri[0]]+v*brightness[tri[1]]+w*brightness[tri[2]]
            colors=(180 if mode=='gray' else colors)*shade[...,None]
            if colors.shape[-1]==1:colors=np.repeat(colors,3,axis=-1)
        elif mode=='normals':
            n=u[...,None]*normals[tri[0]]+v[...,None]*normals[tri[1]]+w[...,None]*normals[tri[2]]
            colors=(n+1)*127.5
        rgb[lo[1]:hi[1]+1,lo[0]:hi[0]+1][visible]=np.clip(colors[visible],0,255).astype(np.uint8);sub[visible]=z[visible]
    return Image.fromarray(rgb)


def decode_texture(archive,dobj):
    """Read the emitted HSD material and GX RGBA8 tiles independently."""
    material=archive.ptr(dobj+8);texture=archive.ptr(material+8);descriptor=archive.ptr(texture+76)
    width,height,fmt=archive.unpack('HHI',descriptor+4)
    if fmt!=6 or width%4 or height%4:raise ValueError('Unsupported validation texture')
    offset=archive.ptr(descriptor);pixels=np.zeros((height,width,4),dtype=np.uint8)
    for y in range(0,height,4):
        for x in range(0,width,4):
            tile=np.array(archive.unpack('64B',offset),dtype=np.uint8);offset+=64
            for k in range(16):pixels[y+k//4,x+k%4]=[tile[2*k+1],tile[32+2*k],tile[33+2*k],tile[2*k]]
    return Image.fromarray(pixels)


def shape_metrics(mesh,fitted,profile,skeleton):
    i=mesh['names'].index('Head');w=np.where(mesh['joints']==i,mesh['weights'],0).sum(axis=1);mask=w>.99
    src=mesh['positions'][mask];dst=fitted['positions'][mask]
    if len(src)<4:raise ValueError('Too few core head vertices')
    # Best similarity fit against actual weighted output, not profile scalars.
    x=src-src.mean(axis=0);y=dst-dst.mean(axis=0);u,_,vt=np.linalg.svd(x.T@y);r=u@vt
    scale=float(np.sum((x@r)*y)/np.sum(x*x));error=np.linalg.norm(y-scale*x@r,axis=1)
    affine=np.linalg.lstsq(np.c_[src,np.ones(len(src))],dst,rcond=None)[0][:3];singular=np.linalg.svd(affine,compute_uv=False)
    # Almost-planar samples amplify tiny contributions from other bones into
    # a spurious affine stretch. Check the head transform itself in that case;
    # the similarity residual above still checks the actual blended geometry.
    source_singular=np.linalg.svd(x,compute_uv=False)
    anisotropy_method='geometry'
    if source_singular[-1]<.02*source_singular[0] and not profile.get('ball_fit'):
        target=np.linalg.inv(skeleton[profile['joint_map']['Head']]['inverse_bind'])
        correction=np.asarray(profile.get('bone_corrections',{}).get('Head',np.eye(4)))
        scale=profile.get('bone_scale',1.)
        transform=target@correction@np.diag([scale,scale,scale,1])@np.linalg.inv(mesh['bind'][i])
        singular=np.linalg.svd(transform[:3,:3],compute_uv=False)
        anisotropy_method='head_transform'
    ratio_src=float(np.ptp(src[:,1])/np.ptp(mesh['positions'][:,1]));ratio_dst=float(np.ptp(dst[:,1])/np.ptp(fitted['positions'][:,1]))
    return dict(core_head_vertices=len(src),head_anisotropy=float(singular.max()/singular.min()),head_anisotropy_method=anisotropy_method,similarity_max_relative_error=float(error.max()/np.ptp(dst,axis=0).max()),source_head_height_fraction=ratio_src,fitted_head_height_fraction=ratio_dst,head_fraction_relative_error=abs(ratio_dst/ratio_src-1),head_size=np.ptp(dst,axis=0).tolist())


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('character',type=Path);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--costume',type=Path,default=Path('assets/game/files/PlMrNr.dat'));ap.add_argument('--turntable',action='store_true');ap.add_argument('--legacy-root',type=Path,default=Path('build'));a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    mesh=GLB(a.character/'rigged.glb').mesh();s=joints(Archive.read(a.costume),'PlyMario5K_Share_joint')
    from tools.fit_mario_profile import fit
    candidate=fit(a.character,a.costume,head_style='source')
    (a.out/'profile.json').write_text(json.dumps(candidate,indent=2)+'\n')
    scale=candidate['fit_scales']['Head']['length'];source=dict(mesh,positions=mesh['positions']@ORIENTATION.T*scale)
    source['positions'][:,1]+=candidate['head_reference']['fitted_body_ground']-mesh['positions'][:,1].min()*scale
    models=[('Original GLB / uniform display scale',source)];metrics={}
    for revision in (5,4):
        path=a.legacy_root/f'validation-v{revision}'/a.character.name/'profile.json'
        if path.exists():
            p=json.loads(path.read_text());c=conform(mesh,s,p);models.append((f'Revision {revision}',c));metrics[f'v{revision}']=shape_metrics(mesh,c,p,s)
    c=conform(mesh,s,candidate);models.append(('Source proportions / candidate',c));metrics['candidate']=shape_metrics(mesh,c,candidate,s)
    # Include independently decoded GX geometry, not another in-memory render.
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
    from test_pipeline import decode_vertices
    from opensmash_melee.gx import replace_costume
    texture_size=candidate.get('texture_size',256)
    archive=Archive.read(a.costume);replace_costume(archive,dict(c,image=c['image'].resize((texture_size,texture_size),Image.Resampling.LANCZOS)),s,candidate);raw=archive.serialize();(a.out/'PlMrNr.dat').write_bytes(raw);parsed=Archive(raw)
    triangles,_=decode_vertices(parsed,parsed.ptr(s[0]['dobj']+12));verts=[v for t in triangles for v in t]
    exported_texture=decode_texture(parsed,s[0]['dobj'])
    np.testing.assert_array_equal(np.asarray(exported_texture),np.asarray(c['image'].convert('RGBA').resize((texture_size,texture_size),Image.Resampling.LANCZOS)))
    decoded=dict(c,image=exported_texture,positions=np.array([v[0] for v in verts]),uv=np.array([v[2] for v in verts]),triangles=np.arange(len(verts)).reshape(-1,3))
    models.append(('Exported DAT / independent decode',decoded))
    views=[('Front',[1,0,0],[0,1,0]),('Side',[0,0,-1],[0,1,0]),('Top',[1,0,0],[0,0,-1])]
    size=400;sheet=Image.new('RGB',(size*len(models),size*3+100),'white');draw=ImageDraw.Draw(sheet)
    for col,(label,m) in enumerate(models):draw.text((col*size+10,10),label,fill='black')
    for row,(label,right,up) in enumerate(views):
        points=np.concatenate([m['positions'] for _,m in models]);proj=np.column_stack((points@right,points@up));extent=max(np.ptp(proj,axis=0))*1.03;center=(proj.max(axis=0)+proj.min(axis=0))/2
        for col,(name,m) in enumerate(models):
            im=render(m,right,up,extent,center,size);im.save(a.out/f'{col}-{label.lower()}.png');sheet.paste(im,(col*size,40+row*(size+20)));draw.text((col*size+10,40+row*(size+20)),label,fill='black')
    sheet.save(a.out/'comparison.png')
    # Roundtrip at bind and independent synthetic joint rotations. These are
    # explicit mathematical probes, not samples from Melee's animation stack.
    from opensmash_melee.retarget import skin
    from opensmash_melee.skeleton import trs
    lookup={j['offset']:j['index'] for j in s}
    env=[[(lookup[o],w) for o,w in v[3]] for v in verts]
    ib=[np.eye(4) if j['inverse_bind'] is None else np.array(j['inverse_bind']) for j in s]
    bind=[np.linalg.inv(m) for m in ib]
    from opensmash_melee.gx import batches
    order=np.array([ids for _,triangles in batches(c) for ids in triangles]).reshape(-1)
    probe=Image.new('RGB',(size*3,size+32),'white');pd=ImageDraw.Draw(probe);errors={}
    for col,(joint,rotation,label) in enumerate([(23,[0,.7,0],'Head yaw 40 degrees'),(9,[0,0,1.05],'Elbow bend 60 degrees'),(5,[.35,0,0],'Torso bend 20 degrees')]):
        affected={joint}
        for j in s:
            if j['parent'] in affected:affected.add(j['index'])
        pivot=bind[joint][:3,3];transform=trs(rotation,[1,1,1],[0,0,0]);transform[:3,3]=pivot-transform[:3,:3]@pivot
        posed=[transform@m if i in affected else m for i,m in enumerate(bind)]
        expected=skin(c['positions'],c['envelopes'],posed,ib)
        actual=skin(decoded['positions'],env,posed,ib)
        error=float(np.abs(actual-expected[order]).max());errors[label]=error
        if error>3e-5:raise ValueError('Posed GX roundtrip mismatch')
        im=render(dict(decoded,positions=actual),[1,0,0],[0,1,0],19,[0,7.4],size)
        probe.paste(im,(col*size,32));pd.text((col*size+8,8),label,fill='black')
    probe.save(a.out/'synthetic-poses.png');metrics['posed_export_max_errors']=errors
    if a.turntable:
        import subprocess, math, shutil
        frames=a.out/'turntable-frames';frames.mkdir(exist_ok=True)
        extent=max(np.ptp(source['positions'],axis=0).max(),np.ptp(decoded['positions'],axis=0).max())*1.1
        center_y=(source['positions'][:,1].max()+source['positions'][:,1].min())/2
        for frame in range(48):
            yaw=2*math.pi*frame/48;right=[math.cos(yaw),0,-math.sin(yaw)]
            pair=Image.new('RGB',(800,432),'white');draw=ImageDraw.Draw(pair)
            for col,(label,m) in enumerate([('Original GLB',source),('Exported Melee DAT',decoded)]):
                pair.paste(render(m,right,[0,1,0],extent,[0,center_y],400),(col*400,32));draw.text((col*400+10,10),label,fill='black')
            pair.save(frames/f'{frame:03}.png')
        subprocess.run(['ffmpeg','-v','error','-framerate','12','-i',str(frames/'%03d.png'),'-c:v','libx264','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart','-y',str(a.out/'turntable.mp4')],check=True)
        shutil.rmtree(frames)
    (a.out/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n');print(json.dumps(metrics,indent=2))
    check=metrics['candidate']
    if check['head_anisotropy']>1.03 or check['similarity_max_relative_error']>.025 or check['head_fraction_relative_error']>.05:
        raise ValueError('Source shape needs manual review; see rendered comparison and metrics')

if __name__=='__main__':main()
