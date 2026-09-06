#!/usr/bin/env python3
"""Bake rigid OSB5 fighters with textured heads into an owned NTSC-U SSB64 ROM."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile

from face_textures import SurfaceSampler, shade_equivalent
from presentation import MENU_SCALE_TABLE, MODELS, Reloc, bake_voice, patch_ui, symbols

import fast_simplification
import numpy as np
from scipy.spatial import cKDTree

SHA1 = 'e2929e10fccc0aa84e5776227e798abc07cedabf'
TABLE = 0x1AC870
COUNT = 2132
DATA = TABLE + (COUNT + 1) * 12
ENTRY = struct.Struct('>IHHHH')
VERT = struct.Struct('<fffhhBBBBBBBBbbbB')


def read_osb(path):
    b = path.read_bytes()
    if b[:4] != b'OSB5':
        raise ValueError('Expected standalone OSB5 input')
    nj, nv, nt, w, h = struct.unpack_from('<5I', b, 4)
    joints = struct.unpack_from('<' + 'I' * nj, b, 24)
    at = 24 + nj * 4
    texture = np.frombuffer(b[at:at+w*h*2], dtype='>u2').reshape(h, w)
    at += w*h*2
    verts = np.array(list(VERT.iter_unpack(b[at:at+nv*28])))
    at += nv*28
    faces = np.frombuffer(b[at:at+nt*8], dtype='<u2').reshape(nt, 4)[:, :3].copy()
    at += nt*8
    if b[at:at+4] != b'BIND':
        raise ValueError('Requires embedded BIND frames')
    frames = np.frombuffer(b[at+4:at+4+nj*48], dtype='<f4').reshape(nj, 12)
    if faces.max() >= nv or not np.isfinite(verts).all():
        raise ValueError('Invalid mesh')
    s = np.clip((verts[:, 3]/32).astype(int), 0, w-1)
    t = np.clip((verts[:, 4]/32).astype(int), 0, h-1)
    texels = texture[t, s].astype(np.uint32)
    colors = np.stack([(texels >> shift) & 31 for shift in (11, 6, 1)], axis=1)*255/31
    return joints, verts, faces, frames, colors


def chain(blob, start):
    result = {}
    while start != 0xFFFF:
        at = start * 4
        if at in result or at + 4 > len(blob):
            raise ValueError('Invalid relocation chain')
        nxt, target = struct.unpack_from('>HH', blob, at)
        result[at] = target * 4
        start = nxt
    return result


def bind_to_local(frame, points):
    # The writer already transposes its basis-vector array into jm rows.
    # Match ftport.c's BIND reader and inverse-matrix multiply verbatim.
    matrix = frame[3:].reshape(3, 3)
    return np.linalg.solve(matrix, (points - frame[:3]).T).T


def mesh_parts(path, budget, face_texture_size=0):
    joints, verts, faces, frames, colors = read_osb(path)
    sampler = None
    head_joint = joints[int(np.argmax(frames[:,1]))]
    if face_texture_size:
        data = path.read_bytes()
        w,h = struct.unpack_from('<2I',data,16)
        at = 24+len(joints)*4
        sampler = SurfaceSampler(verts,faces,np.frombuffer(data[at:at+w*h*2],dtype='>u2').reshape(h,w))
    # Weld UV seam duplicates before QEM; recover color/weights spatially.
    points, inverse = np.unique(np.round(verts[:, :3], 4), axis=0, return_inverse=True)
    indices = inverse[faces].astype(np.int32)
    points, indices = fast_simplification.simplify(points, indices, target_count=min(budget, len(indices)))
    if len(indices) > budget:
        raise ValueError('Simplifier exceeded triangle budget')
    nearest = cKDTree(verts[:, :3]).query(points)[1]
    parts = {j: [] for j in joints}
    for tri in indices:
        source = nearest[tri]
        scores = np.zeros(len(joints))
        for vi in source:
            for ji, weight in zip(verts[vi, 5:9].astype(int), verts[vi, 9:13]):
                scores[ji] += weight
        ji = int(scores.argmax())
        frame = frames[ji]
        local = bind_to_local(frame, points[tri])
        if not np.isfinite(local).all() or np.abs(local).max() > 32767:
            raise ValueError('Joint-local vertex outside signed 16-bit range')
        triangle = (np.rint(local).astype(int), colors[source].astype(int))
        if sampler is not None and joints[ji] == head_joint:
            tile = sampler.tile(points[tri],face_texture_size)
            shading = shade_equivalent(tile,face_texture_size)
            if shading is not None:
                triangle = (triangle[0],shading)
            else:
                triangle += ((face_texture_size,tile),)
        parts[joints[ji]].append(triangle)
    return parts, len(faces), len(indices)


def patch_model(raw, entry, source, parts, main_source):
    blob = bytearray(raw)
    internal = chain(blob, entry[1])
    external = chain(blob, entry[3])
    trees = [int(x, 16) for x in re.findall(r'DObjDesc: JointTree[^@\n]*@ (0x[0-9A-Fa-f]+)', source)]
    trees = list(dict.fromkeys(trees))
    if len(trees) < 2:
        raise ValueError(f'Expected high/low detail joint trees, found {trees}')

    # Later trees are move-specific props/forms, not the normal body skeleton.
    trees = trees[:2]

    def command(w0, w1):
        blob.extend(struct.pack('>II', w0, w1))

    dl_by_joint = {}
    for joint, triangles in parts.items():
        while len(blob) % 8:
            blob.append(0)
        batches = []
        # Textured triangles each carry a small independent tile. The rest
        # keep the original 30-vertex batches and vertex colors.
        # Draw shaded triangles first, in batches, then textured triangles.
        # This also avoids carrying texture state into shaded head geometry.
        shaded = [t for t in triangles if len(t)==2]
        textured = [t for t in triangles if len(t)==3]
        chunks = [shaded[i:i+10] for i in range(0,len(shaded),10)] + [[t] for t in textured]
        for batch in chunks:
            texture = batch[0][2] if len(batch[0])==3 else None
            tex_offset = None
            if texture:
                tex_offset = len(blob)
                blob.extend(texture[1])
            offset = len(blob)
            for triangle in batch:
                positions, colors = triangle[:2]
                coords = [(32,32),((texture[0]-2)*32,32),(32,(texture[0]-2)*32)] if texture else [(0,0)]*3
                for p,c,uv in zip(positions,colors,coords):
                    blob.extend(struct.pack('>hhhHhhBBBB',*p,0,*uv,*(c if not texture else (255,255,255)),255))
            batches.append((offset,len(batch),tex_offset,texture[0] if texture else 0))
        dl_by_joint[joint] = len(blob)
        command(0xE7000000, 0)  # Pipe sync
        command(0xD7000000, 0)  # Texture off
        command(0xD9F1F9FF, 0x00200004)  # Clear lighting/texgen/culling; smooth shade
        command(0xFCFFFFFF, 0xFFFE793C)  # G_CC_SHADE
        for offset,n,tex_offset,size in batches:
            if tex_offset is not None:
                command(0xE7000000,0)
                command(0xD7000002,0xFFFFFFFF)
                # ftDisplayMain uses G_CYC_2CYCLE. The second cycle must
                # pass COMBINED through; TEXEL0 there samples tile+1.
                command(0xFCFFFFFF,0xFFFCF238)  # DECALRGBA, PASS2
                at=len(blob)
                command(0xFD100000|(size-1),0)  # RGBA16 texture image
                internal[at+4]=tex_offset
                # LoadTile handles row swizzling in TMEM. Unlike sprite
                # LoadBlock(dxt=0), its source bytes must remain linear.
                command(0xF5100000|((size//4)<<9),0x07080200)
                command(0xE6000000,0)
                extent=((size-1)*4<<12)|((size-1)*4)
                command(0xF4000000,0x07000000|extent)
                command(0xE7000000,0)
                command(0xF5100000|((size//4)<<9),0x00080200)
                command(0xF2000000,extent)
            at = len(blob)
            command(0x01000000 | ((n*3) << 12) | ((n*3) << 1), 0)
            internal[at+4] = offset
            for ti in range(n):
                a = ti*6
                command(0x05000000 | (a << 16) | ((a+2) << 8) | (a+4), 0)
        if any(size for _,_,_,size in batches):
            command(0xE7000000,0)
            command(0xD7000000,0)
            command(0xFCFFFFFF,0xFFFE793C)
        command(0xDF000000, 0)
    original_dls = {}
    for tree in trees:
        for i in range(64):
            at = tree + i*44
            depth = struct.unpack_from('>I', blob, at)[0]
            if depth == 18:
                break
            joint = i + 4
            # Keep original DL address as trampoline: animation model-part
            # changes referencing this same DL also inherit the replacement.
            old = internal.get(at+4)
            if joint in dl_by_joint:
                internal[at+4] = dl_by_joint[joint]
                if old is not None:
                    original_dls[old] = dl_by_joint[joint]
                    struct.pack_into('>II', blob, old, 0xDE010000, 0)
                    internal[old+4] = dl_by_joint[joint]
                    if old+4 in external:
                        raise ValueError('Trampoline overlaps external relocation')
        else:
            raise ValueError('Unterminated joint tree')
    # Route animated open/closed hands to the same rigid hand mesh. The
    # supported source layouts name DL offsets explicitly, including gaps.
    # The engine's sources contain JP alternatives; this exporter targets US.
    main_source = re.sub(r'#if defined\(REGION_JP\)(.*?)#endif',
                         lambda m: m[1].partition('#else')[2], main_source, flags=re.S)
    for body in re.findall(r'FTModelPart \w+\[\d+\] = \{(.*?)\n\};', main_source, re.S):
        symbols = re.findall(r'\{\s*\(Gfx\*\)&(\w+)', body)
        offsets = [sum(int(x, 16) for x in re.findall(r'0x[0-9A-Fa-f]+', symbol)) for symbol in symbols]
        if not offsets or offsets[0] not in original_dls:
            # Separate weapon/accessory tables (Ness bat, Fox gun, Link
            # sword/shield) are not a replaced body joint. Keep them vanilla.
            continue
        for offset in offsets:
            if offset+8 > len(raw) or offset+4 in external:
                raise ValueError('Invalid alternate model-part address')
            struct.pack_into('>II', blob, offset, 0xDE010000, 0)
            internal[offset+4] = original_dls[offsets[0]]
    for pointers in (internal, external):
        offsets = sorted(pointers) if pointers is internal else list(pointers)
        for i, at in enumerate(offsets):
            nxt = offsets[i+1]//4 if i+1 < len(offsets) else 0xFFFF
            target = pointers[at]//4
            if max(nxt, target) > 0xFFFF:
                raise ValueError('Relocation exceeds 16-bit word range')
            struct.pack_into('>HH', blob, at, nxt, target)
    if len(blob) % 4 or len(blob)//4 > 0xFFFF:
        raise ValueError('Model exceeds reloc file limit')
    return blob, min(internal)//4, min(external)//4 if external else 0xFFFF


def build(args):
    if args.output.resolve() == args.rom.resolve():
        raise ValueError('Output must not overwrite the base ROM')
    original = args.rom.read_bytes()
    if hashlib.sha1(original).hexdigest() != SHA1:
        raise ValueError('Requires unmodified NTSC-U v1.0 ROM')
    entries = [list(ENTRY.unpack_from(original, TABLE+i*12)) for i in range(COUNT+1)]
    output = bytearray(original)
    report = []
    loadout = json.loads(args.loadout.read_text())
    skinning = getattr(args,'skinning',True)
    module = None
    replacements = {}
    edited = {}
    suffixes = {}
    byte_patches = []

    def patch(offset, expected, replacement):
        if output[offset:offset+len(expected)] != expected or len(expected) != len(replacement):
            raise ValueError(f'Presentation patch preimage mismatch at {offset:#x}')
        output[offset:offset+len(expected)] = replacement
        byte_patches.append(dict(offset=offset, expected=expected.hex(), replacement=replacement.hex()))

    if skinning:
        from skinning.toolchain import compile_modules
        from skinning.export import weighted_mesh, patch_skin_model
        from skinning.patches import patches, MODEL_GROWTH_BUDGET, ASSET_GROWTH_BUDGET, crc6103
        module=compile_modules(args.decomp,args.output.parent/'mips-runtime')
        for at,old,new in patches(original):patch(at,old,new)
    with tempfile.TemporaryDirectory() as tmp:
        def get(fid):
            if fid in edited:
                return edited[fid]
            entry = entries[fid]
            start = DATA + (entry[0] & 0x7FFFFFFF)
            end = DATA + (entries[fid+1][0] & 0x7FFFFFFF)
            packed = original[start:end]
            if entry[0] & 0x80000000:
                src, dst = Path(tmp)/'asset.vpk0', Path(tmp)/'asset.bin'
                src.write_bytes(packed[:entry[2]*4])
                subprocess.run([str(args.vpk0 or args.decomp/'tools/vpk0cmd'), 'd', str(src), str(dst)], check=True, stdout=subprocess.DEVNULL)
                raw = dst.read_bytes()
            else:
                raw = packed[:entry[4]*4]
            if len(raw) != entry[4]*4:
                raise ValueError('Decompressed size mismatch')
            edited[fid] = Reloc(raw, chain(raw, entry[1]), chain(raw, entry[3]))
            suffixes[fid] = packed[entry[2]*4:]
            return edited[fid]

        shared_growth = 0
        def share_runtime(selected):
            nonlocal shared_growth
            if 'shared_offset' in selected:return
            common=get(163)
            original_size=len(common.data)
            common.data.extend(bytes((-len(common.data))%16))
            header=common.append(bytes(16))
            code_at=common.append(selected['code'])
            struct.pack_into('>4I',common.data,header,0x534b4331,selected['joint_cap'],len(selected['code']),code_at)
            for at,target in selected['relocations'].items():common.internal[code_at+at]=code_at+target
            if common.internal and max(common.internal.values())>len(common.data):
                common.data.extend(bytes(max(common.internal.values())-len(common.data)))
            selected['shared_offset']=code_at
            shared_growth+=len(common.data)-original_size

        seen = set()
        sym = symbols(args.decomp) if any(f.get('ui') for f in loadout) else {}
        for fighter in loadout:
            fid = fighter['model_file']
            if fid in seen:
                raise ValueError('Duplicate model file in loadout')
            seen.add(fid)
            menu_scale = fighter.get('menu_scale',1.0)
            if not .5 <= menu_scale <= 2:
                raise ValueError('menu_scale must be between 0.5 and 2')
            if menu_scale != 1:
                scale_at = MENU_SCALE_TABLE+MODELS.index(fid)*4
                scale = struct.unpack_from('>f',original,scale_at)[0]
                patch(scale_at,original[scale_at:scale_at+4],struct.pack('>f',scale*menu_scale))
            model = get(fid)
            raw = bytes(model.data)
            asset = args.assets / fighter['asset']
            requested = fighter.get('face_texture_size',12)
            if requested not in (0,4,8,12):
                raise ValueError('face_texture_size must be 0, 4, 8, or 12')
            source = (args.decomp/'src/relocData'/fighter['model_source']).read_text()
            main_source = (args.decomp/'src/relocData'/fighter['main_source']).read_text()
            # CSS loads every fighter, not merely the four active players.
            # Share a conservative model-growth budget across the loadout.
            model_budget = (MODEL_GROWTH_BUDGET if skinning else 320*1024) // len(loadout)
            if skinning:
                used=sum(max(0,f['model_bytes_after']-f['model_bytes_before']) for f in report)
                model_budget=(MODEL_GROWTH_BUDGET-used)//(len(loadout)-len(report))
            try:
                for size in (12,8,4,0):
                    if size > requested:
                        continue
                    skin_stats={}
                    if skinning:
                        mesh=weighted_mesh(asset,args.triangles,size)
                        selected=module['wide'] if len(mesh['joints'])>16 else module
                        share_runtime(selected)
                        model_budget=(MODEL_GROWTH_BUDGET-used-shared_growth)//(len(loadout)-len(report))
                        before,after=mesh['source_faces'],mesh['triangles']
                    else:
                        parts, before, after = mesh_parts(asset,args.triangles,size)
                    try:
                        if skinning:
                            blob,intern,extern,skin_stats=patch_skin_model(raw,entries[fid],source,main_source,mesh,size,module)
                        else:
                            blob, intern, extern = patch_model(raw, entries[fid], source, parts, main_source)
                    except ValueError as exc:
                        if str(exc) not in ('Relocation exceeds 16-bit word range','Model exceeds reloc file limit'):
                            raise
                        continue
                    if len(blob)-len(raw) <= model_budget:
                        break
                else:
                    raise ValueError('Loadout exceeds the character-select model budget; reduce --triangles or select fewer fighters')
                edited[fid] = Reloc(blob, chain(blob, intern), chain(blob, extern))
                presentation = patch_ui(fighter, args.assets, get, sym, patch) if fighter.get('ui') else {}
            except ValueError as exc:
                raise ValueError(f'{fighter["name"]} on {fighter["slot"]}: {exc}') from exc
            report.append(dict(fighter, source_sha256=hashlib.sha256(asset.read_bytes()).hexdigest(), triangles_before=before, triangles_after=after, face_texture_size=size, textured_triangles=skin_stats.get('textured_triangles',0) if skinning else sum(len(t)==3 for ts in parts.values() for t in ts), skinning=skin_stats if skinning else None, model_bytes_before=len(raw), model_bytes_after=len(blob), presentation=presentation))
        for fid, reloc in edited.items():
            blob, intern, extern = reloc.finish()
            replacements[fid] = (blob + suffixes[fid], intern, extern, len(blob)//4)
    asset_growth = sum(max(0,r[3]*4-entries[fid][4]*4) for fid,r in replacements.items())
    asset_budget = ASSET_GROWTH_BUDGET if skinning else 352*1024
    if asset_growth > asset_budget:
        raise ValueError('Loadout exceeds the character-select asset budget; reduce --triangles or select fewer fighters')
    # Move ALL file bodies together so next-entry offsets remain meaningful
    # to the game's recursive external-dependency heap sizing. Keep original
    # audio/particle ROM addresses untouched by appending after the base ROM.
    for i in range(COUNT):
        entry = entries[i]
        old_start = DATA+(entry[0] & 0x7FFFFFFF)
        old_end = DATA+(entries[i+1][0] & 0x7FFFFFFF)
        new_entry = entry.copy()
        new_entry[0] = len(output)-DATA
        if i in replacements:
            blob, intern, extern, words = replacements[i]
            new_entry[1:] = [intern, words, extern, words]
        else:
            blob = original[old_start:old_end]
            new_entry[0] |= entry[0] & 0x80000000
        ENTRY.pack_into(output, TABLE+i*12, *new_entry)
        output.extend(blob)
    ENTRY.pack_into(output, TABLE+COUNT*12, len(output)-DATA, *entries[-1][1:])
    for fighter, item in zip(loadout, report):
        if fighter.get('voice'):
            print(f"Encoding announcer: {fighter['name']}", flush=True)
            item['presentation'].update(bake_voice(original, output, fighter, args.assets, patch))
    size = 1 << (len(output)-1).bit_length()
    if size > 64*1024*1024:
        raise ValueError('ROM exceeds 64 MiB')
    output.extend(b'\xff'*(size-len(output)))
    patches = json.loads(Path(__file__).with_name('unlock-patches.json').read_text())
    for patch in patches:
        offset = int(patch['rom_offset'], 16)
        if struct.unpack_from('>I', output, offset)[0] != int(patch['expected'], 16):
            raise ValueError('Character-selection patch preimage mismatch')
        struct.pack_into('>I', output, offset, int(patch['replacement'], 16))
    if skinning:
        output[0x10:0x18]=crc6103(output)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output)
    # The four selection-mask instructions lie beyond the CIC checksum range.
    if not skinning:
        assert output[0x1000:0x101000] == original[0x1000:0x101000]
    # Additional model bytes loaded for any four distinct fighter kinds.
    # This excludes vanilla scene heaps and is not a hardware RAM guarantee.
    deltas = sorted((r['model_bytes_after']-r['model_bytes_before'] for r in report), reverse=True)
    result = dict(presentation_patches=byte_patches, replaced_files=sorted(replacements), max_four_fighter_model_growth_bytes=sum(deltas[:4]), all_fighter_model_growth_bytes=sum(deltas), character_select_asset_growth_bytes=asset_growth, character_select_asset_growth_budget_bytes=asset_budget, rom_sha256=hashlib.sha256(output).hexdigest(), rom_bytes=len(output), loadout=report, validation='Built; emulator and physical hardware validation pending')
    args.output.with_suffix('.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--rom', type=Path, required=True)
    ap.add_argument('--decomp', type=Path, required=True)
    ap.add_argument('--vpk0', type=Path, help='Path to vpk0cmd (default: decomp/tools/vpk0cmd)')
    ap.add_argument('--assets', type=Path, required=True)
    ap.add_argument('--loadout', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--triangles', type=int)
    ap.add_argument('--skinning', action=argparse.BooleanOptionalAction, default=True, help='Use skeletal skinning (default); --no-skinning selects rigid joints')
    args = ap.parse_args()
    if args.triangles is None:
        args.triangles = 700
    if not 32 <= args.triangles <= 2000:
        ap.error('Triangle budget must be between 32 and 2000')
    build(args)
