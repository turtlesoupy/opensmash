"""Decode typed FigaTree descriptors; compressed track bytes stay unchanged.

Local validation data only. Do not distribute Nintendo assets with the browser.
"""
import argparse, base64, hashlib, json, math, struct
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
ROOT = Path(__file__).resolve().parents[1]

def extract(raw):
    offset = 0
    animations = []
    while offset < len(raw):
        if not any(raw[offset:]): break
        if offset + 32 > len(raw): raise ValueError('Truncated concatenated archive')
        size = struct.unpack_from('>I', raw, offset)[0]
        a = Archive(raw[offset:offset+size])
        roots = a.roots()
        if len(roots) != 1: raise ValueError('Expected one FigaTree root')
        name, root = next(iter(roots.items()))
        kind, flags, frames, nodes, tracks = a.unpack('IIfII', root)
        if not name.endswith('_figatree') or kind not in (0,1) or not math.isfinite(frames):
            raise ValueError('Unsupported FigaTree')
        if a.ptr(root+12) != nodes or a.ptr(root+16) != tracks: raise ValueError('Missing relocation')
        ts = []; joint = 0; t = 0
        while True:
            count = a.unpack('b', nodes+joint)[0]
            if count == -1: break
            if count < 0 or joint >= 256: raise ValueError('Invalid node count')
            for _ in range(count):
                off = tracks + 12*t
                length, start, channel, value, slope, padding, data = a.unpack('HhBBBBI', off)
                if a.ptr(off+8) != data: raise ValueError('Missing track relocation')
                a.check(data,length)
                ts.append(dict(joint=joint, channel=channel, value=value, slope=slope, start=start,
                               data=base64.b64encode(a.data[data:data+length]).decode('ascii')))
                t += 1
            joint += 1
        animations.append(dict(name=name, kind=kind, flags=flags, frames=frames,
                               joints=joint, tracks=ts, archive_offset=offset))
        next_offset = (offset+size+31)&~31
        # Alignment bytes are unspecified and may contain nonzero data.
        offset = next_offset
    return animations

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--animations',type=Path,default=ROOT/'assets/game/files/PlMrAJ.dat')
    ap.add_argument('--costume',type=Path,default=ROOT/'assets/game/files/PlMrNr.dat')
    ap.add_argument('--symbol',default='PlyMario5K_Share_joint')
    ap.add_argument('--out',type=Path,default=ROOT/'build/browser-port/runtime/mario-local.json')
    args=ap.parse_args();raw=args.animations.read_bytes()
    data=dict(scope='local engine validation; original game assets',sha256=hashlib.sha256(raw).hexdigest(),
              skeleton=joints(Archive.read(args.costume),args.symbol),animations=extract(raw))
    args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(json.dumps(data,separators=(',',':')))
    print(f'{len(data["animations"])} animations → {args.out}')
if __name__=='__main__':main()
