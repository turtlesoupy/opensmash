"""Conservative surface cleanup for generated single-atlas characters."""
import copy
import numpy as np

SURFACE_VERSION = 1
TEXTURE_SIZE = 512


# This cache exists only during one build; no cross-request invalidation/state.
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
_smoothing_cache = ContextVar('melee_build_smoothing', default=None)

@contextmanager
def smoothing_scope():
    token = _smoothing_cache.set({})
    try:
        yield
    finally:
        _smoothing_cache.reset(token)

def prepared_normals(mesh, angle_degrees):
    cache = _smoothing_cache.get()
    if cache is None:
        return smooth_normals(mesh, angle_degrees)
    digest = hashlib.sha256()
    for name in ('positions', 'normals', 'triangles'):
        array = mesh[name]
        digest.update(str((array.dtype.str, array.shape)).encode())
        digest.update(array.tobytes())
    key = (digest.digest(), angle_degrees)
    if key not in cache:
        cache[key] = smooth_normals(mesh, angle_degrees)['normals']
    # Callers can change a fitted mesh without modifying this build's copy.
    return dict(mesh, normals=cache[key].copy())


def smooth_normals(mesh, angle_degrees=55):
    """Filter authored normals over connected shallow-angle neighborhoods.

    Two bounded passes soften shading on coarse generated surfaces. Positions,
    indices, UVs and weights are untouched. Neighbors across an authored normal
    discontinuity are excluded; disconnected coincident shells are not joined.
    """
    if not 0 < angle_degrees < 90:
        raise ValueError('Smoothing angle must be between 0 and 90 degrees')
    positions=mesh['positions'];tris=mesh['triangles']
    original=mesh['normals']/np.linalg.norm(mesh['normals'],axis=1)[:,None]
    limit=np.cos(np.deg2rad(angle_degrees))
    _, welded=np.unique(positions,axis=0,return_inverse=True)
    edges={};parent=list(range(len(positions)))
    def root(v):
        while parent[v]!=v:
            parent[v]=parent[parent[v]];v=parent[v]
        return v
    # Python ints avoid thousands of NumPy scalar indexing/conversion calls.
    # Preserve triangle/corner order: union order affects floating-point means.
    corners=[(a,b) for tri in tris.tolist() for a,b in
             ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0]))]
    welded=welded.tolist()
    original_rows=list(original)
    for v,u in corners:
        a,b=welded[v],welded[u]
        edge=(a,b) if a<=b else (b,a)
        edges.setdefault(edge,[]).append((v,u))
    # UV duplicate corners must share their complete normal neighborhood, not
    # merely become neighbors: otherwise filtering introduces visible seams.
    for pairs in edges.values():
        if len(pairs)!=2:continue
        for v in pairs[0]:
            for u in pairs[1]:
                if welded[v]==welded[u] and original_rows[v]@original_rows[u]>=limit:
                    parent[root(v)]=root(u)
    groups={}
    for v in range(len(positions)):groups.setdefault(root(v),[]).append(v)
    keys=list(groups);index={k:i for i,k in enumerate(keys)}
    ids=np.array([index[root(v)] for v in range(len(positions))])
    normals=np.array([original[groups[k]].mean(axis=0) for k in keys])
    normals/=np.linalg.norm(normals,axis=1)[:,None]
    adjacency=[set() for _ in keys]
    group_ids=ids.tolist()
    normal_rows=list(normals)
    checked=set()
    for v,u in corners:
        a,b=group_ids[v],group_ids[u]
        if a==b or (a,b) in checked:continue
        checked.add((a,b))
        if normal_rows[a]@normal_rows[b]>=limit:
            adjacency[a].add(b);adjacency[b].add(a)
    neighbors_by_vertex=[sorted(neighbors) for neighbors in adjacency]
    # Batch equal-sized neighborhoods, retaining each sorted reduction order.
    by_size={}
    for v,neighbors in enumerate(neighbors_by_vertex):
        if neighbors:by_size.setdefault(len(neighbors),[]).append(v)
    batches=[(np.asarray(vertices),np.asarray([neighbors_by_vertex[v] for v in vertices]))
             for vertices in by_size.values()]
    for _ in range(2):
        result=normals.copy()
        means=np.empty_like(normals)
        for vertices,neighbors in batches:
            means[vertices]=normals[neighbors].mean(axis=1)
        for v,neighbors in enumerate(neighbors_by_vertex):
            if not neighbors:continue
            mean=means[v]
            n=.5*normals[v]+.5*mean
            if np.linalg.norm(n)>1e-10:result[v]=n/np.linalg.norm(n)
        normals=result
    return dict(mesh,normals=normals[ids])


def refine_profile(mesh,skeleton,profile):
    """Keep terminal shapes upright and continuous with their parent limbs."""
    p=copy.deepcopy(profile)
    orientation=np.array([[0,0,-1],[0,1,0],[1,0,0]],float)
    bind=dict(zip(mesh['names'],mesh['bind']))
    for side in ('L','R'):
        for part,parent in (('Hand','Forearm'),('Foot',None)):
            name=side+'_'+part
            if name not in bind or name not in p['joint_map']:continue
            joint=p['joint_map'][name];target=np.linalg.inv(skeleton[joint]['inverse_bind'])
            scale=p['fit_scales'][name]['width']
            rotation=orientation
            if parent:
                ancestor=side+'_'+parent;j=p['joint_map'][ancestor]
                parent_bind=np.linalg.inv(skeleton[j]['inverse_bind'])
                affine=parent_bind@np.array(p['bone_corrections'][ancestor])@np.linalg.inv(bind[ancestor])
                u,_,vt=np.linalg.svd(affine[:3,:3]);rotation=u@vt
            affine=np.eye(4);affine[:3,:3]=rotation*scale
            affine[:3,3]=target[:3,3]-affine[:3,:3]@bind[name][:3,3]
            names=(name,side+'_ToeBase') if part=='Foot' else (name,)
            for n in names:
                if n in bind:
                    p['bone_corrections'][n]=(np.linalg.inv(target)@affine@bind[n]).tolist()
            p['fit_scales'][name]={'length':float(scale),'width':float(scale)}
    p.update(surface_version=SURFACE_VERSION,texture_size=TEXTURE_SIZE,normal_smoothing_degrees=55)
    return p
