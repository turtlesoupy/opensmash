"""Offline oracles for the native fitter; writes only ignored local fixtures.

Python is used to decode existing test assets and compare results, never by the
native/browser fitter. Inputs contain raw source geometry and reusable target
rig/pose data, not solved profiles, hulls or hand offsets.
"""
import argparse
import ctypes
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import numpy as np
from opensmash_melee.glb import GLB
from opensmash_melee.retarget_probe import load,TARGETS
from opensmash_melee.ball_fit import conform_ball
from tools.fit_ball_hands import fit_hands


def fixture(source,target,game):
    mesh=GLB(source/'rigged.glb').mesh()
    spec=next(s for s in TARGETS if s[0]==target);rig=load(game,spec)
    calibration=json.loads(gzip.decompress((ROOT/'runtime/retarget-clearance'/(target+'.json.gz')).read_bytes()))
    if calibration['costume_sha256']!=hashlib.sha256((game/f'Pl{spec[1]}Nr.dat').read_bytes()).hexdigest():
        raise ValueError('Calibration/template mismatch')
    names=['Head','L_Hand','R_Hand','L_Foot','R_Foot']
    mapping=dict(zip(names,[rig['mapping'][i] for i in [23,10,33,51,57]]))
    profile={'joint_map':mapping,'ball_fit':{'radius':4.3 if target=='kirby' else 4.5}}
    start=time.perf_counter();reference=fit_hands(mesh,rig['skeleton'],profile,calibration['samples'])
    fitted=conform_ball(mesh,rig['skeleton'],reference);reference_ms=(time.perf_counter()-start)*1000
    flags={'Head':1,'L_Hand':2,'R_Hand':4,'L_Foot':8,'L_ToeBase':16,'R_Foot':32,'R_ToeBase':64}
    parts=[]
    for name in mesh['names']:
        value=flags.get(name,0)
        if any(p in name for p in ['Clavicle','Upperarm','Forearm']):
            value=128 if name.startswith('L_') else 256 if name.startswith('R_') else value
        parts.append(value)
    arrays={
        'positions':mesh['positions'],'normals':mesh['normals'],'weights':mesh['weights'],
        'joints':mesh['joints'],'triangles':mesh['triangles'],'parts':parts,
        'origins':[mesh['bind'][mesh['names'].index(name)][:3,3] for name in names],
        'targetJoints':[mapping[name] for name in names],
        'inverseBinds':[j['inverse_bind'] if j['inverse_bind'] is not None else np.eye(4) for j in rig['skeleton']],
        'worlds':[s['worlds'] for s in calibration['samples']],
    }
    result=dict(mode='round',name=source.name+'-'+target,n=len(mesh['positions']),triangleCount=len(mesh['triangles']),
                sourceJoints=len(mesh['names']),targetCount=len(rig['skeleton']),poses=len(calibration['samples']),
                radius=profile['ball_fit']['radius'],referenceMs=reference_ms,
                referenceHands=reference['ball_fit']['hand_clearance']['hands'],
                sourceSha256=hashlib.sha256((source/'rigged.glb').read_bytes()).hexdigest())
    for name,array in arrays.items():result[name]=np.asarray(array).reshape(-1).tolist()
    return result,mesh,rig,profile,fitted


