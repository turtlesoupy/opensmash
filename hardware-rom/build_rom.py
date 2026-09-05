#!/usr/bin/env python3
"""Bake rigid, vertex-colored OSB5 fighters into an owned NTSC-U SSB64 ROM."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile

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


def mesh_parts(path, budget):
    joints, verts, faces, frames, colors = read_osb(path)
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
        parts[joints[ji]].append((np.rint(local).astype(int), colors[source].astype(int)))
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
        for start in range(0, len(triangles), 10):
            batch = triangles[start:start+10]
            offset = len(blob)
            for positions, colors in batch:
                for p, c in zip(positions, colors):
                    blob.extend(struct.pack('>hhhHhhBBBB', *p, 0, 0, 0, *c, 255))
            batches.append((offset, len(batch)))
        dl_by_joint[joint] = len(blob)
        command(0xE7000000, 0)  # Pipe sync
        command(0xD7000000, 0)  # Texture off
        command(0xD9F1F9FF, 0x00200004)  # Clear lighting/texgen/culling; smooth shade
        command(0xFCFFFFFF, 0xFFFE793C)  # G_CC_SHADE, G_CC_SHADE
        for offset, n in batches:
            at = len(blob)
            command(0x01000000 | ((n*3) << 12) | ((n*3) << 1), 0)
            internal[at+4] = offset
            for ti in range(n):
                a = ti*6
                command(0x05000000 | (a << 16) | ((a+2) << 8) | (a+4), 0)
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
    replacements = {}
    with tempfile.TemporaryDirectory() as tmp:
        for fighter in loadout:
            fid = fighter['model_file']
            if fid in replacements:
                raise ValueError('Duplicate model file in loadout')
            entry = entries[fid]
            start = DATA + (entry[0] & 0x7FFFFFFF)
            end = DATA + (entries[fid+1][0] & 0x7FFFFFFF)
            packed = original[start:end]
            if entry[0] & 0x80000000:
                src, dst = Path(tmp)/'model.vpk0', Path(tmp)/'model.bin'
                src.write_bytes(packed[:entry[2]*4])
                subprocess.run([str(args.vpk0 or args.decomp/'tools/vpk0cmd'), 'd', str(src), str(dst)], check=True, stdout=subprocess.DEVNULL)
                raw = dst.read_bytes()
            else:
                raw = packed[:entry[4]*4]
            if len(raw) != entry[4]*4:
                raise ValueError('Decompressed size mismatch')
            asset = args.assets / fighter['asset']
            parts, before, after = mesh_parts(asset, args.triangles)
            source = (args.decomp/'src/relocData'/fighter['model_source']).read_text()
            main_source = (args.decomp/'src/relocData'/fighter['main_source']).read_text()
            try:
                blob, intern, extern = patch_model(raw, entry, source, parts, main_source)
            except ValueError as exc:
                raise ValueError(f'{fighter["name"]} on {fighter["slot"]}: {exc}') from exc
            replacements[fid] = (blob + packed[entry[2]*4:], intern, extern, len(blob)//4)
            report.append(dict(fighter, source_sha256=hashlib.sha256(asset.read_bytes()).hexdigest(), triangles_before=before, triangles_after=after, model_bytes_before=len(raw), model_bytes_after=len(blob)))
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
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output)
    # The four selection-mask instructions lie beyond the CIC checksum range.
    assert output[0x1000:0x101000] == original[0x1000:0x101000]
    # Additional model bytes loaded for any four distinct fighter kinds.
    # This excludes vanilla scene heaps and is not a hardware RAM guarantee.
    deltas = sorted((r['model_bytes_after']-r['model_bytes_before'] for r in report), reverse=True)
    result = dict(max_four_fighter_model_growth_bytes=sum(deltas[:4]), rom_sha256=hashlib.sha256(output).hexdigest(), rom_bytes=len(output), loadout=report, validation='Built; emulator and physical hardware validation pending')
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
    ap.add_argument('--triangles', type=int, default=700)
    args = ap.parse_args()
    if not 32 <= args.triangles <= 2000:
        ap.error('Triangle budget must be between 32 and 2000')
    build(args)
