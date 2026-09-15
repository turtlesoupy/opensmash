import unittest
import numpy as np
from opensmash_melee.surfaces import smooth_normals, refine_profile


class SurfaceTests(unittest.TestCase):
    def test_browser_preserves_warm_slot_capacity_for_large_costumes(self):
        from tests.test_pipeline import fixture,mesh_fixture
        from opensmash_melee.skeleton import joints
        from opensmash_melee.retarget import conform
        from opensmash_melee.browser_skin import build_costume
        a=fixture();skel=joints(a,'custom_joint')
        profile=dict(joint_map={'root':0,'head':1},mesh_joint=0,texture_size=512)
        mesh=conform(mesh_fixture(),skel,profile)
        _,stats=build_costume(a.serialize(),mesh,skel,profile)
        self.assertEqual(stats['texture_size'],512)
        a.append(bytes(1100000))
        raw,stats=build_costume(a.serialize(),mesh,skel,profile)
        self.assertEqual(stats['texture_size'],256)
        self.assertLessEqual(len(raw),2*1024*1024)

    def test_uv_duplicate_corners_stay_identical_after_smoothing(self):
        # The shared diagonal is split into two UV islands with different
        # outer neighbors; naive per-index filtering creates a shading seam.
        positions=np.array([[0.,0,0],[1,0,0],[1,1,0],[0,0,0],[1,1,0],[0,1,0]])
        normals=np.array([[0.,0,1],[.3,0,1],[0,0,1],[0,0,1],[0,0,1],[0,.3,1]])
        mesh=dict(positions=positions,normals=normals,triangles=np.array([[0,1,2],[3,4,5]]),uv=np.arange(12).reshape(6,2))
        out=smooth_normals(mesh)
        np.testing.assert_array_equal(out['normals'][0],out['normals'][3])
        np.testing.assert_array_equal(out['normals'][2],out['normals'][4])
        np.testing.assert_allclose(np.linalg.norm(out['normals'],axis=1),1)
        for key in ('positions','triangles','uv'):np.testing.assert_array_equal(out[key],mesh[key])

    def test_sharp_normal_split_is_preserved(self):
        positions=np.array([[0.,0,0],[1,0,0],[0,1,0],[0,0,0],[1,0,0],[0,0,1]])
        normals=np.array([[0.,0,1]]*3+[[0,1,0]]*3)
        out=smooth_normals(dict(positions=positions,normals=normals,triangles=np.array([[0,1,2],[3,5,4]])))
        np.testing.assert_array_equal(out['normals'],normals)

    def test_terminal_fit_preserves_shape_and_head_correction(self):
        names=['L_Forearm','L_Hand','L_Foot','L_ToeBase','Head']
        bind=np.array([np.eye(4)]*5);bind[1,:3,3]=[0,0,-1];bind[2,:3,3]=[0,-1,0];bind[3,:3,3]=[.2,-1,0]
        skeleton=[dict(inverse_bind=np.eye(4).tolist()) for _ in names]
        orientation=np.array([[0,0,-1],[0,1,0],[1,0,0]],float)
        correction=np.eye(4);correction[:3,:3]=orientation@np.diag([2.,2,3])
        p=dict(joint_map=dict(zip(names,range(5))),bone_corrections={n:np.eye(4).tolist() for n in names},
               fit_scales={n:dict(length=3.,width=2.) for n in names})
        p['bone_corrections']['L_Forearm']=correction.tolist()
        out=refine_profile(dict(names=names,bind=bind),skeleton,p)
        self.assertEqual(out['bone_corrections']['Head'],p['bone_corrections']['Head'])
        for n in ['L_Hand','L_Foot']:
            i=names.index(n);a=np.array(out['bone_corrections'][n])@np.linalg.inv(bind[i])
            np.testing.assert_allclose(np.linalg.svd(a[:3,:3],compute_uv=False),[2]*3)
            np.testing.assert_allclose((a@np.r_[bind[i,:3,3],1])[:3],[0,0,0])
        a=np.array(out['bone_corrections']['L_Hand'])@np.linalg.inv(bind[1])
        np.testing.assert_allclose(a[:3,:3],orientation*2,atol=1e-10)
        self.assertNotIn('surface_version',p)
