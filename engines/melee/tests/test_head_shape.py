"""Head fitting regressions independent of downloaded rigs or game assets."""
import itertools
import unittest

import numpy as np

from opensmash_melee.proportions import source_head_fit
from opensmash_melee.retarget import conform
from tools.validate_shape import shape_metrics


def fixture(thickness=.1):
    head=np.array(list(itertools.product([-.2,.2],[-thickness,thickness],[-.2,.2])))
    head[:,1]+=1
    positions=np.vstack([head,[0,0,0],[0,2,0]])
    source_head=np.eye(4);source_head[1,3]=1
    target_head=np.eye(4);target_head[1,3]=2
    mesh={'names':['Body','Head'],'bind':[np.eye(4),source_head],
          'positions':positions,'normals':np.tile([0.,1.,0.],(10,1)),
          'joints':np.array([[1]]*8+[[0]]*2),'weights':np.ones((10,1))}
    skeleton=[{'inverse_bind':np.eye(4)},{'inverse_bind':np.linalg.inv(target_head)}]
    profile={'joint_map':{'Body':0,'Head':1},'fit_scales':{},
             'bone_corrections':{'Body':np.diag([2.2,2.2,2.2,1]).tolist(),
                                 'Head':np.diag([2.,2.,2.,1]).tolist()}}
    return mesh,skeleton,profile


class HeadShapeTests(unittest.TestCase):
    def test_reused_fit_matches_final_profile_exactly(self):
        for scale in (2.,2.2,3.,5.):
            with self.subTest(scale=scale):
                mesh,skeleton,profile=fixture()
                profile['bone_corrections']['Body']=np.diag([scale,scale,scale,1]).tolist()
                expected_profile=source_head_fit(mesh,skeleton,profile)
                actual_profile,fitted=source_head_fit(mesh,skeleton,profile,return_fitted=True)
                self.assertEqual(expected_profile,actual_profile)
                expected=conform(mesh,skeleton,expected_profile)
                for key in ('positions','normals'):
                    self.assertEqual(expected[key].tobytes(),fitted[key].tobytes())
                self.assertEqual(expected['envelopes'],fitted['envelopes'])

    def test_proportion_refinement_accounts_for_non_head_top(self):
        mesh,skeleton,profile=fixture()
        result=source_head_fit(mesh,skeleton,profile)
        fitted=conform(mesh,skeleton,result)
        metrics=shape_metrics(mesh,fitted,result,skeleton)
        self.assertLess(metrics['head_fraction_relative_error'],1e-8)
        self.assertAlmostEqual(result['fit_scales']['Head']['length'],2.2,places=7)
        self.assertAlmostEqual(metrics['head_anisotropy'],1)
        np.testing.assert_array_equal(result['bone_corrections']['Body'],profile['bone_corrections']['Body'])

    def test_compatible_proportions_keep_the_anchor_fit(self):
        mesh,skeleton,profile=fixture()
        profile['bone_corrections']['Body']=np.diag([2.,2.,2.,1]).tolist()
        result=source_head_fit(mesh,skeleton,profile)
        self.assertAlmostEqual(result['fit_scales']['Head']['length'],2)
        self.assertNotIn('proportion_refinement_version',result['head_reference'])

    def test_large_proportion_mismatch_remains_rejected(self):
        mesh,skeleton,profile=fixture()
        profile['bone_corrections']['Body']=np.diag([5.,5.,5.,1]).tolist()
        result=source_head_fit(mesh,skeleton,profile)
        metrics=shape_metrics(mesh,conform(mesh,skeleton,result),result,skeleton)
        self.assertGreater(metrics['head_fraction_relative_error'],.05)
        self.assertNotIn('proportion_refinement_version',result['head_reference'])

    def test_tall_target_preserves_authored_ratio_without_stretching_head(self):
        mesh,skeleton,profile=fixture()
        profile['bone_corrections']['Body']=np.diag([3.,3.,3.,1]).tolist()
        result=source_head_fit(mesh,skeleton,profile)
        metrics=shape_metrics(mesh,conform(mesh,skeleton,result),result,skeleton)
        self.assertLess(metrics['head_fraction_relative_error'],1e-8)
        self.assertAlmostEqual(result['fit_scales']['Head']['length'],3,places=7)
        self.assertAlmostEqual(metrics['head_anisotropy'],1)
        np.testing.assert_array_equal(result['bone_corrections']['Body'],profile['bone_corrections']['Body'])

    def test_flat_sample_does_not_amplify_small_blending_error(self):
        mesh,skeleton,profile=fixture(.001)
        fitted=conform(mesh,skeleton,profile)
        # A tiny absolute displacement doubles the apparent thickness.
        fitted['positions'][:8,1]+=(mesh['positions'][:8,1]-1)*2
        metrics=shape_metrics(mesh,fitted,profile,skeleton)
        self.assertEqual(metrics['head_anisotropy_method'],'head_transform')
        self.assertAlmostEqual(metrics['head_anisotropy'],1)
        self.assertLess(metrics['similarity_max_relative_error'],.025)

    def test_flat_sample_still_rejects_stretched_head_transform(self):
        mesh,skeleton,profile=fixture(.001)
        profile['bone_corrections']['Head'][1][1]=4
        metrics=shape_metrics(mesh,conform(mesh,skeleton,profile),profile,skeleton)
        self.assertGreater(metrics['head_anisotropy'],1.9)

    def test_flat_sample_still_detects_large_blended_displacement(self):
        mesh,skeleton,profile=fixture(.001)
        fitted=conform(mesh,skeleton,profile)
        fitted['positions'][0,0]+=1
        metrics=shape_metrics(mesh,fitted,profile,skeleton)
        self.assertGreater(metrics['similarity_max_relative_error'],.025)

    def test_full_volume_sample_still_measures_actual_geometry(self):
        mesh,skeleton,profile=fixture()
        fitted=conform(mesh,skeleton,profile)
        fitted['positions'][:8,1]*=2
        metrics=shape_metrics(mesh,fitted,profile,skeleton)
        self.assertEqual(metrics['head_anisotropy_method'],'geometry')
        self.assertGreater(metrics['head_anisotropy'],1.9)
