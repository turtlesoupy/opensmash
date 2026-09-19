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


def verify(base, rom, fids, loadout=None):
    assert len(rom) <= 64*1024*1024 and len(rom) & (len(rom)-1) == 0
    from presentation import MENU_SCALE_TABLE, CTL, TBL, MODELS, EMBLEMS, EMBLEM_TABLES, voice_info
    table = [ENTRY.unpack_from(rom, TABLE+i*12) for i in range(COUNT+1)]
    old = [ENTRY.unpack_from(base, TABLE+i*12) for i in range(COUNT+1)]
    # All replacement assets can be resident together in character select.
    growth = sum(max(0,new[4]-prev[4])*4 for new,prev in zip(table[:-1],old[:-1]))
    from skinning.patches import patches, crc6103, ASSET_GROWTH_BUDGET
    assert growth <= ASSET_GROWTH_BUDGET, 'Character-select asset growth exceeds conservative budget'
    expected = bytearray(base)
    extra_files = {163}
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
        from skinning.audit import audit_model
        totals[fid]=audit_model(raw,pointers,common)
    return totals


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('base', type=Path)
    ap.add_argument('rom', type=Path)
    ap.add_argument('--models', type=int, nargs='+', default=[296,323,332])
    ap.add_argument('--loadout', type=Path, help='Read model IDs from a generated loadout')
    args = ap.parse_args()
    loadout = json.loads(args.loadout.read_text()) if args.loadout else None
    if loadout is not None:
        args.models = [c['model_file'] for c in loadout]
    print('PASS:', verify(args.base.read_bytes(), args.rom.read_bytes(), args.models, loadout))
