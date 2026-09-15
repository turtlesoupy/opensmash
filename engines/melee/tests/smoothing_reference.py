"""Frozen pre-optimization normal smoothing oracle for exact-output tests."""
import numpy as np

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
    for tri in tris:
        for k,v in enumerate(tri):
            u=tri[(k+1)%3]
            edge=tuple(sorted((int(welded[v]),int(welded[u]))))
            edges.setdefault(edge,[]).append((int(v),int(u)))
    # UV duplicate corners must share their complete normal neighborhood, not
    # merely become neighbors: otherwise filtering introduces visible seams.
    for pairs in edges.values():
        if len(pairs)!=2:continue
        for v in pairs[0]:
            for u in pairs[1]:
                if welded[v]==welded[u] and original[v]@original[u]>=limit:
                    parent[root(v)]=root(u)
    groups={}
    for v in range(len(positions)):groups.setdefault(root(v),[]).append(v)
    keys=list(groups);index={k:i for i,k in enumerate(keys)}
    ids=np.array([index[root(v)] for v in range(len(positions))])
    normals=np.array([original[groups[k]].mean(axis=0) for k in keys])
    normals/=np.linalg.norm(normals,axis=1)[:,None]
    adjacency=[set() for _ in keys]
    for tri in tris:
        for k,v in enumerate(tri):
            a,b=ids[v],ids[tri[(k+1)%3]]
            if a!=b and normals[a]@normals[b]>=limit:
                adjacency[a].add(b);adjacency[b].add(a)
    for _ in range(2):
        result=normals.copy()
        for v,neighbors in enumerate(adjacency):
            if not neighbors:continue
            mean=normals[sorted(neighbors)].mean(axis=0)
            n=.5*normals[v]+.5*mean
            if np.linalg.norm(n)>1e-10:result[v]=n/np.linalg.norm(n)
        normals=result
    return dict(mesh,normals=normals[ids])

