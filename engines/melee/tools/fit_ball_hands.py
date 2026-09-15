"""Solve static hand offsets against sampled head poses; no runtime IK cost.

Requires SciPy for this optional offline fitting step, not for game launches.
"""
import copy,json,sys
from pathlib import Path
import numpy as np
from scipy.spatial import ConvexHull
from scipy.optimize import minimize
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.retarget import conform,skin


def fit_hands(mesh,skeleton,profile,samples):
    p=copy.deepcopy(profile);p['ball_fit']['hand_offsets']={}
    fitted=conform(mesh,skeleton,p);hj=p['joint_map']['Head']
    head_weights=np.where(mesh['joints']==mesh['names'].index('Head'),mesh['weights'],0).sum(axis=1)
    head_points=fitted['positions'][head_weights>.9]
    hull=ConvexHull(head_points);planes=hull.equations
    ib=[np.asarray(j['inverse_bind']) if j['inverse_bind'] is not None else np.eye(4) for j in skeleton]
    worlds=[np.array(s['worlds']) for s in samples]
    results={}
    for name in ['L_Hand','R_Hand']:
        source=mesh['names'].index(name);weights=np.where(mesh['joints']==source,mesh['weights'],0).sum(axis=1)
        ids=np.flatnonzero(weights>.85)
        if len(ids)<4:continue
        # Extreme vertices bound the fist without processing interior duplicates.
        ids=ids[ConvexHull(fitted['positions'][ids]).vertices]
        joint=p['joint_map'][name];points=[];changes=[]
        for pose in worlds:
            head_inv=np.linalg.inv(pose[hj]@ib[hj])
            posed=skin(fitted['positions'][ids],[fitted['envelopes'][i] for i in ids],pose,ib)
            points.append((np.c_[posed,np.ones(len(posed))]@head_inv.T)[:,:3])
            w=np.array([dict(fitted['envelopes'][i]).get(joint,0) for i in ids])
            changes.append(w[:,None,None]*(head_inv@pose[joint]@ib[joint])[:3,:3])
        points=np.concatenate(points);changes=np.concatenate(changes)
        def distances(offset):
            candidates=points+np.einsum('nij,j->ni',changes,offset)
            return (candidates@planes[:,:3].T+planes[:,3]).max(axis=1)
        def objective(offset):
            penetration=np.maximum(.18-distances(offset),0)
            return 100*np.mean(penetration**2)+.001*np.dot(offset,offset)
        radius=p['ball_fit']['radius']
        candidates=[minimize(objective,seed,method='Powell',bounds=[(-radius*1.7,radius*1.7)]*3,options={'maxiter':100,'xtol':.005,'ftol':1e-6}) for seed in [np.zeros(3),np.array([0,-radius,0])]]
        result=min(candidates,key=lambda x:objective(x.x));before=distances(np.zeros(3));after=distances(result.x)
        p['ball_fit']['hand_offsets'][name]=result.x.tolist()
        results[name]=dict(offset=result.x.tolist(),sampled_points=len(points),before_inside=int((before<0).sum()),after_inside=int((after<0).sum()),minimum_plane_clearance=float(after.min()))
    p['ball_fit']['hand_clearance']=dict(samples=len(samples),hands=results)
    return p

if __name__=='__main__':
    from opensmash_melee.glb import GLB
    folder=ROOT/'build/retarget-roster-probe'
    for slug in ['kirby','jigglypuff']:
        target=json.loads((folder/slug/'target.json').read_text());samples=json.loads((folder/slug/'poses.json').read_text())['clearancePoses']
        for source in ['alanturing','abrahamlincoln']:
            file=folder/slug/(source+'-profile.json');profile=json.loads(file.read_text());mesh=GLB(ROOT.parents[1]/'play/ui'/source/'rigged.glb').mesh()
            updated=fit_hands(mesh,target['skeleton'],profile,samples);file.write_text(json.dumps(updated,indent=2)+'\n');print(slug,source,updated['ball_fit']['hand_clearance'],flush=True)
