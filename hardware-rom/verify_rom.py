#!/usr/bin/env python3
"""Independently audit baked ROM tables, dependencies and emitted display lists."""
import argparse
import json
from pathlib import Path
import struct

TABLE = 0x1AC870
COUNT = 2132
DATA = TABLE + (COUNT + 1)*12
ENTRY = struct.Struct('>IHHHH')


def walk(raw, first, internal):
    result = {}
    while first != 65535:
        offset = first*4
        assert offset not in result and offset+4 <= len(raw), 'Bad pointer chain'
        first, target = struct.unpack_from('>HH', raw, offset)
        if internal:
            assert target*4 <= len(raw), 'Internal pointer outside model'
        result[offset] = target*4
    return result


def verify(base, rom, fids, loadout=None, skinning=False):
    assert len(rom) <= 64*1024*1024 and len(rom) & (len(rom)-1) == 0
    from presentation import MENU_SCALE_TABLE, CTL, TBL, MODELS, EMBLEMS, EMBLEM_TABLES, voice_info
    table = [ENTRY.unpack_from(rom, TABLE+i*12) for i in range(COUNT+1)]
    old = [ENTRY.unpack_from(base, TABLE+i*12) for i in range(COUNT+1)]
    # All replacement assets can be resident together in character select.
    growth = sum(max(0,new[4]-prev[4])*4 for new,prev in zip(table[:-1],old[:-1]))
    if skinning:
        from skinning.patches import patches, crc6103, ASSET_GROWTH_BUDGET
    assert growth <= (ASSET_GROWTH_BUDGET if skinning else 352*1024), 'Character-select asset growth exceeds conservative budget'
    expected = bytearray(base)
    extra_files = {163} if skinning else set()
    common=None
    if skinning:
        ce=table[163];cs=DATA+(ce[0]&0x7fffffff)
        assert not ce[0]&0x80000000
        common=rom[cs:cs+ce[4]*4]
    for fighter in loadout or []:
        fk = MODELS.index(fighter['model_file'])
        factor = fighter.get('menu_scale',1)
        assert .5 <= factor <= 2
        at = MENU_SCALE_TABLE+fk*4
        struct.pack_into('>f',expected,at,struct.unpack_from('>f',base,at)[0]*factor)
        if fighter.get('ui'):
            extra_files.update([12,17,19])
            if fk == 2:
                extra_files.add(319)
            # Only per-fighter CSS tables may redirect to new emblem sprites.
            offsets = [struct.unpack_from('>I', rom, t+4*fk)[0] for t in EMBLEM_TABLES]
            assert len(set(offsets)) == 1, 'Inconsistent menu emblems'
            if offsets[0] != EMBLEMS[fk]:
                extra_files.add(20)
                sprite = offsets[0]
                e = table[20]
                assert old[20][4]*4 <= sprite <= e[4]*4-68
                start = DATA+(e[0]&0x7fffffff)
                raw = rom[start:start+e[4]*4]
                ptrs = walk(raw,e[1],True)
                assert tuple(raw[sprite+48:sprite+50]) == (4,0)
                assert sprite+52 in ptrs and ptrs[sprite+52]+8 in ptrs
                assert struct.unpack_from('>hh',raw,sprite+4) == (64,48)
                for t in EMBLEM_TABLES:
                    assert struct.unpack_from('>I',base,t+4*fk)[0] == EMBLEMS[fk]
                    struct.pack_into('>I', expected,t+4*fk,sprite)
        if fighter.get('voice'):
            wt, info, ratio = voice_info(base,fk)
            offset, length = struct.unpack_from('>II',rom,CTL+wt)
            start = TBL+offset
            assert DATA+(table[-1][0]&0x7fffffff) <= start < start+length <= len(rom)
            assert start % 16 == 0 and length > 0 and length % 9 == 0
            # Every ADPCM frame references an existing predictor and legal scale.
            headers = rom[start:start+length:9]
            assert all(h>>4 <= 12 and h&15 < info['npredictors'] for h in headers)
            expected[CTL+wt:CTL+wt+8] = rom[CTL+wt:CTL+wt+8]

    for patch in json.loads(Path(__file__).with_name('unlock-patches.json').read_text()):
        offset = int(patch['rom_offset'], 16)
        assert struct.unpack_from('>I', expected, offset)[0] == int(patch['expected'], 16)
        struct.pack_into('>I', expected, offset, int(patch['replacement'], 16))
    if skinning:
        for at,old_bytes,new_bytes in patches(base):
            assert expected[at:at+len(old_bytes)]==old_bytes
            expected[at:at+len(new_bytes)]=new_bytes
        expected[0x10:0x18]=crc6103(expected)
    assert expected[:TABLE] == rom[:TABLE], 'Unexpected game code/header change'
    assert expected[DATA:] == rom[DATA:len(base)], 'Original non-table data changed'
    totals = {}
    for fid, entry in enumerate(table[:-1]):
        start = DATA+(entry[0]&0x7fffffff)
        end = DATA+(table[fid+1][0]&0x7fffffff)
        assert len(base) <= start <= end <= len(rom)
        assert start % 2 == 0 and end % 2 == 0
        blob = rom[start:end]
        prev = old[fid]
        a = DATA+(prev[0]&0x7fffffff)
        b = DATA+(old[fid+1][0]&0x7fffffff)
        if fid not in set(fids) | extra_files:
            assert blob == base[a:b] and entry[1:] == prev[1:]
            continue
        assert not entry[0]&0x80000000 and entry[2] == entry[4]
        raw = blob[:entry[4]*4]
        assert blob[entry[2]*4:] == base[a+prev[2]*4:b], 'External file IDs changed'
        pointers = walk(raw, entry[1], True)
        walk(raw, entry[3], False)
        if fid not in fids:
            continue
        if skinning:
            from skinning.audit import audit_model
            totals[fid]=audit_model(raw,pointers,common)
            continue
        # Appended DLs start with PipeSync, TextureOff, GeometryMode, Combine.
        count = 0
        for at in range(prev[4]*4, len(raw)-32, 8):
            if raw[at:at+32] != bytes.fromhex('e700000000000000d700000000000000d9f1f9ff00200004fcfffffffffe793c'):
                continue
            cursor = at+32
            vertex_count = 0
            texture_size = 0
            while True:
                w0, w1 = struct.unpack_from('>II', raw, cursor)
                op = w0 >> 24
                if op == 0xDF:
                    break
                if op == 1:
                    vertex_count = (w0 >> 12)&255
                    assert 0 < vertex_count <= 32
                    assert (w0 & 255)//2 == vertex_count
                    offset = pointers[cursor+4]
                    assert offset % 8 == 0 and offset+vertex_count*16 <= len(raw)
                elif op == 5:
                    idx = [(w0 >> shift)&255 for shift in (16,8,0)]
                    assert all(i%2 == 0 and i//2 < vertex_count for i in idx)
                    count += 1
                elif op == 0xFD:
                    texture_size = (w0 & 0xfff)+1
                    assert w0 >> 12 == 0xFD100 and texture_size in (4,8,12)
                    offset = pointers[cursor+4]
                    assert offset % 8 == 0 and offset+texture_size**2*2 <= len(raw)
                elif op == 0xF5:
                    assert texture_size and w0 == (0xF5100000|((texture_size//4)<<9))
                    assert w1 in (0x07080200,0x00080200)
                elif op in (0xF4,0xF2):
                    extent=((texture_size-1)*4<<12)|((texture_size-1)*4)
                    assert texture_size and w0 == op<<24
                    assert w1 == (extent | (0x07000000 if op==0xF4 else 0))
                elif op in (0xE7,0xE6):
                    assert w0 == op<<24 and w1 == 0
                elif op == 0xD7:
                    assert (w0,w1) in [(0xD7000000,0),(0xD7000002,0xffffffff)]
                elif op == 0xFC:
                    assert w0 == 0xFCFFFFFF and w1 in (0xFFFE793C,0xFFFCF238)
                else:
                    raise AssertionError(f'Unexpected emitted GBI opcode {op:x}')
                cursor += 8
            assert cursor < len(raw)
        assert count > 0
        totals[fid] = count
    return totals


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('base', type=Path)
    ap.add_argument('rom', type=Path)
    ap.add_argument('--skinning', action='store_true')
    ap.add_argument('--models', type=int, nargs='+', default=[296,323,332])
    ap.add_argument('--loadout', type=Path, help='Read model IDs from a generated loadout')
    args = ap.parse_args()
    loadout = json.loads(args.loadout.read_text()) if args.loadout else None
    if loadout is not None:
        args.models = [c['model_file'] for c in loadout]
    print('PASS:', verify(args.base.read_bytes(), args.rom.read_bytes(), args.models, loadout, args.skinning))
