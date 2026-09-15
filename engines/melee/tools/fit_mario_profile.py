"""Generate a review-required Mario fit from real archived bind matrices.

The target indices below were inspected in the validated 1.02 PlMrNr.dat.
Twist bones share the main limb's conformation rather than collapsing their
origins to one target point. This is not a gameplay/visual approval.
"""
import argparse
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.archive import Archive
from opensmash_melee.glb import GLB
from opensmash_melee.skeleton import joints
from opensmash_melee.__main__ import digest,dump


def rotation_between(a,b):
    a=a/np.linalg.norm(a); b=b/np.linalg.norm(b)
    c=float(np.dot(a,b)); v=np.cross(a,b)
    if c < -0.999999:
        axis=np.cross(a,[1,0,0] if abs(a[0])<.9 else [0,1,0]); axis/=np.linalg.norm(axis)
        return 2*np.outer(axis,axis)-np.eye(3)
    skew=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
    return np.eye(3)+skew+skew@skew/(1+c)


def fit(character,costume,head_style="source"):
    if head_style not in ("source", "uniform"):
        raise ValueError("Unknown head style")
    a=Archive.read(costume); target=joints(a,'PlyMario5K_Share_joint')
    m=GLB(Path(character)/'rigged.glb').mesh()
    if len(target)!=61:
        raise ValueError('Expected inspected Mario 1.02 skeleton with 61 joints')
    bind={name:b for name,b in zip(m['names'],m['bind'])}
    tb={j['index']:np.linalg.inv(j['inverse_bind']) for j in target if j['inverse_bind'] is not None}
    # Source forward +X, up +Y, left -Z; target forward +Z, up +Y, left +X.
    orientation=np.array([[0,0,-1],[0,1,0],[1,0,0]],dtype=float)
    mapping,corrections={},{}
    # Bone length and limb thickness are independent. Uniform per-segment
    # scaling inflated short source foot markers into enormous shoes.
    body_scale=(tb[24][1,3]-tb[51][1,3])/np.ptp(m["positions"][:,1])
    fit_scales={}
    def segment(names,target_joint,source_start,source_end,target_end,scale_override=None,preserve_shape=False):
        source_origin=bind[source_start][:3,3]
        target_origin=tb[target_joint][:3,3]
        av=orientation@(bind[source_end][:3,3]-source_origin)
        bv=tb[target_end][:3,3]-target_origin
        scale=np.linalg.norm(bv)/np.linalg.norm(av) if scale_override is None else scale_override
        axis=av/np.linalg.norm(av)
        width_scale=scale if preserve_shape else body_scale
        stretch=width_scale*np.eye(3)+(scale-width_scale)*np.outer(axis,axis)
        affine=np.eye(4); affine[:3,:3]=rotation_between(av,bv)@stretch@orientation
        fit_scales[source_start]={"length":float(scale),"width":float(width_scale)}
        affine[:3,3]=target_origin-affine[:3,:3]@source_origin
        for name in names:
            if name in bind:
                mapping[name]=target_joint
                corrections[name]=(np.linalg.inv(tb[target_joint])@affine@bind[name]).tolist()
    segment(['Root','Hip','Pelvis','Waist'],4,'Hip','Spine01',5)
    segment(['Spine01','Spine02'],5,'Spine01','NeckTwist01',22)
    segment(['NeckTwist01','NeckTwist02'],22,'NeckTwist01','Head',23)
    # Keep the generated head upright, using its source height rather than a
    # nonexistent terminal head joint from the generator.
    source_top=np.array([*bind['Head'][:3,3]])
    head_index=m['names'].index('Head')
    head_weight=np.where(m['joints']==head_index,m['weights'],0).sum(axis=1)
    head_points=m['positions'][head_weight>.5]
    if len(head_points)==0:raise ValueError('No predominantly head-weighted geometry')
    source_top[1]=float(head_points[:,1].max())
    virtual=np.eye(4);virtual[:3,3]=source_top;bind['__head_tip']=virtual
    # Optional geometry-matched fit, retaining the source head aspect.
    from tools.inspect_costume_bounds import inspect
    _,reference_head=inspect(str(Path(costume).resolve()))
    head_axis=tb[24][:3,3]-tb[23][:3,3]
    head_axis/=np.linalg.norm(head_axis)
    height=float(reference_head[:,1].max()-tb[23][1,3])
    tip=np.eye(4);tip[:3,3]=tb[23][:3,3]+head_axis*(height/head_axis[1])
    tb['__head_mesh_tip']=tip
    segment(['Head'],23,'Head','__head_tip','__head_mesh_tip',preserve_shape=True)
    for side,clavicle,arm,elbow,hand,finger,thigh,knee,foot,toe in [
        ('L',6,8,9,10,13,48,49,51,52),
        ('R',29,31,32,33,36,54,55,57,58)]:
        segment([side+'_Clavicle'],clavicle,side+'_Clavicle',side+'_Upperarm',arm)
        segment([side+'_Upperarm',side+'_UpperarmTwist01',side+'_UpperarmTwist02'],arm,side+'_Upperarm',side+'_Forearm',elbow)
        segment([side+'_Forearm',side+'_ForearmTwist01',side+'_ForearmTwist02'],elbow,side+'_Forearm',side+'_Hand',hand)
        # Hand rig has no fingers. Use the forearm direction as its axis but
        # anchor at the hand and scale by the adjacent forearm ratio.
        source_virtual=bind[side+'_Hand'].copy()
        source_virtual[:3,3]+=bind[side+'_Hand'][:3,3]-bind[side+'_Forearm'][:3,3]
        bind['__'+side+'_hand_tip']=source_virtual
        segment([side+'_Hand'],hand,side+'_Hand','__'+side+'_hand_tip',finger,
                np.linalg.norm(tb[hand][:3,3]-tb[elbow][:3,3])/np.linalg.norm(bind[side+'_Hand'][:3,3]-bind[side+'_Forearm'][:3,3]))
        segment([side+'_Thigh',side+'_ThighTwist01',side+'_ThighTwist02'],thigh,side+'_Thigh',side+'_Calf',knee)
        segment([side+'_Calf',side+'_CalfTwist01',side+'_CalfTwist02'],knee,side+'_Calf',side+'_Foot',foot)
        # ToeBase is an interior marker, whereas Mario's toe endpoint is at
        # the tip. Fit the actual weighted shoe extent to that endpoint.
        origin=bind[side+'_Foot'][:3,3]
        axis=bind[side+'_ToeBase'][:3,3]-origin
        axis=axis/np.linalg.norm(axis)
        ids=[m['names'].index(side+suffix) for suffix in ('_Foot','_ToeBase')]
        weights=np.where(np.isin(m['joints'],ids),m['weights'],0).sum(axis=1)
        points=m['positions'][weights>.5]
        if not np.any(weights):
            # An absent/peg foot can retain unused rig joints. Mapping them
            # is harmless; requiring nonexistent geometry rejects valid rigs.
            segment([side+'_Foot',side+'_ToeBase'],foot,side+'_Foot',side+'_ToeBase',toe,scale_override=body_scale)
            continue
        if len(points)==0:raise ValueError('No predominantly weighted shoe geometry; explicit fit required')
        extent=float(np.max((points-origin)@axis))
        if extent<=1e-5:raise ValueError('Invalid shoe extent')
        tip=np.eye(4);tip[:3,3]=origin+axis*extent
        bind['__'+side+'_shoe_tip']=tip
        segment([side+'_Foot',side+'_ToeBase'],foot,side+'_Foot','__'+side+'_shoe_tip',toe)
    if set(m['names'])-set(mapping):
        raise ValueError('Unsupported generator skeleton: '+str(set(m['names'])-set(mapping)))
    profile=dict(costume_sha256=digest(costume),source_glb_sha256=digest(Path(character)/'rigged.glb'),
                symbol='PlyMario5K_Share_joint',joint_map=mapping,bone_corrections=corrections,
                fit_version=6,head_style=head_style,fit_scales=fit_scales,mesh_joint=0,mesh_dobj=0,texture_size=256,status='requires_visual_and_gameplay_review')

    if head_style == 'source':
        from opensmash_melee.proportions import source_head_fit
        profile=source_head_fit(m,target,profile)
    from opensmash_melee.surfaces import refine_profile
    return refine_profile(m,target,profile)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('character');p.add_argument('costume');p.add_argument('out')
    p.add_argument('--head-style',choices=['source','uniform'],default='source')
    args=p.parse_args();dump(args.out,fit(args.character,args.costume,args.head_style))
