"""Build a deterministic controller-poll fixture (Dolphin 2606a Movie.h)."""
import argparse
import json
from pathlib import Path
import struct

BUTTONS=dict(Start=0,A=1,B=2,X=3,Y=4,Z=5,Up=6,Down=7,Left=8,Right=9,L=10,R=11)


def make_dtm(steps):
    data=bytearray()
    for step in steps:
        buttons=1<<14  # Controller connected.
        for name in step.get('buttons',[]):buttons|=1<<BUTTONS[name]
        count=step['polls']
        if type(count) is not int or not 0<count<=60000:raise ValueError('Invalid poll count')
        stick=step.get('stick',[128,128])
        packet=struct.pack('<H6B',buttons,0,0,*stick,128,128)
        data.extend(packet*count)
    header=bytearray(256);header[:4]=b'DTM\x1a';header[4:10]=b'GALE01';header[11]=1
    struct.pack_into('<QQQ',header,13,len(data)//8,len(data)//8,0)
    author=b'OpenSmash verification';header[49:49+len(author)]=author
    # The first termination condition is input exhaustion. Avoid guessing VI
    # count or CPU tick timing before the run has been measured.
    struct.pack_into('<Q',header,237,(1<<63)-1)
    return header+data


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('plan');p.add_argument('out')
    args=p.parse_args();out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_bytes(make_dtm(json.loads(Path(args.plan).read_text())))