def validate(lib,data,mesh,rig,profile,reference):
    f=lib.fit_round
    f.restype=ctypes.c_int
    ptr=ctypes.c_void_p
    f.argtypes=[ctypes.c_uint]*5+[ptr]*10+[ctypes.c_double]+[ptr]*5
    arrays=[]
    for name in ['positions','normals','weights','joints','triangles','parts','origins','targetJoints','inverseBinds','worlds']:
        arrays.append(np.asarray(data[name],dtype=np.uint32 if name in ['joints','triangles','parts','targetJoints'] else np.float64))
    n=data['n'];outputs=[np.zeros(n*3),np.zeros(n*3),np.zeros(n*5,dtype=np.uint32),np.zeros(n*5,dtype=np.float32),np.zeros(21)]
    args=[data[k] for k in ['n','triangleCount','sourceJoints','targetCount','poses']]+[a.ctypes.data for a in arrays]+[data['radius']]+[a.ctypes.data for a in outputs]
    times=[]
    for _ in range(3):
        start=time.perf_counter();status=f(*args);times.append((time.perf_counter()-start)*1000)
        if status:raise ValueError(f'Native fitting rejected fixture: {status}')
    stats=outputs[-1]
    profile=dict(profile,ball_fit=dict(profile['ball_fit'],hand_offsets={name:stats[i*7:i*7+3].tolist() for i,name in enumerate(['L_Hand','R_Hand'])}))
    legacy=conform_ball(mesh,rig['skeleton'],profile)
    # Source origins in this API are float64. NumPy's float32 bind arrays round
    # scalar collar thresholds early; check that tiny legacy difference too.
    oracle=conform_ball(dict(mesh,bind=mesh['bind'].astype(np.float64)),rig['skeleton'],profile)
    position_error=float(np.max(np.abs(outputs[0].reshape(-1,3)-oracle['positions'])))
    normal_error=float(np.max(np.abs(outputs[1].reshape(-1,3)-oracle['normals'])))
    if position_error>1e-8 or normal_error>1e-7:raise ValueError(f'Native body mismatch: {position_error}, {normal_error}')
    legacy_position_error=float(np.max(np.abs(outputs[0].reshape(-1,3)-legacy['positions'])))
    legacy_normal_error=float(np.max(np.abs(outputs[1].reshape(-1,3)-legacy['normals'])))
    if legacy_position_error>1e-5 or legacy_normal_error>1e-4:
        raise ValueError('Native body diverges from legacy float32-origin geometry')
    for i,env in enumerate(oracle['envelopes']):
        actual=[(int(j),float(w)) for j,w in zip(outputs[2].reshape(-1,5)[i],outputs[3].reshape(-1,5)[i]) if j!=4294967295]
        if actual!=list(env):raise ValueError(f'Envelope mismatch at {i}: {actual} != {env}')
    result=dict(name=data['name'],referenceMs=data['referenceMs'],nativeMs=times,stats=stats.tolist(),
                positionError=position_error,normalError=normal_error,
                legacyPositionError=legacy_position_error,legacyNormalError=legacy_normal_error,
                originalOffsetDelta={name:float(np.linalg.norm(np.array(ref['offset'])-stats[i*7:i*7+3])) for i,(name,ref) in enumerate(data['referenceHands'].items())})
    for i,(name,ref) in enumerate(data['referenceHands'].items()):
        if result['originalOffsetDelta'][name]>1e-4 or stats[i*7+5]>ref['after_inside'] or stats[i*7+4]<ref['minimum_plane_clearance']-1e-5:
            raise ValueError('Hand clearance regressed for '+name)
    # Browser checks full native output independently of any Python calls.
    data['expectedPositions']=outputs[0].tolist();data['expectedNormals']=outputs[1].tolist()
    data['expectedJoints']=outputs[2].tolist();data['expectedWeights']=outputs[3].tolist();data['nativeStats']=stats.tolist()
    return result


