"""Measure attachment clearance from descriptor-matched, captured idle matrices."""
import argparse
import json
from pathlib import Path
import sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.target_presentation import ATTACHMENTS
from tools.inspect_costume_bounds import rigid_positions


def inspect(capture, costume, fighter):
    a=Archive.read(costume)
    skeleton=joints(a,next(k for k in a.roots() if k.endswith('_joint')))
    matrices={};descriptors={};active=False
    for line in (capture/'game.log').read_text().splitlines():
        if line.startswith('[pose-begin]'):
            active=line=='[pose-begin] port=0'
        elif active and line.startswith('[pose-joint]'):
            row=line.split();matrix=np.eye(4)
            matrix[:3]=np.array(list(map(float,row[4:]))).reshape(3,4)
            matrices[int(row[1])]=matrix
        elif active and line.startswith('[pose-descriptor]'):
            _,index,descriptor=line.split()
            descriptors[int(index)]=int(descriptor,16)
    if 0 not in descriptors:
        raise ValueError('Capture needs the descriptor-aware validation mod')
    base=descriptors[0]-skeleton[0]['offset']
    # Runtime inserts joints (notably Link's shield collision joint). A traversal
    # index is not an archive index; match each joint's original descriptor.
    by_descriptor={descriptor:matrices[index] for index,descriptor in descriptors.items() if descriptor}
    identity=a.ptr(skeleton[0]['dobj']+8)
    scale,offset=a.unpack('2f',identity+68)
    root=by_descriptor[base+skeleton[0]['offset']]
    result=[]
    for index in ATTACHMENTS.get(fighter,[]):
        matrix=by_descriptor[base+skeleton[index]['offset']]
        points=rigid_positions(a,skeleton[index])
        world=(matrix@np.c_[points,np.ones(len(points))].T).T[:,:3]
        world=world*scale+root[:3,3]*(1-scale)
        world[:,1]+=offset*np.linalg.norm(root[:3,1])
        result.append(dict(joint=index,minimumWorldY=float(world[:,1].min()),maximumWorldY=float(world[:,1].max())))
    return dict(fighter=fighter,groundY=0,statureScale=scale,attachments=result,
                note='Frozen idle pose. Visibility and animation state must also be inspected; this is not an all-animation collision certificate.')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--capture',type=Path,required=True)
    p.add_argument('--costume',type=Path,required=True)
    p.add_argument('--fighter',choices=sorted(ATTACHMENTS),required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();result=inspect(args.capture,args.costume,args.fighter)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
