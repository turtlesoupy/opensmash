"""Source-shaped conformation to inspected Melee humanoid body-part tables.

Profiles extend the reviewed Mario approach. They use original anatomical
part remapping, and explicit torso/toe resolutions for joints absent from that
table. Gallery/animation validation is separate from full in-game acceptance.
"""
from pathlib import Path
import numpy as np
from .archive import Archive
from .skeleton import joints
from .proportions import source_head_fit, ORIENTATION

TARGETS={
 'mario':('Mr',0,'Mario'), 'luigi':('Lg',17,'Luigi'),
 'captain-falcon':('Ca',2,'Captain Falcon'), 'fox':('Fx',1,'Fox'),
 'marth':('Ms',18,'Marth'), 'link':('Lk',6,'Link'),
}

def load_target(game,slug):
    code,kind,name=TARGETS[slug]
    co=Archive.read(Path(game)/'PlCo.dat');table=co.ptr(co.roots()['ftLoadCommonData']+16)
    def parts(k):
        p=co.ptr(table+4*k);return co.ptr(p),co.ptr(p+4),co.u32(p+8)
    j2p,_,_=parts(0);_,p2j,count=parts(kind)
    a=Archive.read(Path(game)/f'Pl{code}Nr.dat')
    symbol=next(k for k in a.roots() if k.endswith('_joint'))
    skeleton=joints(a,symbol)
    def equivalent(index):
        part=co.unpack('B',j2p+index)[0]
        if part==255:return None
        joint=co.unpack('B',p2j+part)[0]
        return None if joint==255 else joint
    indices={i:equivalent(i) for i in [4,5,22,23,6,8,9,10,13,29,31,32,33,36,48,49,51,54,55,57]}
    if indices[5] is None:indices[5]=skeleton[indices[22]]['parent']
    for source_foot,source_toe in [(51,52),(57,58)]:
        foot=indices[source_foot]
        children=[j['index'] for j in skeleton if j['parent']==foot and j['inverse_bind'] is not None]
        if not children:raise ValueError('No explicit foot endpoint')
        # In these six inspected rigs, the first child is the authored toe tip.
        indices[source_toe]=children[0]
    for old,index in indices.items():
        if index is None or index>=len(skeleton) or skeleton[index]['inverse_bind'] is None:
            raise ValueError(f'{slug}: unverified anatomical mapping for Mario joint {old}')
    return dict(slug=slug,code=code,kind=kind,name=name,symbol=symbol,skeleton=skeleton,mapping=indices)

def rotation_between(a,b):
    a=a/np.linalg.norm(a);b=b/np.linalg.norm(b);c=float(a@b);v=np.cross(a,b)
    if c < -.999999:
        axis=np.cross(a,[1,0,0] if abs(a[0])<.9 else [0,1,0]);axis/=np.linalg.norm(axis)
        return 2*np.outer(axis,axis)-np.eye(3)
    skew=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
    return np.eye(3)+skew+skew@skew/(1+c)

