"""Strict NTSC-U code/graphics-reserve patches for opt-in skinning."""
from pathlib import Path
import struct

GRAPHICS_RESERVE=32768
MODEL_GROWTH_BUDGET=152*1024
ASSET_GROWTH_BUDGET=160*1024
HOOK_ROM=0x051c90+(0x800f24a0-0x800d6490)


def patches(base):
    hook=bytes.fromhex(Path(__file__).with_name('draw_hook.hex').read_text())
    assert len(hook)==228
    result=[(HOOK_ROM,base[HOOK_ROM:HOOK_ROM+228],hook)]
    for at in range(0,0x1ac870-64,4):
        v=struct.unpack_from('>16I',base,at)
        if (v[0]==0 and v[4]==0 and v[5]==1 and v[6]==2 and 0x80130000<=v[3]<0x80200000 and
            0x80000000<=v[1]<0x80400000 and 0x80000000<=v[2]<0x80400000 and
            512<=v[7]<=0x40000 and all(x%8==0 and x<=0x40000 for x in v[7:11]) and
            1024<=v[11]<=0x40000 and v[12] in (0,0x10000,0x20000) and v[13]<=0x40000 and
            0x80000000<=v[15]<0x80400000):
            result.append((at+44,base[at+44:at+48],struct.pack('>I',v[11]+GRAPHICS_RESERVE)))
    if len(result)!=56:raise ValueError('Unexpected US scene-setup layout')
    return result


def crc6103(rom):
    # CIC-6103 checksum, matching the decomp's tools/n64crc.py algorithm.
    mask=0xffffffff
    t1=t2=t3=t4=t5=t6=0xa3886759
    for d, in struct.iter_unpack('>I',rom[0x1000:0x101000]):
        n=d&31;r=((d<<n)|(d>>(32-n)))&mask
        if ((t6+d)&mask)<t6:t4=(t4+1)&mask
        t3^=d;t6=(t6+d)&mask;t2^=r if t2>d else t6^d
        t5=(t5+r)&mask;t1=(t1+(t5^d))&mask
    return struct.pack('>II',((t6^t4)+t3)&mask,((t5^t2)+t1)&mask)
