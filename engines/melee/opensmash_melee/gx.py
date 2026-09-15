"""HSD envelope polygons, ten-matrix GX batches, and tiled RGBA8 textures."""
import struct
import numpy as np

from .materials import LIT_TEXTURE_MODE, FIGHTER_MATERIAL_COLOR, FIGHTER_TEXTURE_FLAGS


def rgba8(image):
    pixels = np.asarray(image.convert('RGBA'))
    height, width = pixels.shape[:2]
    if width % 4 or height % 4 or max(width,height) > 1024:
        raise ValueError('GX RGBA8 needs dimensions divisible by 4, maximum 1024')
    # GX stores each 4x4 tile as 32 AR bytes followed by 32 GB bytes.
    # Pack all tiles in NumPy instead of allocating arrays in a Python loop.
    tiles = pixels.reshape(height // 4, 4, width // 4, 4, 4).transpose(0, 2, 1, 3, 4).reshape(-1, 16, 4)
    out = np.empty((len(tiles), 2, 16, 2), dtype=np.uint8)
    out[:, 0] = tiles[:, :, [3, 0]]
    out[:, 1] = tiles[:, :, [1, 2]]
    return out.tobytes()


def batches(mesh):
    # Opaque triangles may be reordered. Grow each batch through adjacent
    # envelope users; keep exact weights and never discard triangles.
    from collections import defaultdict
    tri_list = [tuple(int(i) for i in tri) for tri in mesh['triangles']]
    tri_env = [tuple(dict.fromkeys(mesh['envelopes'][i] for i in tri)) for tri in tri_list]
    users = defaultdict(set)
    for index,envs in enumerate(tri_env):
        for env in envs:
            users[env].add(index)
    remaining=set(range(len(tri_list)))
    while remaining:
        palette,triangles,candidates=[],[],set()
        chosen=min(remaining)
        while True:
            remaining.remove(chosen)
            triangles.append(tri_list[chosen])
            for env in tri_env[chosen]:
                if env not in palette:
                    palette.append(env)
                    candidates.update(users[env])
                users[env].discard(chosen)
            candidates.intersection_update(remaining)
            available=[]
            for index in candidates:
                added=sum(env not in palette for env in tri_env[index])
                if len(palette)+added<=10:
                    available.append((added,index))
            if len(triangles)>=21845:
                break
            if available:
                chosen=min(available)[1]
            elif len(palette)<=7 and remaining:
                chosen=min(remaining)
            else:
                break
        yield palette,triangles


def polygons(archive, mesh, skeleton):
    if len(mesh['positions']) > 65535:
        raise ValueError('GX INDEX16 vertex limit exceeded; simplify the source mesh')
    vertex_arrays = []
    for key in ('positions','normals','uv'):
        vertex_arrays.append(archive.append(np.asarray(mesh[key], dtype='>f4').tobytes(),32))
    desc = archive.alloc(5*24)
    # HSD_VtxDescList: attr/type/count/component enums, u8 frac, u16 stride, ptr.
    for i,(attr,kind,count,stride,ptr) in enumerate([
        (0,1,0,0,None), (9,3,1,12,vertex_arrays[0]),
        (10,3,0,12,vertex_arrays[1]), (13,3,1,8,vertex_arrays[2]), (255,0,0,0,None)]):
        p = desc+i*24
        archive.pack('4I',p,attr,kind,count,4)
        archive.pack('H',p+18,stride)
        archive.pointer(p+20,ptr)
    first, last, batch_count = None, None, 0
    for palette, tris in batches(mesh):
        table = archive.alloc((len(palette)+1)*4)
        for i,env in enumerate(palette):
            # HSD's single-weight fast path skips inverse binding on a
            # SKELETON_ROOT. Two equal entries force the general envelope path.
            if len(env) == 1:
                env = ((env[0][0],0.5),(env[0][0],0.5))
            envelope = archive.alloc((len(env)+1)*8)
            for k,(joint,weight) in enumerate(env):
                archive.pointer(envelope+k*8,skeleton[joint]['offset'])
                archive.pack('f',envelope+k*8+4,weight)
            archive.pointer(table+i*4,envelope)
        display = bytearray(struct.pack('>BH',0x90,len(tris)*3))
        for tri in tris:
            for vertex in tri:
                matrix = palette.index(mesh['envelopes'][vertex])*3
                display.extend(struct.pack('>BHHH',matrix,vertex,vertex,vertex))
        display.extend(b'\0'*(-len(display)%32))
        dl = archive.append(display,32)
        pobj = archive.alloc(24)
        archive.pointer(pobj+8,desc)
        archive.pack('HH',pobj+12,0x2000,len(display)//32)
        archive.pointer(pobj+16,dl)
        archive.pointer(pobj+20,table)
        if first is None:
            first = pobj
        if last is not None:
            archive.pointer(last+4,pobj)
        last = pobj
        batch_count += 1
    return first,batch_count


def cmpr(image):
    """Encode BC1, then convert its blocks to GX CMPR ordering and endianness."""
    from io import BytesIO
    width, height = image.size
    if width % 8 or height % 8 or max(width, height) > 1024:
        raise ValueError('GX CMPR needs dimensions divisible by 8, maximum 1024')
    encoded = BytesIO()
    image.convert('RGB').save(encoded, format='DDS', pixel_format='DXT1')
    blocks = np.frombuffer(encoded.getvalue()[128:], dtype=np.uint8).reshape(height//4, width//4, 8)
    blocks = blocks.reshape(height//8, 2, width//8, 2, 8).transpose(0, 2, 1, 3, 4).reshape(-1, 8)
    result = blocks[:, [1, 0, 3, 2, 4, 5, 6, 7]].copy()
    indices = result[:, 4:]
    result[:, 4:] = ((indices & 3) << 6) | ((indices & 12) << 2) | ((indices & 48) >> 2) | ((indices & 192) >> 6)
    return result.tobytes()


def material(archive, image, compressed=False):
    width,height = image.size
    pixels = archive.append(cmpr(image) if compressed else rgba8(image),32)
    im = archive.alloc(24)
    archive.pointer(im,pixels)
    archive.pack('HHI',im+4,width,height,14 if compressed else 6)
    tex = archive.alloc(92)
    archive.pack('II',tex+8,0,4)  # GX_TEXMAP0, GX_TG_TEX0
    archive.pack('3f',tex+28,1,1,1)
    archive.pack('II',tex+52,1,1)  # repeat S/T
    archive.pack('BB',tex+60,1,1)
    archive.pack('IfI',tex+64,FIGHTER_TEXTURE_FLAGS,1.0,1)  # diffuse replace, linear
    archive.pointer(tex+76,im)
    mat = archive.alloc(20)
    archive.pack('IIIff',mat,FIGHTER_MATERIAL_COLOR,FIGHTER_MATERIAL_COLOR,0,1.0,0.0)
    mobj = archive.alloc(24)
    archive.pack('I',mobj+4,LIT_TEXTURE_MODE)  # lit diffuse + TEX0, matte finish
    archive.pointer(mobj+8,tex)
    archive.pointer(mobj+12,mat)
    return mobj


def isolate_body_texture_animation(archive, symbol, dobj_index, image):
    """Keep fighter-required animation objects, but use custom texture frames.

    Fighter texture tables require the original animation ids/counts. Removing
    those objects asserts during load. Clone only the selected material's lists
    and replace its image frames, leaving other materials and gear untouched.
    """
    root=archive.roots().get(symbol.removesuffix('_joint')+'_matanim_joint')
    if root is None:return False
    field=root+8;node=archive.ptr(field)
    for index in range(dobj_index+1):
        if node is None:return False
        clone=archive.append(bytes(archive.data[node:node+16]))
        for offset in (0,4,8,12):archive.pointer(clone+offset,archive.ptr(node+offset))
        archive.pointer(field,clone)
        if index==dobj_index:
            texture=archive.ptr(clone+8);link=clone+8;seen=set()
            while texture is not None:
                if texture in seen:raise ValueError('Cyclic texture animation list')
                seen.add(texture);archive.check(texture,24)
                copied=archive.append(bytes(archive.data[texture:texture+24]))
                for offset in (0,8,12,16):archive.pointer(copied+offset,archive.ptr(texture+offset))
                archive.pointer(link,copied)
                count=archive.unpack('H',texture+20)[0]
                if count>4096:raise ValueError('Unreasonable texture animation frame count')
                if count:
                    table=archive.alloc(count*4)
                    for frame in range(count):archive.pointer(table+frame*4,image)
                    archive.pointer(copied+12,table)
                # The replacement image is RGBA8; old paletted frames do not apply.
                archive.pointer(copied+16,None);archive.pack('H',copied+22,0)
                link=copied;texture=archive.ptr(texture)
            return True
        field=clone;node=archive.ptr(node)
    return False


def replace_costume(archive, mesh, skeleton, profile):
    owner_index = profile['mesh_joint']
    if type(owner_index) is not int or not 0 <= owner_index < len(skeleton):
        raise ValueError('Invalid mesh_joint index')
    owner = skeleton[owner_index]
    # A root-space model avoids applying an animated owner transform twice.
    # Other owner modes need captured runtime matrices and are not guessed.
    if not owner['flags'] & 2:
        raise ValueError('mesh_joint must be an existing HSD SKELETON_ROOT model owner')
    if owner['dobj'] is None:
        raise ValueError('mesh_joint must already own a DObj (preserve fighter DObj indexing)')
    dobj_index = profile.get('mesh_dobj',0)
    selected = None
    visited = set()
    from .target_presentation import ATTACHMENTS
    from .costume_forms import form_joints, VERSION as FORMS_VERSION
    attachments=profile.get('preserve_attachment_joints',ATTACHMENTS.get(profile.get('base_fighter'), []))
    retained = set(attachments) | set(form_joints(profile))
    if any(type(i) is not int or not 0 <= i < len(skeleton) for i in attachments):
        raise ValueError('Invalid preserved attachment joint')
    for j in skeleton:
        d, index = j['dobj'],0
        while d is not None:
            if d in visited:
                raise ValueError('Shared/cyclic DObj lists unsupported')
            visited.add(d)
            archive.check(d,16)
            if j['index'] == owner['index'] and index == dobj_index:
                selected = d
            # Keep every DObj and its material descriptor alive for fighter
            # material/visibility tables; suppress only its original geometry.
            if j['index'] not in retained:
                archive.pointer(d+12,None)
            d = archive.ptr(d+4)
            index += 1
    from .target_presentation import transform_rigid_attachment, attachment_transform
    for index in attachments:
        transform=attachment_transform(skeleton,profile.get('base_fighter'),index,profile)
        transform_rigid_attachment(archive,skeleton[index],[0.,0.,0.],transform=transform)
    if selected is None:
        raise ValueError('mesh_dobj does not exist on mesh_joint')
    if profile.get('browser_skinning'):
        from .browser_skin import polygons as browser_polygons
        pobj,count = browser_polygons(archive,mesh,skeleton)
    else:
        pobj,count = polygons(archive,mesh,skeleton)
    archive.pointer(selected+12,pobj)
    old_material = archive.ptr(selected+8)
    old_texture = archive.ptr(old_material+8) if old_material is not None else None
    replacement = material(archive,mesh['image'], profile.get('compressed_body_texture', False))
    texture = archive.ptr(replacement+8)
    # Fighter texture-animation tables address textures by traversal index.
    # Preserve every slot (DK has two on this material) even though only the
    # first supplies the custom mesh's diffuse color.
    while old_texture is not None:
        archive.pack('I',texture+8,archive.unpack('I',old_texture+8)[0])
        old_texture = archive.ptr(old_texture+4)
        if old_texture is not None:
            extra = archive.append(bytes(archive.data[texture:texture+92]))
            for offset in (0,4,76,80,88):
                archive.pointer(extra+offset,archive.ptr(texture+offset))
            archive.pack('I',extra+64,0)
            archive.pointer(texture+4,extra)
            texture = extra
    archive.pointer(selected+8,replacement)
    if profile.get('isolate_body_texture_animation'):
        if owner_index!=0:raise ValueError('Material animation isolation currently requires the root DObj')
        isolate_body_texture_animation(archive,profile['symbol'],dobj_index,archive.ptr(archive.ptr(archive.ptr(selected+8)+8)+76))
    if "presentation" in mesh:
        from .presentation import attach, portrait_fit
        portrait=portrait_fit(mesh,skeleton,profile)
        attach(archive,selected,mesh["presentation"],portrait,profile.get("stature"))
        if dobj_index != 0:
            # Hot-path identity lookup reads the first root material. Preserve
            # its native animation inputs and mirror only presentation data.
            attach(archive,owner['dobj'],mesh["presentation"],portrait,profile.get("stature"))
    # Preserve all skeleton flags; enable normals for the custom model owner.
    archive.pack('I',owner['offset']+4,owner['flags'] | 0x80)
    return dict(texture_slot_version=1,costume_forms_version=FORMS_VERSION,vertices=len(mesh['positions']),triangles=len(mesh['triangles']),
                draw_batches=count,unique_envelopes=len(set(mesh['envelopes'])),
                preserved_joints=len(skeleton),preserved_dobjs=len(visited))