def humanoid(source,game,lib,target='fox'):
    from opensmash_melee.multi_fighter import load_target,fit
    from opensmash_melee.retarget import conform
    from opensmash_melee.surfaces import smooth_normals,smoothing_scope
    mesh=GLB(source/'rigged.glb').mesh();rig=load(game,next(s for s in TARGETS if s[0]==target))
    flags=(1 if target=='mario' else 0)|(6 if target not in ['mario','fox','luigi','captain-falcon','link','marth'] else 0)
    with smoothing_scope():
        start=time.perf_counter()
        if target=='mario':
            from tools.fit_mario_profile import fit as mario_fit
            profile=mario_fit(source,game/'PlMrNr.dat')
        elif flags&2:
            from opensmash_melee.roster_fit import profile_for
            profile=profile_for(mesh,game,target)
        else:profile=fit(mesh,rig)
        reference=conform(mesh,rig['skeleton'],profile);elapsed=(time.perf_counter()-start)*1000
    names=['Root','Hip','Spine01','Spine02','NeckTwist01','NeckTwist02','Head']
    for side in ['L','R']:
        names += [side+'_'+suffix for suffix in ['Clavicle','Upperarm','UpperarmTwist01','UpperarmTwist02','Forearm','ForearmTwist01','ForearmTwist02','Hand','Thigh','ThighTwist01','ThighTwist02','Calf','CalfTwist01','CalfTwist02','Foot','ToeBase']]
    semantics=[names.index('Hip' if name in ['Pelvis','Waist'] else name) for name in mesh['names']]
    origins=[mesh['bind'][mesh['names'].index(name)][:3,3] for name in names]
    anatomy=np.zeros(59,dtype=np.uint32);anchors=np.zeros((59,3))
    if target=='mario':rig['mapping'][24]=24
    for old,joint in rig['mapping'].items():anatomy[old]=joint;anchors[old]=np.linalg.inv(rig['skeleton'][joint]['inverse_bind'])[:3,3]
    arrays=[np.asarray(mesh['positions'],dtype=np.float64).reshape(-1),np.asarray(smooth_normals(mesh)['normals'],dtype=np.float64).reshape(-1),
            np.asarray(mesh['weights'],dtype=np.float64).reshape(-1),np.asarray(mesh['joints'],dtype=np.uint32).reshape(-1),
            np.asarray(semantics,dtype=np.uint32),np.asarray(origins,dtype=np.float64).reshape(-1),anatomy,anchors.reshape(-1)]
    n=len(mesh['positions']);outputs=[np.zeros(n*3),np.zeros(n*3),np.zeros(n*4,dtype=np.uint32),np.zeros(n*4,dtype=np.float32)]
    f=lib.fit_humanoid;f.restype=ctypes.c_int;f.argtypes=[ctypes.c_uint]*3+[ctypes.c_void_p]*12
    args=[n,len(mesh['names']),flags]+[a.ctypes.data for a in arrays+outputs];times=[]
    for _ in range(5):
        start=time.perf_counter();status=f(*args);times.append((time.perf_counter()-start)*1000)
        if status:raise ValueError('Native humanoid fit rejected fixture: '+str(status))
    pe=float(np.max(np.abs(outputs[0].reshape(-1,3)-reference['positions'])))
    ne=float(np.max(np.abs(outputs[1].reshape(-1,3)-reference['normals'])))
    if pe>1e-5 or ne>1e-5:raise ValueError(f'Humanoid reference mismatch: {pe}, {ne}')
    for i,env in enumerate(reference['envelopes']):
        actual=[(int(j),float(w)) for j,w in zip(outputs[2].reshape(-1,4)[i],outputs[3].reshape(-1,4)[i]) if j!=4294967295]
        if actual!=list(env):raise ValueError('Humanoid envelope mismatch')
    data=dict(mode='humanoid',name=source.name+'-'+target,fitFlags=flags,n=n,sourceJoints=len(mesh['names']))
    for name,array in zip(['positions','normals','weights','joints','semantics','origins','anatomy','targetAnchors'],arrays):data[name]=array.tolist()
    for name,array in zip(['expectedPositions','expectedNormals','expectedJoints','expectedWeights'],outputs):data[name]=array.tolist()
    return data,dict(name=data['name'],referenceMs=elapsed,nativeMs=times,positionError=pe,normalError=ne)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,action='append',required=True)
    p.add_argument('--targets',nargs='+',choices=['kirby','jigglypuff'],default=['kirby','jigglypuff'])
    p.add_argument('--game',type=Path,default=ROOT/'assets/game/files')
    p.add_argument('--library',type=Path,required=True)
    p.add_argument('--output',type=Path,default=ROOT/'build/native-fit')
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);(a.output/'fixtures').mkdir(exist_ok=True)
    lib=ctypes.CDLL(str(a.library.resolve()));results=[]
    for source in a.source:
        data,result=humanoid(source,a.game,lib)
        (a.output/'fixtures'/(data['name']+'.json')).write_text(json.dumps(data))
        results.append(result);print(json.dumps(result),flush=True)
        for target in a.targets:
            data,mesh,rig,profile,reference=fixture(source,target,a.game)
            result=validate(lib,data,mesh,rig,profile,reference)
            (a.output/'fixtures'/(data['name']+'.json')).write_text(json.dumps(data))
            results.append(result);(a.output/'native.json').write_text(json.dumps(results,indent=2)+'\n')
            print(json.dumps(result),flush=True)


if __name__=='__main__':main()
