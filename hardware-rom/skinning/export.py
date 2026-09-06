"""Bake shared weighted vertices and a root display list for the ROM skinner."""
from pathlib import Path
import re
import struct
import numpy as np
from scipy.spatial import cKDTree
import fast_simplification
from build_rom import read_osb, bind_to_local, patch_model, chain
from face_textures import SurfaceSampler, shade_equivalent
from skinning.patches import GRAPHICS_RESERVE


def damp_arm_leaks(points, slots, weights, frames, parents):
    """Match native ftport.c's spatial arm-weight damping on canonical bodies."""
    arm=[]
    for slot in range(len(parents)):
        branch=slot
        while parents[branch]>0:branch=parents[branch]
        arm.append(slot>0 and parents[branch]==0 and branch in parents)
    result=weights.astype(float).copy();changed=0
    for i,point in enumerate(points):
        armsum=sum(weights[i,t] for t,j in enumerate(slots[i]) if arm[j])
        if armsum==0 or armsum>=128:continue
        for t,j in enumerate(slots[i]):
            if not weights[i,t] or not arm[j]:continue
            children=[k for k,p in enumerate(parents) if p==j]
            a=frames[j,:3]
            if children:b=frames[children[0],:3]
            elif parents[j]>=0:b=2*a-frames[parents[j],:3]
            else:continue
            ab=b-a;length2=ab@ab
            if length2<1:continue
            along=(point-a)@ab/length2
            radial=np.linalg.norm(point-a-np.clip(along,0,1)*ab)/np.sqrt(length2)
            x=np.clip([(radial-.35)/.35,(along-.35)/.45],0,1)
            keep=np.prod(1-x*x*(3-2*x))
            if keep<1:changed+=1
            result[i,t]*=keep
    result=np.rint(result/result.sum(axis=1)[:,None]*255).astype(int)
    return result,changed


def blank_joint_ids(data, sections, joints):
    """Hide explicit body parts as well as geometry replaced by the skin."""
    blank_at=data.find(b'BLNK',sections)
    blank_joints=set(joints)
    if blank_at>=0:
        count=struct.unpack_from('<I',data,blank_at+4)[0]
        if count>64 or blank_at+8+count*4>len(data):raise ValueError('Invalid BLNK section')
        blank_joints=set(struct.unpack_from('<'+str(count)+'I',data,blank_at+8)) if count else set(joints)
    if any(j<0 or j>=37 for j in blank_joints):raise ValueError('Invalid BLNK joint ID')
    return blank_joints


