"""Preserve a known virtual-disc costume slot size for validation checkpoints.

This does not make a checkpoint containing an already-loaded fighter safe to
reuse with a new character. Use a checkpoint before fighter selection, and
verify identity in the rendered scene. A clean boot avoids these restrictions.
"""
import argparse
from pathlib import Path
import struct
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.archive import Archive
from opensmash_melee.__main__ import atomic_write,digest,dump


def pad(raw,capacity):
    archive=Archive(raw)
    if type(capacity) is not int or capacity<len(raw):raise ValueError('Costume exceeds fixed slot capacity')
    result=bytearray(raw)+bytes(capacity-len(raw))
    struct.pack_into('>I',result,0,len(result))
    if Archive(result).roots()!=archive.roots():raise ValueError('Padding changed archive symbols')
    return bytes(result)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('out',type=Path);p.add_argument('--capacity',type=int,required=True);a=p.parse_args()
    if a.source.resolve()==a.out.resolve():p.error('Keep the original conversion; use a separate output path')
    atomic_write(a.out,pad(a.source.read_bytes(),a.capacity))
    dump(str(a.out)+'.json',dict(capacity=a.capacity,source_sha256=digest(a.source),output_sha256=digest(a.out)))
