"""Bake source texture detail onto simplified head triangles for N64 TMEM."""
import numpy as np
from scipy.spatial import cKDTree


class SurfaceSampler:
    def __init__(self, vertices, faces, texture):
        self.triangles = vertices[faces, :3]
        self.uv = vertices[faces, 3:5]/32
        self.texture = texture
        self.tree = cKDTree(self.triangles.mean(axis=1))

    def sample(self, points):
        # Closest points on candidate source triangles preserve UV seams:
        # interpolate within the winning triangle, never between UV islands.
        ids = self.tree.query(points, k=min(32,len(self.triangles)))[1]
        if ids.ndim == 1:
            ids = ids[:,None]
        tris = self.triangles[ids]
        a,b,c = tris[:,:,0],tris[:,:,1],tris[:,:,2]
        ab,ac,ap = b-a,c-a,points[:,None,:]-a
        dot = lambda x,y: np.sum(x*y,axis=-1)
        d00,d01,d11 = dot(ab,ab),dot(ab,ac),dot(ac,ac)
        denom=d00*d11-d01*d01
        denom=np.where(np.abs(denom)>1e-12,denom,1e-12)
        v=(d11*dot(ap,ab)-d01*dot(ap,ac))/denom
        w=(d00*dot(ap,ac)-d01*dot(ap,ab))/denom
        bary=np.stack((1-v-w,v,w),axis=-1)
        distance=dot(ap-v[...,None]*ab-w[...,None]*ac,ap-v[...,None]*ab-w[...,None]*ac)
        distance=np.where(np.all(bary>=0,axis=-1),distance,np.inf)
        for start,end,si,ei in [(a,b,0,1),(b,c,1,2),(c,a,2,0)]:
            edge=end-start
            t=np.clip(dot(points[:,None,:]-start,edge)/np.maximum(dot(edge,edge),1e-12),0,1)
            delta=points[:,None,:]-(start+t[...,None]*edge)
            d=dot(delta,delta)
            better=d<distance
            edge_bary=np.zeros_like(bary);edge_bary[...,si]=1-t;edge_bary[...,ei]=t
            bary=np.where(better[...,None],edge_bary,bary)
            distance=np.minimum(distance,d)
        choice=distance.argmin(axis=1)
        rows=np.arange(len(points))
        uv=np.sum(self.uv[ids[rows,choice]]*bary[rows,choice,:,None],axis=1)
        h,w=self.texture.shape
        xy=np.clip(np.rint(uv).astype(int),[0,0],[w-1,h-1])
        return self.texture[xy[:,1],xy[:,0]] | 1

    def tile(self, triangle, size):
        # One texel of padding around the triangle keeps bilinear sampling
        # inside the source surface at edges. LoadTile consumes linear BE16.
        y,x=np.mgrid[:size,:size]
        v=(x.ravel()-1)/(size-3)
        w=(y.ravel()-1)/(size-3)
        weights=np.maximum(np.stack((1-v-w,v,w),axis=1),0)
        weights/=weights.sum(axis=1)[:,None]
        return self.sample(weights@triangle).astype('>u2').tobytes()