def weighted_mesh(path,budget,texture_size):
    joints,verts,faces,frames,colors=read_osb(path)
    points,inverse=np.unique(np.round(verts[:,:3],4),axis=0,return_inverse=True)
    points,triangles=fast_simplification.simplify(points,inverse[faces].astype(np.int32),target_count=min(budget,len(faces)))
    nearest=cKDTree(verts[:,:3]).query(points)[1]
    data=path.read_bytes();nj,nv,nt,w,h=struct.unpack_from('<5I',data,4)
    at=24+nj*4
    sampler=SurfaceSampler(verts,faces,np.frombuffer(data[at:at+w*h*2],dtype='>u2').reshape(h,w))
    sections=at+w*h*2+nv*28+nt*8+4+nj*48
    can=data.find(b'CAN1',sections);tb=data.find(b'TBND',sections)
    blank_joints=blank_joint_ids(data,sections,joints)
    parents=[-1]*nj;target_inv=np.tile(np.eye(3),(nj,1,1));root_offset=np.zeros(3)
    canonical=can>=0
    if canonical:
        if tb<0:raise ValueError('Canonical skinning requires TBND frames')
        root=np.array(struct.unpack_from('<3f',data,can+4))
        parents=list(struct.unpack_from('<'+str(nj)+'i',data,can+16))
        target=np.frombuffer(data[tb+4:tb+4+(nj+1)*48],dtype='<f4').reshape(nj+1,12)
        target_inv=np.linalg.inv(target[:nj,3:].reshape(nj,3,3))
        root_offset=frames[0,:3]-root-bind_to_local(target[nj],target[:1,:3])[0]
        if any(p>=i or p < -1 for i,p in enumerate(parents)):
            raise ValueError('Canonical parents must precede children')
    slots=verts[nearest,5:9].astype(int)
    weights=verts[nearest,9:13].astype(int)
    damped=0
    if canonical:
        weights,damped=damp_arm_leaks(points,slots,weights,frames,parents)
    parity_data=b''
    if canonical:
        cp=tb+4+(nj+1)*48
        cp_origin=np.array(struct.unpack_from('<3f',data,cp))
        top_inv=np.linalg.inv(target[nj,3:].reshape(3,3))
        cp_at=data.find(b'CPM1',sections)
        cp_matrix=np.frombuffer(data[cp_at+4:cp_at+40],dtype='<f4').reshape(3,3) if cp_at>=0 else np.eye(3)
        sh=[j for j in range(1,nj) if parents[j]==0 and j in parents][:2]
        cap=16 if nj<=16 else 32
        config=bytearray(struct.pack('>I'+str(cap)+'I'+str(cap)+'i',nj,*(list(joints)+[0]*(cap-nj)),*(parents+[-1]*(cap-nj))))
        config.extend(struct.pack('>3f',*root))
        for matrices in (frames[:,:3],frames[:,3:],target_inv.reshape(nj,9)):
            padded=np.zeros((cap,matrices.shape[1]));padded[:nj]=matrices
            config.extend(padded.astype('>f4').tobytes())
        config.extend(top_inv.astype('>f4').tobytes())
        config.extend((top_inv@(cp_origin-target[nj,:3])).astype('>f4').tobytes())
        config.extend(cp_matrix.astype('>f4').tobytes())
        config.extend(struct.pack('>4i2f',int(cp_at>=0),len(sh),*(sh+[-1]*(2-len(sh))),0,0))
        assert len(config)==124+92*cap
        for point,source in zip(points,nearest):
            prox=[]
            for j in sh:
                child=parents.index(j);length=np.linalg.norm(frames[child,:3]-frames[j,:3])
                d=np.linalg.norm(point-frames[j,:3])/(1.2*length) if length>=1 else 1
                prox.append(int(max(0,1-d*d*(3-2*d))*255) if d<1 else 0)
            arm=0
            for slot,wgt in zip(verts[source,5:9].astype(int),verts[source,9:13].astype(int)):
                branch=slot
                while parents[branch]>0:branch=parents[branch]
                if slot>0 and parents[branch]==0 and branch in parents:arm+=wgt
            config.extend(bytes(prox+[0]*(2-len(prox))+[min(255,arm),0]))
        parity_data=bytes(config)
    pin_at=data.find(b'ACC2',sections);pins=[]
    if pin_at>=0:
        count=struct.unpack_from('<I',data,pin_at+4)[0]
        if count>8:raise ValueError('Too many accessory pins')
        pins=[struct.unpack_from('<IIf',data,pin_at+8+i*12) for i in range(count)]
    acc3=data.find(b'ACC3',sections)
    acfg=[(0,0,0)]*len(pins)
    if acc3>=0:
        count=struct.unpack_from('<I',data,acc3+4)[0]
        if count!=len(pins):raise ValueError('ACC3/ACC2 count mismatch')
        acfg=[struct.unpack_from('<3f',data,acc3+8+i*12) for i in range(count)]
    scale=1.;fit=1.
    if canonical:
        chest_origin=np.array(struct.unpack_from('<3f',data,tb+4+(nj+1)*48+12))
        if chest_origin[1]-target[nj,1]>1:scale=(frames[0,1]-root[1])/(chest_origin[1]-target[nj,1])
    scal=data.find(b'SCAL',sections)
    if scal>=0:fit=struct.unpack_from('<f',data,scal+4)[0]
    mask=[sum(1<<(j%32) for j in blank_joints if j//32==k) for k in range(2)]
    render_data=bytearray(struct.pack('>2I2fI',*mask,scale,fit,len(pins)))
    for i,((joint,vi,embed),(pitch,orient,ascale)) in enumerate(zip(pins,acfg)):
        if joint>=37 or vi>=nv:raise ValueError('Invalid accessory pin')
        bind=np.eye(3)
        if canonical:
            acc_bind_at=tb+4+(nj+1)*48+24+4+i*36
            bind=np.frombuffer(data[acc_bind_at:acc_bind_at+36],dtype='<f4').reshape(3,3)
        render_data.extend(struct.pack('>I6f8B13f',joint,*verts[vi,:3],*verts[vi,13:16],
            *verts[vi,5:13].astype(int),abs(embed),pitch,max(orient,float(embed<0)),ascale,*bind.ravel()))
    for source in nearest:
        render_data.extend(struct.pack('>3bB',*verts[source,13:16].astype(int),0))
    sampled=sampler.sample(points).astype(int)
    point_colors=np.stack([(sampled>>shift)&31 for shift in (11,6,1)],axis=1)*255//31
    joint_data=bytearray()
    for i,jid in enumerate(joints):
        inverse=target_inv[i] if canonical else np.linalg.inv(frames[i,3:].reshape(3,3))
        joint_data.extend(struct.pack('>Ii21f',jid,parents[i],*frames[i],*inverse.ravel()))
    vertex_data=bytearray()
    for point,vertex_slots,vertex_weights in zip(points,slots,weights):
        if not vertex_weights.sum():raise ValueError('Skin vertex has no weights')
        if not np.isfinite(point).all() or np.abs(point).max()>32767:
            raise ValueError('Skin bind-local coordinate outside s16')
        vertex_data.extend(struct.pack('>3h8B2x',*np.rint(point).astype(int),*vertex_slots,*vertex_weights))
    shaded=[];textured=[];head=int(np.argmax(frames[:,1]))
    for tri in triangles:
        source=nearest[tri]
        score=np.zeros(nj)
        for vi in source:
            for ji,weight in zip(verts[vi,5:9].astype(int),verts[vi,9:13]):score[ji]+=weight
        color=point_colors[tri].copy()
        tile=None
        if texture_size and int(score.argmax())==head:
            tile=sampler.tile(points[tri],texture_size)
            replacement=shade_equivalent(tile,texture_size)
            if replacement is not None:color=replacement;tile=None
            else:color=point_colors[tri].copy()
        entry=(tri,color,tile)
        (textured if tile else shaded).append(entry)
    return dict(render_data=bytes(render_data),parity_data=parity_data,joints=joints,blank_joints=blank_joints,points=points,source_faces=len(faces),triangles=len(triangles),
                joint_data=joint_data,vertex_data=vertex_data,shaded=shaded,textured=textured,
                root_offset=root_offset,canonical=canonical,point_colors=point_colors,damped_arm_weights=damped)


def batches(triangles):
    """Partition triangles into 30-position RSP cache windows."""
    pending={i:t for i,t in enumerate(triangles)}
    keys={i:[int(uid) for uid in t[0]]
          for i,t in pending.items()}
    while pending:
        entries=[];lookup={};chosen=[]
        while pending:
            index=max(pending,key=lambda i:sum(k in lookup for k in keys[i]))
            needed=[k for k in keys[index] if k not in lookup]
            if len(lookup)+len(set(needed))>30:break
            for key in needed:
                if key not in lookup:lookup[key]=len(entries);entries.append(key)
            chosen.append((pending.pop(index),[lookup[k] for k in keys[index]]))
        yield entries,chosen


def patch_skin_model(raw,entry,source,main_source,mesh,texture_size,module):
    if len(mesh['joints'])>16:module=module['wide']
    blob,first,ext=patch_model(raw,entry,source,{j:[] for j in mesh['blank_joints']},main_source)
    internal=chain(blob,first);external=chain(blob,ext)
    # Rigid empty batches still set SHADE and disable lighting. They run after
    # the root skin DL, so replace them with genuine END-only lists.
    trees=list(dict.fromkeys(int(x,16) for x in re.findall(r'DObjDesc: JointTree[^@\n]*@ (0x[0-9A-Fa-f]+)',source)))[:2]
    for tree in trees:
        for i in range(64):
            at=tree+i*44
            if struct.unpack_from('>I',blob,at)[0]==18:break
            if i+4 in mesh['blank_joints'] and at+4 in internal:
                struct.pack_into('>II',blob,internal[at+4],0xdf000000,0)

    # Reuse only unreachable tails of body display lists replaced by an
    # unconditional branch. Preserve every original public entry offset.
    holes=[]
    original_internal=dict(internal)
    for address,length in re.findall(r'/\* DisplayList: [^@]+@ (0x[0-9A-Fa-f]+) \((\d+) bytes',source):
        begin=int(address,16);end=begin+int(length)
        if struct.unpack_from('>I',blob,begin)[0]!=0xde010000:continue
        start=begin+8
        incoming=[at for at,target in internal.items() if start<=target<end and not start<=at<end]
        # Animated model-part tables can reference an interior DL label.
        public=[sum(int(x,16) for x in re.findall(r'0x[0-9A-Fa-f]+',name))
                for name in re.findall(r'&([A-Za-z_][A-Za-z_0-9]*)',main_source)]
        if incoming or any(start<=target<end for target in public):continue
        holes.append([start,end])
        for pointers in (internal,external):
            for at in list(pointers):
                if start<=at<end:del pointers[at]

    # Vertex blocks referenced exclusively by discarded command tails are
    # also unreachable. Never reuse an unreferenced block merely by guessing.
    for address,count in re.findall(r'/\* Vtx: [^@]+@ (0x[0-9A-Fa-f]+) \((\d+) vertices',source):
        start=int(address,16);end=start+int(count)*16
        refs=[at for at,target in original_internal.items() if start<=target<end]
        if refs and all(at not in internal for at in refs) and not any(start<=target<end for target in internal.values()):
            holes.append([start,end])

    holes=sorted(set(map(tuple,holes)))
    if any(a[1]>b[0] for a,b in zip(holes,holes[1:])):raise ValueError('Overlapping dead model blocks')
    holes=list(map(list,holes))
    def add(data,alignment=8):
        for hole in holes:
            at=(hole[0]+alignment-1)&-alignment
            if at+len(data)<=hole[1]:
                blob[at:at+len(data)]=data;hole[0]=at+len(data);return at
        blob.extend(bytes((-len(blob))%alignment));at=len(blob);blob.extend(data);return at
    code_at=module['shared_offset']
    bootstrap=add(module['bootstrap'],16)
    joint_at=add(mesh['joint_data']);vertex_at=add(mesh['vertex_data'])
    output_map=list(range(len(mesh['points'])))
    template=bytearray()
    for color in mesh['point_colors']:
        template.extend(struct.pack('>hhhHhhBBBB',0,0,0,0,0,0,*color,255))
    dl=bytearray();pointers={}
    def cmd(a,b):dl.extend(struct.pack('>II',a,b))
    light_at=add(bytes.fromhex('9191910091919100ffffff00ffffff002d5f460000000000'))
    cmd(0xe7000000,0);cmd(0xd7000000,0)
    cmd(0xd9fbf9ff,0);cmd(0xd9ffffff,0x00220005)
    cmd(0xdb020000,24)
    pointers[len(dl)+4]=light_at+8;cmd(0xdc08060a,0)
    pointers[len(dl)+4]=light_at;cmd(0xdc08090a,0)
    cmd(0xfc327fff,0xfffff838)
    texture_active=False
    from skinning.ordering import select
    ordering=[]
    for group in (mesh['shaded'],mesh['textured']):
        groups,order_stats=select(group,list(batches(group)),module.get('optimizer'))
        ordering.append(order_stats)
        for entries,chosen in groups:
            # Each shared position occupies exactly one Vtx in RAM. Load
            # contiguous source runs into this cache window; duplicates across
            # windows no longer require additional per-frame output buffers.
            entries=sorted(entries)
            cache={uid:i for i,uid in enumerate(entries)}
            run=0
            while run<len(entries):
                end=run+1
                while end<len(entries) and entries[end]==entries[end-1]+1:end+=1
                count=end-run
                cmd(0x01000000|(count<<12)|(end<<1),0x0d000000+entries[run]*16)
                run=end
            for triangle,_ in chosen:
                indices=[cache[int(uid)] for uid in triangle[0]]
                if not triangle[2]:
                    # Low-memory body material: one base color per triangle;
                    # RSP lighting still interpolates the animated normals.
                    color=np.rint(np.mean(triangle[1],axis=0)).astype(int)
                    cmd(0xe7000000,0)
                    cmd(0xfa000000,(int(color[0])<<24)|(int(color[1])<<16)|(int(color[2])<<8)|255)
                tile=triangle[2]
                if tile:
                    texture_at=add(tile)
                    cmd(0xe7000000,0)
                    if not texture_active:
                        cmd(0xd7000002,0xffffffff);cmd(0xfc1219ff,0xfffffe38)
                        texture_active=True
                    pointers[len(dl)+4]=texture_at
                    cmd(0xfd100000|(texture_size-1),0)
                    cmd(0xf5100000|((texture_size//4)<<9),0x07080200)
                    cmd(0xe6000000,0)
                    extent=((texture_size-1)*4<<12)|((texture_size-1)*4)
                    cmd(0xf4000000,0x07000000|extent);cmd(0xe7000000,0)
                    cmd(0xf5100000|((texture_size//4)<<9),0x00080200);cmd(0xf2000000,extent)
                    for index,(s,t) in zip(indices,((32,32),((texture_size-2)*32,32),(32,(texture_size-2)*32))):
                        cmd(0x02140000|(index*2),(s<<16)|t)
                a,b,c=(i*2 for i in indices)
                cmd(0x05000000|(a<<16)|(b<<8)|c,0)
    cmd(0xe7000000,0);cmd(0xd9ffffff,0x00020400);cmd(0xfc121824,0xff33ffff);cmd(0xdf000000,0)
    if len(output_map)*16*4>GRAPHICS_RESERVE:
        raise ValueError('Four-instance skin buffers exceed graphics reserve; reduce --triangles')
    mapping_at=add(struct.pack('>'+str(len(output_map))+'H',*output_map))
    template_at=add(template);dl_at=add(dl)
    internal.update({dl_at+at:target for at,target in pointers.items()})
    descriptor=bytearray(88)
    struct.pack_into('>10I',descriptor,0,0xdf000000,0,0x534b4e31,0,code_at,len(module['code']),
                     len(mesh['points']),len(output_map),len(mesh['joints']),int(mesh['canonical']))
    struct.pack_into('>3f',descriptor,60,*mesh['root_offset'])
    parity_at=add(mesh['parity_data']) if mesh['parity_data'] else None
    render_at=add(mesh['render_data'])
    marker=add(descriptor)
    internal[marker+80]=render_at
    if parity_at is not None:internal[marker+76]=parity_at
    for at,target in [(12,bootstrap),(40,joint_at),(44,vertex_at),(48,mapping_at),(52,template_at),(56,dl_at)]:
        internal[marker+at]=target
    trees=list(dict.fromkeys(int(x,16) for x in re.findall(r'DObjDesc: JointTree[^@\n]*@ (0x[0-9A-Fa-f]+)',source)))[:2]
    for tree in trees:internal[tree+4]=marker
    # GOT page anchors may lie just past the last object in the module.
    if internal and max(internal.values())>len(blob):blob.extend(bytes(max(internal.values())-len(blob)))
    for pointers in (internal,external):
        offsets=sorted(pointers) if pointers is internal else list(pointers)
        for i,at in enumerate(offsets):
            nxt=offsets[i+1]//4 if i+1<len(offsets) else 65535
            target=pointers[at]//4
            if max(nxt,target)>65535:raise ValueError('Relocation exceeds 16-bit word range')
            struct.pack_into('>HH',blob,at,nxt,target)
    if len(blob)>65535*4:raise ValueError('Model exceeds reloc file limit')
    stats=dict(triangle_ordering=ordering,skin_vertices=len(mesh['points']),render_vertices=len(output_map),
               skin_scratch_bytes=0,skin_output_bytes=len(output_map)*16,
               canonical_skinning=mesh['canonical'],textured_triangles=len(mesh['textured']),damped_arm_weights=mesh['damped_arm_weights'])
    return blob,min(internal)//4,min(external)//4 if external else 65535,stats
