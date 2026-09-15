"""Generate upstream font includes from the verified local GALE01 DOL only."""
import argparse, hashlib, struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
EXPECTED='08e0bf20134dfcb260699671004527b2d6bb1a45'

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dol',type=Path,default=ROOT/'assets/game/sys/main.dol')
    ap.add_argument('--out',type=Path,default=ROOT/'build/browser-port/include/sysdolphin/baselib')
    args=ap.parse_args();raw=args.dol.read_bytes()
    if hashlib.sha1(raw).hexdigest()!=EXPECTED:raise ValueError('DOL hash does not match verified GALE01 build')
    sections=[struct.unpack_from('>I',raw,i*4)[0] for i in range(57)]
    args.out.mkdir(parents=True,exist_ok=True)
    # Addresses and lengths from upstream config/GALE01/config.yml, header_type raw.
    for name,address,length in [('debug_font.inc',0x804088B8,0x1c00),('sislib_font.inc',0x8040CD40,0x23e00)]:
        matches=[sections[i]+address-sections[18+i] for i in range(18)
                 if sections[18+i]<=address and address+length<=sections[18+i]+sections[36+i]]
        if len(matches)!=1:raise ValueError('Font range not contained in one DOL section')
        offset=matches[0]
        if offset+length>len(raw):raise ValueError('Truncated DOL section')
        payload=raw[offset:offset+length]
        (args.out/name).write_text('\n'.join(','.join(f'0x{b:02x}' for b in payload[i:i+16])+',' for i in range(0,length,16))+'\n')
        print(name,length,hashlib.sha256(payload).hexdigest())
if __name__=='__main__':main()
