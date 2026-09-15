"""Browser skinning data: exact source weights, one GX draw per index limit.

The loaded HSD envelope keeps live joint references. An ignored GX_NULL vertex
attribute carries a versioned descriptor consumed by the browser runtime only.
"""
import struct
import numpy as np
MAGIC=0x4f53534b


def build_costume(original, mesh, skeleton, profile):
    """Prefer the profile's texture size without overflowing warm-boot slots."""
    from PIL import Image
    from .archive import Archive
    from .gx import replace_costume
    from .costume_memory import compact_body_textures, VERSION as MEMORY_VERSION
    from .skeleton import joints
    original, removed = compact_body_textures(original, skeleton, profile)
    if removed:
        skeleton = joints(Archive(original), profile['symbol'])
    size=profile.get('texture_size',256)
    while True:
        archive=Archive(original)
        fitted=dict(mesh,image=mesh['image'].resize((size,size),Image.Resampling.LANCZOS))
        stats=replace_costume(archive,fitted,skeleton,dict(profile,browser_skinning=True))
        raw=archive.serialize()
        # Must match runtime/web/local-files.mjs. Keep the existing 256 option
        # for unusually large source meshes rather than breaking their launch.
        if len(raw)<=2*1024*1024:
            stats['texture_size']=size
            stats['memory_layout_version']=MEMORY_VERSION
            stats['obsolete_body_bytes_removed']=removed
            return raw,stats
        if size<=256:raise ValueError('Browser costume exceeds the 2 MiB warm-boot slot')
        size//=2


def polygons(archive,mesh,skeleton):
    n=len(mesh['positions'])
    if n>65535:raise ValueError('Browser skinning INDEX16 vertex limit exceeded')
    pos=archive.append(np.asarray(mesh['positions'],dtype='>f4').tobytes(),32)
    nrm=archive.append(np.asarray(mesh['normals'],dtype='>f4').tobytes(),32)
    uv=archive.append(np.asarray(mesh['uv'],dtype='>f4').tobytes(),32)
    srcpos=archive.append(np.asarray(mesh['positions'],dtype='>f4').tobytes(),32)
    srcnrm=archive.append(np.asarray(mesh['normals'],dtype='>f4').tobytes(),32)
    bones=sorted({j for env in mesh['envelopes'] for j,w in env})
    boneindex={j:i for i,j in enumerate(bones)}
    envs=list(dict.fromkeys(mesh['envelopes']));envindex={env:i for i,env in enumerate(envs)}
    records=archive.alloc(len(envs)*4)
    for i,env in enumerate(envs):
        if len(env)==1:env=((env[0][0],.5),(env[0][0],.5))
        record=archive.alloc(4+len(env)*8);archive.pack('I',record,len(env))
        for k,(j,w) in enumerate(env):archive.pack('If',record+4+k*8,boneindex[j],w)
        archive.pointer(records+i*4,record)
    vertex_env=archive.append(np.array([envindex[e] for e in mesh['envelopes']],dtype='>u2').tobytes(),4)
    metadata=archive.alloc(48);archive.pack('5I',metadata,MAGIC,1,n,len(envs),len(bones))
    for off,ptr in [(20,srcpos),(24,srcnrm),(28,records),(32,vertex_env),(36,pos),(40,nrm)]:archive.pointer(metadata+off,ptr)
    desc=archive.alloc(5*24)
    for i,(attr,kind,count,stride,ptr) in enumerate([(0,1,0,0,None),(9,3,1,12,pos),(10,3,0,12,nrm),(13,3,1,8,uv),(255,MAGIC,0,0,metadata)]):
        p=desc+i*24;archive.pack('4I',p,attr,kind,count,4);archive.pack('H',p+18,stride);archive.pointer(p+20,ptr)
    # HSD resolves these descriptors to live HSD_JObj pointers after loading.
    bone_desc=archive.alloc((len(bones)+1)*8)
    for i,j in enumerate(bones):archive.pointer(bone_desc+i*8,skeleton[j]['offset']);archive.pack('f',bone_desc+i*8+4,1/len(bones))
    table=archive.alloc(8);archive.pointer(table,bone_desc)
    first=previous=None;count=0
    for begin in range(0,len(mesh['triangles']),21845):
        tris=mesh['triangles'][begin:begin+21845]
        display=bytearray(struct.pack('>BH',0x90,len(tris)*3))
        for tri in tris:
            for vertex in tri:display.extend(struct.pack('>BHHH',0,vertex,vertex,vertex))
        display.extend(b'\0'*(-len(display)%32));dl=archive.append(display,32)
        pobj=archive.alloc(24);archive.pointer(pobj+8,desc);archive.pack('HH',pobj+12,0x2000,len(display)//32)
        archive.pointer(pobj+16,dl);archive.pointer(pobj+20,table)
        if first is None:first=pobj
        if previous is not None:archive.pointer(previous+4,pobj)
        previous=pobj;count+=1
    return first,count
