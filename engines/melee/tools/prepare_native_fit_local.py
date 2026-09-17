"""Prepare source-only packages and reusable target templates for local native fitting.

No character/moveset fit runs here. Game-derived output stays in ignored build/.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
import struct
import numpy as np
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from opensmash_melee.glb import GLB
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.gx import replace_costume, rgba8
from opensmash_melee.costume_memory import compact_body_textures
from opensmash_melee.retarget_probe import load, TARGETS
from opensmash_melee.multi_fighter import load_target
from opensmash_melee.targets import BY_SLUG
from opensmash_melee.surfaces import smooth_normals

NAMES = ['Root','Hip','Spine01','Spine02','NeckTwist01','NeckTwist02','Head']
for side in ['L','R']:
    NAMES += [side+'_'+s for s in ['Clavicle','Upperarm','UpperarmTwist01','UpperarmTwist02','Forearm','ForearmTwist01','ForearmTwist02','Hand','Thigh','ThighTwist01','ThighTwist02','Calf','CalfTwist01','CalfTwist02','Foot','ToeBase']]
ROUND_NAMES = ['Head','L_Hand','R_Hand','L_Foot','R_Foot']

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(',', ':')))

def flat(value):return np.asarray(value).reshape(-1).tolist()

def source_package(source, out, slug=None):
    slug = slug or source.name
    if not re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}',source.name):raise ValueError('Invalid source slug')
    mesh=GLB(source/'rigged.glb').mesh()
    flags={'Head':1,'L_Hand':2,'R_Hand':4,'L_Foot':8,'L_ToeBase':16,'R_Foot':32,'R_ToeBase':64}
    parts=[]
    for name in mesh['names']:
        value=flags.get(name,0)
        if any(p in name for p in ['Clavicle','Upperarm','Forearm']):value=128 if name.startswith('L_') else 256 if name.startswith('R_') else value
        parts.append(value)
    data={'version':1,'n':len(mesh['positions']),'sourceJoints':len(mesh['names']),
          'triangleCount':len(mesh['triangles']),'sourceSha256':hashlib.sha256((source/'rigged.glb').read_bytes()).hexdigest(),
          'parts':parts,'semantics':[NAMES.index('Hip' if n in ['Pelvis','Waist'] else n) for n in mesh['names']],
          'roundOrigins':flat([mesh['bind'][mesh['names'].index(n)][:3,3] for n in ROUND_NAMES]),
          'humanoidOrigins':flat([mesh['bind'][mesh['names'].index(n)][:3,3] for n in NAMES]),
          'smoothNormals':flat(smooth_normals(mesh)['normals']), 'textureSize':512}
    for name in ['positions','normals','weights','joints','triangles','uv']:data[name]=flat(mesh[name])
    # Source-only identity artwork is relocatable; no target rig or fit needed.
    from opensmash_melee.presentation import attach, panel
    identity=Archive(struct.pack('>5I',32,0,0,0,0)+bytes(12))
    material=identity.alloc(24);dobj=identity.alloc(16);identity.pointer(dobj+8,material)
    attach(identity,dobj,panel(source))
    data['identityMaterial']=identity.ptr(dobj+8)
    write(out/'sources'/f'{slug}.json',data)
    (out/'sources'/f'{slug}.identity.dat').write_bytes(identity.serialize())
    (out/'sources'/f'{slug}.rgba8').write_bytes(rgba8(mesh['image'].resize((512,512),Image.Resampling.LANCZOS)))
    print('Source:',source.name,flush=True)

def attachment_layout(a,sk,slug,indices):
    anchors={'link':{26:25,70:69,71:69},'marth':{76:75},'roy':{78:77},'young-link':{28:27,74:73,75:73}}
    def bind(i):return np.linalg.inv(sk[i]['inverse_bind']) if sk[i]['inverse_bind'] is not None else np.asarray(sk[i]['world'])
    result=[]
    for i in indices:
        anchor=anchors.get(slug,{}).get(i,i);arrays=[];d=sk[i]['dobj']
        while d is not None:
            p=a.ptr(d+12)
            while p is not None:
                desc=a.ptr(p+8);attrs=[]
                while a.u32(desc)!=255:
                    attrs.append(a.unpack('4IBBHI',desc));desc+=24
                used={9:set(),10:set()};cursor=a.ptr(p+16);end=cursor+a.unpack('H',p+14)[0]*32
                while cursor<end:
                    op=a.unpack('B',cursor)[0];cursor+=1
                    if not op:continue
                    count=a.unpack('H',cursor)[0];cursor+=2
                    for _ in range(count):
                        for attr,typ,_,_,_,_,_,_ in attrs:
                            if not typ:continue
                            if typ not in (2,3):raise ValueError('Unexpected attachment attribute')
                            value=a.unpack('B' if typ==2 else 'H',cursor)[0];cursor+=1 if typ==2 else 2
                            if attr in used:used[attr].add(value)
                for attr,typ,cnt,fmt,frac,pad,stride,array in attrs:
                    if attr not in used:continue
                    if fmt!=4 or stride!=12:raise ValueError('Attachment was not normalized')
                    for vertex in sorted(used[attr]):
                        offset=array+vertex*stride
                        arrays.append(dict(offset=offset,normal=attr==10,value=list(a.unpack('3f',offset))))
                p=a.ptr(p+4)
            d=a.ptr(d+4)
        result.append(dict(joint=i,anchor=anchor,left=flat(np.linalg.inv(bind(i))@bind(anchor)),right=flat(np.linalg.inv(bind(anchor))@bind(i)),arrays=arrays))
    return result

def attachment_reference(game,slug,rig):
    from tools.inspect_costume_bounds import inspect,rigid_positions
    result={}
    original=game/f"Pl{rig['code']}Nr.dat"
    if slug=='link':
        surfaces=[]
        for index,bones in ((67,[54,55]),(69,[18,19,51,39,40])):
            original_bones=list(bones)
            if index==67:
                for joint in rig['skeleton']:
                    if joint['parent'] in original_bones and joint['index']!=index:original_bones.append(joint['index'])
            points=inspect(str(original),None,tuple(original_bones))[0]
            inverse=rig['skeleton'][index]['inverse_bind']
            local=(inverse@np.c_[points,np.ones(len(points))].T).T
            surfaces.append(dict(anchor=index,bones=bones,inverse=flat(inverse),surface=float(local[:,2].max() if index==69 else local[:,2].min())))
        result['attachmentSurfaces']=surfaces
    if slug=='marth':
        reference=json.loads((ROOT/'runtime/attachment-poses/marth-idle.json').read_text())
        if reference['costumeSha256']!=hashlib.sha256(original.read_bytes()).hexdigest():raise ValueError('Attachment pose mismatch')
        a=Archive.read(original);poses={int(i):np.array(m) for i,m in reference['joints'].items()};rows=[]
        for anchor,children in ((19,[19]),(75,[75,76])):
            points=[]
            for index in children:
                local=rigid_positions(a,rig['skeleton'][index],reference['visibleDObjs'][str(index)])
                points.extend((poses[index]@np.c_[local,np.ones(len(local))].T).T[:,:3])
            rows.append(dict(anchor=anchor,points=flat(points),pose=flat(poses[anchor]),inverse=flat(np.linalg.inv(poses[anchor]))))
        result['attachmentPoses']=rows
    return result


def target_package(slug, game, out):
    spec=next(s for s in TARGETS if s[0]==slug)
    rig=load(game,spec)
    if slug=='mario':rig['mapping'][24]=24
    from tools.inspect_costume_bounds import inspect
    from opensmash_melee.target_presentation import ATTACHMENTS
    original_positions=inspect(str(game/f'Pl{spec[1]}Nr.dat'))[0]
    gear={'popo':[15],'nana':[15],'roy':[21,77,78],'young-link':[27,28,71,73,74,75]}
    attachments=gear.get(slug,ATTACHMENTS.get(slug,[]))
    original=(game/f'Pl{spec[1]}Nr.dat').read_bytes()
    profile=dict(symbol=rig['symbol'],base_fighter=slug,mesh_joint=0,mesh_dobj=6 if slug=='kirby' else 0,
                 browser_skinning=True,isolate_body_texture_animation=True,preserve_attachment_joints=attachments)
    # Costume slots can export additional objects (Jigglypuff's hats). Derive
    # each actual slot once, rather than renaming a neutral archive's symbols.
    layouts=[]
    for color,slot in enumerate(BY_SLUG[slug]['costumes']):
        from opensmash_melee.costume_variant import costume_variant
        # Match the existing converter's neutral rig for every costume slot.
        # Puff slots additionally require their authored hat exports.
        slot_original=(game/slot['filename']).read_bytes() if slug=='jigglypuff' else costume_variant(original,BY_SLUG[slug]['fighter'],color,slug)
        slot_profile=dict(profile,symbol=slot['symbol'])
        slot_skeleton=joints(Archive(slot_original),slot['symbol'])
        if len(slot_skeleton)!=len(rig['skeleton']):raise ValueError('Costume slot changes target skeleton')
        for neutral,joint in zip(rig['skeleton'],slot_skeleton):
            x,y=neutral['inverse_bind'],joint['inverse_bind']
            if (x is None)!=(y is None) or (x is not None and not np.allclose(x,y,rtol=0,atol=1e-6)):
                raise ValueError('Costume slot changes target bind pose')
        raw,_=compact_body_textures(slot_original,slot_skeleton,slot_profile)
        a=Archive(raw);sk=joints(a,slot['symbol'])
        placeholder=dict(positions=np.zeros((3,3)),normals=np.tile([0.,1.,0.],(3,1)),uv=np.zeros((3,2)),
                         triangles=np.array([[0,1,2]]),envelopes=[((rig['mapping'][23],1.),)]*3,image=Image.new('RGBA',(4,4),'white'))
        replace_costume(a,placeholder,sk,slot_profile)
        # Preserve required accessory exports/objects, suppress their vanilla
        # geometry so the character's own headwear remains the visible one.
        for symbol in a.roots():
            if slug!='jigglypuff' or symbol==slot['symbol'] or not symbol.endswith('_joint') or 'matanim' in symbol:continue
            for joint in joints(a,symbol):
                d=joint['dobj'];seen=set()
                while d is not None:
                    if d in seen:raise ValueError('Cyclic accessory DObj list')
                    seen.add(d);a.pointer(d+12,None);d=a.ptr(d+4)
        dobj=sk[0]['dobj']
        for _ in range(profile['mesh_dobj']):dobj=a.ptr(dobj+4)
        image=a.ptr(a.ptr(a.ptr(dobj+8)+8)+76)
        layouts.append(dict(jointOffsets=[j['offset'] for j in sk],dobj=dobj,image=image,rootDobj=sk[0]['dobj'],
                            exports=list(a.roots()),templateColor=color,attachments=attachment_layout(a,sk,slug,attachments)))
        (out/'targets').mkdir(parents=True,exist_ok=True)
        (out/'targets'/f'{slug}-{color}.dat').write_bytes(a.serialize())
    data=dict(version=1,target=slug,mode='round' if slug in ('kirby','jigglypuff') else 'humanoid',
              fitFlags=(1 if slug=='mario' else 0)|(6 if slug not in ('mario','fox','luigi','captain-falcon','link','marth','kirby','jigglypuff') else 0),
              originalBounds=[float(original_positions[:,1].min()),float(original_positions[:,1].max())],
              costumeSha256=hashlib.sha256(original).hexdigest(),slots=BY_SLUG[slug]['costumes'],layouts=layouts,
              headJoint=rig['mapping'][23],headInverse=flat(rig['skeleton'][rig['mapping'][23]]['inverse_bind']))
    if slug not in ('kirby','jigglypuff'):
        anatomy=np.zeros(59,dtype=np.uint32);anchors=np.zeros((59,3))
        for old,j in rig['mapping'].items():anatomy[old]=j;anchors[old]=np.linalg.inv(rig['skeleton'][j]['inverse_bind'])[:3,3]
        data.update(anatomy=flat(anatomy),targetAnchors=flat(anchors))
    else:
        calibration=json.loads(gzip.decompress((ROOT/'runtime/retarget-clearance'/f'{slug}.json.gz').read_bytes()))
        if calibration['costume_sha256']!=data['costumeSha256']:raise ValueError('Calibration/template mismatch')
        data.update(targetCount=len(rig['skeleton']),poses=len(calibration['samples']),radius=4.3 if slug=='kirby' else 4.5,
                    targetJoints=[rig['mapping'][i] for i in [23,10,33,51,57]],
                    inverseBinds=flat([j['inverse_bind'] if j['inverse_bind'] is not None else np.eye(4) for j in rig['skeleton']]),
                    worlds=flat([s['worlds'] for s in calibration['samples']]))
    data.update(attachment_reference(game,slug,rig))
    write(out/'targets'/f'{slug}.json',data)
    print('Target:',slug,flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,action='append',default=[])
    p.add_argument('--targets',nargs='+',choices=list(BY_SLUG),default=list(BY_SLUG))
    p.add_argument('--source-only',action='store_true')
    p.add_argument('--slug')
    p.add_argument('--game',type=Path,default=ROOT/'assets/game/files')
    p.add_argument('--output',type=Path,default=ROOT/'build/native-fit/local')
    args=p.parse_args()
    if args.slug and (len(args.source)!=1 or not re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}',args.slug)):p.error('Invalid source identifier')
    for source in args.source:source_package(source,args.output,args.slug)
    if args.source_only:return
    for slug in args.targets:target_package(slug,args.game,args.output)
    write(args.output/'manifest.json',{'version':1,'characters':sorted(p.stem for p in (args.output/'sources').glob('*.json')),
                                     'targets':[slug for slug in BY_SLUG if (args.output/'targets'/f'{slug}.json').exists()]})
if __name__=='__main__':main()
