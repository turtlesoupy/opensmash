"""Head-bodied fit for round fighters, inspired by OpenSmash's ball mode.

Keep the original topology and uniformly scale the authored head. The torso
becomes a small internal plug; hands and shoes retain independent animation.
"""
import numpy as np
from .proportions import ORIENTATION


def conform_ball(mesh,skeleton,profile):
    pos=mesh['positions']; names=mesh['names']; n=len(pos)
    def weight(parts):
        return np.where(np.isin(mesh['joints'],[names.index(p) for p in parts if p in names]),mesh['weights'],0).sum(axis=1)
    def anchor(name):
        j=profile['joint_map'][name]
        return j,np.linalg.inv(skeleton[j]['inverse_bind'])[:3,3]
    head_index=names.index('Head');origin=mesh['bind'][head_index][:3,3]
    raw=weight(['Head']); core=(raw>=.8)&(pos[:,1]>=origin[1]-.04*np.ptp(pos[:,1]))
    if core.sum()<20:raise ValueError('Not enough confidently weighted head geometry for ball fit')
    width=float(np.ptp(pos[core,0]))
    if width<1e-6:raise ValueError('Degenerate source head')
    center=origin+np.array([0,width*.32,0])
    joint,dest=anchor('Head');radius=float(profile['ball_fit']['radius'])
    if not np.isfinite(radius) or radius<=0:raise ValueError('Ball radius must be positive')
    scale=radius*2/width
    # Preserve the jaw shell even below the anatomical head anchor. Narrow,
    # upward-facing collar geometry belongs to the hidden torso instead.
    height=float(np.ptp(pos[:,1]));floor=origin[1]+.02*height
    def smooth(lo,hi,x):
        t=np.clip((x-lo)/np.maximum(hi-lo,1e-8),0,1)
        return t*t*(3-2*t)
    radial=np.linalg.norm((pos-origin)[:,[0,2]],axis=1)
    jaw=(raw>=.8)&(mesh['normals'][:,1]<=.1)&(pos[:,1]>=origin[1]-.12*height)&(pos[:,1]<=floor)
    shell=np.zeros(n);shell_floor=floor-.06*height
    if jaw.any():
        reference=float(np.quantile(radial[jaw],.2))
        shell=smooth(.55*reference,reference,radial)*(1-smooth(.25,.75,mesh['normals'][:,1]))
        shell_floor=max(origin[1]-.10*height,min(floor,float(pos[jaw,1].min())))
    local_floor=floor+shell*(shell_floor-floor)
    collar=(1-smooth(floor,floor+.06*height,pos[:,1]))*smooth(.25,.75,mesh['normals'][:,1])*(1-shell)
    support=smooth(local_floor-.02*height,local_floor,pos[:,1])*smooth(.5,.9,raw)*(1-collar)
    head=(pos-center)@ORIENTATION.T*scale+dest
    plug=(pos-center)@ORIENTATION.T*(scale*.035)+dest
    positions=head*support[:,None]+plug*(1-support[:,None])
    # Hide the shoulder/forearm connection below the cheeks, not behind the
    # ears or nose. Its outer blend then emerges from the lower head shell.
    for side in ['L_','R_']:
        arm_names=[name for name in names if name.startswith(side) and any(part in name for part in ['Clavicle','Upperarm','Forearm'])]
        arm=weight(arm_names)*(1-support)
        hand_source=mesh['bind'][names.index(side+'Hand')][:3,3]
        sign=np.sign(hand_source[0]-origin[0])
        base=dest+ORIENTATION@np.array([sign*radius*.15,-radius*.45,0])
        tucked=plug+(base-dest)
        positions=positions*(1-arm[:,None])+tucked*arm[:,None]
    influences=[{joint:1.0} for _ in range(n)]
    for name,parts in [('L_Hand',['L_Hand']),('R_Hand',['R_Hand']),('L_Foot',['L_Foot','L_ToeBase']),('R_Foot',['R_Foot','R_ToeBase'])]:
        w=weight(parts)*(1-support);owned=w>.65
        if not owned.any():continue
        source=mesh['bind'][names.index(name)][:3,3];j,target=anchor(name)
        span=max(np.ptp(pos[owned],axis=0))
        limb_scale=radius*(.42 if 'Hand' in name else .72)/max(span,1e-6)
        if 'Hand' in name:
            target=target+np.asarray(profile['ball_fit'].get('hand_offsets',{}).get(name,[0,0,0]))
        limb=(pos-source)@ORIENTATION.T*limb_scale+target
        positions=positions*(1-w[:,None])+limb*w[:,None]
        for i in np.flatnonzero(w>0):
            influences[i]={k:v*(1-float(w[i])) for k,v in influences[i].items()}
            influences[i][j]=influences[i].get(j,0)+float(w[i])
    # The collapse is non-affine, so derive normals from the final surface.
    triangles=mesh['triangles']; normals=np.zeros_like(positions)
    face=np.cross(positions[triangles[:,1]]-positions[triangles[:,0]],positions[triangles[:,2]]-positions[triangles[:,0]])
    for k in range(3):np.add.at(normals,triangles[:,k],face)
    lengths=np.linalg.norm(normals,axis=1);valid=lengths>1e-12
    normals[valid]/=lengths[valid,None];normals[~valid]=mesh['normals'][~valid]@ORIENTATION.T
    envelopes=[tuple((j,float(np.float32(w))) for j,w in sorted(inf.items()) if w>1e-7) for inf in influences]
    return dict(mesh,positions=positions,normals=normals,envelopes=envelopes)
