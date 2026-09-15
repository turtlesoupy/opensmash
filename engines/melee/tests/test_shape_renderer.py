import unittest
import numpy as np
from PIL import Image
from tools.validate_shape import render

class RendererTests(unittest.TestCase):
    def test_gray_ignores_texture_and_preserves_light_response(self):
        points=np.array([[-1,-1,0],[1,-1,0],[0,1,0]],float)
        base=dict(positions=points,triangles=np.array([[0,1,2]]),uv=np.zeros((3,2)),
                  normals=np.array([[0,0,1.]]*3))
        samples=[]
        for color in ('red','blue'):
            mesh=dict(base,image=Image.new('RGB',(4,4),color))
            samples.append(render(mesh,[1,0,0],[0,1,0],3,[0,0],64,'gray',(0,0,1)).getpixel((32,32)))
        self.assertEqual(samples,[(180,180,180)]*2)
        dark=render(mesh,[1,0,0],[0,1,0],3,[0,0],64,'gray',(0,0,-1))
        self.assertEqual(dark.getpixel((32,32)),(45,45,45))

    def test_pose_normals_use_inverse_transpose_of_blended_matrix(self):
        from tools.validate_surfaces import pose_mesh
        worlds=np.array([np.eye(4),np.diag([3.,1,1,1])])
        mesh=dict(positions=np.array([[1.,1,0]]),normals=np.array([[1.,1,0]])/np.sqrt(2),
                  envelopes=[((0,.5),(1,.5))])
        result=pose_mesh(mesh,worlds,np.array([np.eye(4)]*2))
        np.testing.assert_allclose(result['positions'],[[2,1,0]])
        np.testing.assert_allclose(result['normals'],np.array([[.5,1,0]])/np.sqrt(1.25))

    def test_near_triangle_wins_regardless_of_submission_order(self):
        points=np.array([[-1,-1,0],[1,-1,0],[0,1,0],[-1,-1,1],[1,-1,1],[0,1,1]],float)
        texture=Image.new('RGB',(2,1));texture.putdata([(255,0,0),(0,0,255)])
        mesh=dict(positions=points,uv=np.array([[0,0]]*3+[[.75,0]]*3),image=texture)
        for tris in ([[0,1,2],[3,4,5]],[[3,4,5],[0,1,2]]):
            result=render(dict(mesh,triangles=np.array(tris)),[1,0,0],[0,1,0],3,[0,0],64)
            self.assertEqual(result.getpixel((32,32)),(0,0,255))