def fit(mesh,target):
    skeleton=target['skeleton'];indices=target['mapping']
    bind={n:b for n,b in zip(mesh['names'],mesh['bind'])}
    tb={i:np.linalg.inv(j['inverse_bind']) for i,j in enumerate(skeleton) if j['inverse_bind'] is not None}
    source_span=bind['Head'][1,3]-float(mesh['positions'][:,1].min())
    ground=min(tb[indices[i]][1,3] for i in [52,58])
    body_scale=(tb[indices[23]][1,3]-ground)/source_span
    if not np.isfinite(body_scale) or body_scale<=0:raise ValueError('Invalid body scale')
    mapping={};corrections={};scales={}
    def segment(names,old,start,end,target_end,scale_override=None):
        joint=indices[old];origin=bind[start][:3,3];dest=tb[joint][:3,3]
        av=ORIENTATION@(bind[end][:3,3]-origin);bv=tb[indices[target_end]][:3,3]-dest
        if np.linalg.norm(av)<1e-7:raise ValueError(f'Degenerate source segment {start}')
        if np.linalg.norm(bv)<1e-7:
            if not target.get('allow_collapsed_segments'):raise ValueError(f'Degenerate segment {start}')
            # A mitten/blob rig may intentionally share anatomical anchors.
            # Keep volume instead of generating a singular zero-length fit.
            bv=av
            scale_override=body_scale if scale_override is None else scale_override
        length=np.linalg.norm(bv)/np.linalg.norm(av) if scale_override is None else scale_override
        axis=av/np.linalg.norm(av);stretch=body_scale*np.eye(3)+(length-body_scale)*np.outer(axis,axis)
        affine=np.eye(4);affine[:3,:3]=rotation_between(av,bv)@stretch@ORIENTATION
        affine[:3,3]=dest-affine[:3,:3]@origin
        for n in names:
            if n in bind:mapping[n]=joint;corrections[n]=(np.linalg.inv(tb[joint])@affine@bind[n]).tolist()
        scales[start]=dict(length=float(length),width=float(body_scale))
    segment(['Root','Hip','Pelvis','Waist'],4,'Hip','Spine01',5)
    segment(['Spine01','Spine02'],5,'Spine01','NeckTwist01',22)
    segment(['NeckTwist01','NeckTwist02'],22,'NeckTwist01','Head',23)
    head=indices[23];affine=np.eye(4);affine[:3,:3]=ORIENTATION*body_scale
    affine[:3,3]=tb[head][:3,3]-affine[:3,:3]@bind['Head'][:3,3]
    mapping['Head']=head;corrections['Head']=(np.linalg.inv(tb[head])@affine@bind['Head']).tolist()
    for side,clav,arm,elbow,hand,finger,thigh,knee,foot,toe in [('L',6,8,9,10,13,48,49,51,52),('R',29,31,32,33,36,54,55,57,58)]:
        segment([side+'_Clavicle'],clav,side+'_Clavicle',side+'_Upperarm',arm)
        segment([side+'_Upperarm',side+'_UpperarmTwist01',side+'_UpperarmTwist02'],arm,side+'_Upperarm',side+'_Forearm',elbow)
        segment([side+'_Forearm',side+'_ForearmTwist01',side+'_ForearmTwist02'],elbow,side+'_Forearm',side+'_Hand',hand)
        virtual=bind[side+'_Hand'].copy();virtual[:3,3]+=bind[side+'_Hand'][:3,3]-bind[side+'_Forearm'][:3,3];bind['__'+side+'_hand']=virtual
        hand_scale=np.linalg.norm(tb[indices[hand]][:3,3]-tb[indices[elbow]][:3,3])/np.linalg.norm(bind[side+'_Hand'][:3,3]-bind[side+'_Forearm'][:3,3])
        if hand_scale<1e-7 and target.get('allow_collapsed_segments'):hand_scale=body_scale
        segment([side+'_Hand'],hand,side+'_Hand','__'+side+'_hand',finger,hand_scale)
        segment([side+'_Thigh',side+'_ThighTwist01',side+'_ThighTwist02'],thigh,side+'_Thigh',side+'_Calf',knee)
        segment([side+'_Calf',side+'_CalfTwist01',side+'_CalfTwist02'],knee,side+'_Calf',side+'_Foot',foot)
        origin=bind[side+'_Foot'][:3,3];axis=bind[side+'_ToeBase'][:3,3]-origin;axis/=np.linalg.norm(axis)
        ids=[mesh['names'].index(side+suffix) for suffix in ['_Foot','_ToeBase']]
        w=np.where(np.isin(mesh['joints'],ids),mesh['weights'],0).sum(axis=1)
        points=mesh['positions'][w>.5]
        if len(points):
            extent=float(np.max((points-origin)@axis))
            if extent<=1e-5:raise ValueError('Invalid shoe extent')
            tip=np.eye(4);tip[:3,3]=origin+axis*extent;bind['__'+side+'_shoe']=tip
            segment([side+'_Foot',side+'_ToeBase'],foot,side+'_Foot','__'+side+'_shoe',toe)
        else:segment([side+'_Foot',side+'_ToeBase'],foot,side+'_Foot',side+'_ToeBase',toe,body_scale)
    if set(mesh['names'])-set(mapping):raise ValueError('Unsupported source joints')
    from .surfaces import refine_profile
    profile=source_head_fit(mesh,skeleton,dict(joint_map=mapping,bone_corrections=corrections,fit_scales=scales,bone_scale=1,base_fighter=target['slug']))
    return refine_profile(mesh,skeleton,profile)
