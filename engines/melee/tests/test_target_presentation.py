import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from opensmash_melee.target_presentation import stature
from opensmash_melee.presentation import stock_image


class TargetPresentationTests(unittest.TestCase):
    def test_stature_matches_target_ground_and_height_without_anisotropy(self):
        # Tall chibi including a hat, with feet slightly below the origin.
        points=np.array([[-4,-1,-2],[4,-1,2],[-3,30,-1],[3,30,1]],float)
        target=np.array([[-3,-.2,-1],[3,17.8,1]],float)
        fit=stature({'positions':points},target)
        result=points*fit['scale'];result[:,1]+=fit['offset']
        self.assertAlmostEqual(result[:,1].min(),-.2)
        self.assertAlmostEqual(result[:,1].max(),17.8)
        # Pairwise distances all change by the same factor, including head shape.
        np.testing.assert_allclose(np.linalg.norm(result[:,None]-result,axis=2),
                                   np.linalg.norm(points[:,None]-points,axis=2)*fit['scale'])
        np.testing.assert_array_equal(points,[[-4,-1,-2],[4,-1,2],[-3,30,-1],[3,30,1]])

    def test_stock_keys_green_but_preserves_black_hat_and_existing_alpha(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'stock.png'
            im=Image.new('RGBA',(16,16),(0,255,0,255));im.paste((0,0,0,255),(5,3,11,8));im.save(p)
            keyed=stock_image(p)
            self.assertEqual(keyed.getpixel((2,2))[3],0)
            self.assertEqual(keyed.getpixel((6,4)),(0,0,0,255))
            im.putpixel((0,0),(0,0,0,0));im.save(p)
            np.testing.assert_array_equal(stock_image(p),im)

    def test_attachment_clearance_accounts_for_native_weapon_size(self):
        from unittest.mock import patch
        from opensmash_melee.target_presentation import attachment_offsets
        skeleton=[dict(index=i,parent=None,inverse_bind=np.eye(4).tolist()) for i in range(72)]
        mesh=dict(positions=np.array([[0,0,-3],[0,0,2],[0,0,-2],[0,0,4.]],float),
                  envelopes=[((55,1.),),((55,1.),),((18,1.),),((40,1.),)])
        original=np.array([[0,0,-1],[0,0,1.]],float)
        with patch('tools.inspect_costume_bounds.inspect',return_value=(original,None)):
            offsets=attachment_offsets(mesh,skeleton,'original.dat','link',2.)
        np.testing.assert_allclose(offsets['67'],[0,0,-1])
        np.testing.assert_allclose(offsets['69'],[0,0,2])
        self.assertEqual(attachment_offsets(mesh,skeleton,'original.dat','mario',2.),{})

    def test_weapon_clearance_keeps_mount_and_native_dimensions(self):
        from opensmash_melee.target_presentation import clearance_rotation
        anchor=np.array([0.,10.,0.])
        points=np.array([[0.,10.,0.],[2.,1.,0.],[-.1,9.,.2]])
        for fit in [.6,.73,.95]:
            rotation=clearance_rotation(points,anchor,fit,0.)
            fitted=(rotation@(points-anchor).T).T+anchor*fit
            self.assertGreaterEqual(fitted[:,1].min(),.25-1e-8)
            np.testing.assert_allclose(fitted[0],anchor*fit,atol=1e-8)
            np.testing.assert_allclose(rotation.T@rotation,np.eye(3),atol=1e-8)
            np.testing.assert_allclose(np.linalg.norm(fitted[:,None]-fitted,axis=2),
                                       np.linalg.norm(points[:,None]-points,axis=2),atol=1e-8)
        np.testing.assert_allclose(clearance_rotation(points,anchor,1.,0.),np.eye(3))
