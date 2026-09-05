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


def verify(base, rom, fids):
    assert len(rom) <= 64*1024*1024 and len(rom) & (len(rom)-1) == 0
    expected = bytearray(base[:TABLE])
    for patch in json.loads(Path(__file__).with_name('unlock-patches.json').read_text()):
        offset = int(patch['rom_offset'], 16)
        assert struct.unpack_from('>I', expected, offset)[0] == int(patch['expected'], 16)
        struct.pack_into('>I', expected, offset, int(patch['replacement'], 16))
    assert expected == rom[:TABLE], 'Unexpected game code/header change'
    assert base[DATA:] == rom[DATA:len(base)], 'Original non-table data changed'
    table = [ENTRY.unpack_from(rom, TABLE+i*12) for i in range(COUNT+1)]
    old = [ENTRY.unpack_from(base, TABLE+i*12) for i in range(COUNT+1)]
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
        if fid not in fids:
            assert blob == base[a:b] and entry[1:] == prev[1:]
            continue
        assert not entry[0]&0x80000000 and entry[2] == entry[4]
        raw = blob[:entry[4]*4]
        assert blob[entry[2]*4:] == base[a+prev[2]*4:b], 'External file IDs changed'
        pointers = walk(raw, entry[1], True)
        walk(raw, entry[3], False)
        # Appended DLs start with PipeSync, TextureOff, GeometryMode, Combine.
        count = 0
        for at in range(prev[4]*4, len(raw)-32, 8):
            if raw[at:at+16] != bytes.fromhex('e700000000000000d700000000000000'):
                continue
            cursor = at+32
            vertex_count = 0
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
    ap.add_argument('--models', type=int, nargs='+', default=[296,323,332])
    args = ap.parse_args()
    print('PASS:', verify(args.base.read_bytes(), args.rom.read_bytes(), args.models))
