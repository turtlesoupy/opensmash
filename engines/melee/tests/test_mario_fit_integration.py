"""Local asset integration regressions; skipped without the user's game/rigs."""
import unittest
from pathlib import Path
from tools.audit_characters import audit
from tools.fit_mario_profile import rotation_between
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'opensmash/pipeline/play/ui'
COSTUME=ROOT/'assets/game/files/PlMrNr.dat'


class FitTests(unittest.TestCase):
    def test_opposite_axis_rotation_is_rigid(self):
        r=rotation_between(np.array([0.,1.,0.]),np.array([0.,-1.,0.]))
        np.testing.assert_allclose(r@[0,1,0],[0,-1,0],atol=1e-12)
        np.testing.assert_allclose(r.T@r,np.eye(3),atol=1e-12)
        self.assertAlmostEqual(np.linalg.det(r),1)

    @unittest.skipUnless(COSTUME.exists() and (SOURCE/'captainahab/rigged.glb').exists(),'Requires local validated game and generated character fixtures')
    def test_real_chibi_heads_and_unused_peg_foot_are_supported(self):
        for slug in ('rowanatkinson','stevejobs','countdracula','captainahab'):
            with self.subTest(character=slug):
                result=audit((SOURCE/slug,COSTUME))
                self.assertEqual(result['status'],'compatible',result)
                self.assertTrue(np.isfinite(result['head_anisotropy']))

    @unittest.skipUnless(COSTUME.exists() and (SOURCE/'rowanatkinson/rigged.glb').exists(),'Requires local assets')
    def test_head_reaches_reference_geometry_not_short_terminal_bone(self):
        from tools.fit_mario_profile import fit
        from tools.inspect_costume_bounds import inspect
        from opensmash_melee.glb import GLB
        from opensmash_melee.archive import Archive
        from opensmash_melee.skeleton import joints
        from opensmash_melee.retarget import conform
        m=GLB(SOURCE/'rowanatkinson/rigged.glb').mesh()
        p=fit(SOURCE/'rowanatkinson',COSTUME,head_style='uniform')
        c=conform(m,joints(Archive.read(COSTUME),p['symbol']),p)
        i=m['names'].index('Head')
        w=np.where(m['joints']==i,m['weights'],0).sum(axis=1)
        self.assertAlmostEqual(float(c['positions'][w>.99,1].max()),float(inspect(str(COSTUME))[1][:,1].max()),delta=.15)

    @unittest.skipUnless((ROOT/'build/validation-v5/rowanatkinson/profile.json').exists(),'Requires historical profile')
    def test_source_shape_gate_rejects_the_pancaked_fit(self):
        import json
        from tools.fit_mario_profile import fit
        from tools.validate_shape import shape_metrics
        from opensmash_melee.glb import GLB
        from opensmash_melee.archive import Archive
        from opensmash_melee.skeleton import joints
        from opensmash_melee.retarget import conform
        mesh=GLB(SOURCE/'rowanatkinson/rigged.glb').mesh()
        skeleton=joints(Archive.read(COSTUME),'PlyMario5K_Share_joint')
        old=json.loads((ROOT/'build/validation-v5/rowanatkinson/profile.json').read_text())
        current=fit(SOURCE/'rowanatkinson',COSTUME)
        bad=shape_metrics(mesh,conform(mesh,skeleton,old),old,skeleton)
        good=shape_metrics(mesh,conform(mesh,skeleton,current),current,skeleton)
        self.assertGreater(bad['head_anisotropy'],1.6)
        self.assertGreater(bad['head_fraction_relative_error'],.3)
        self.assertLess(good['head_anisotropy'],1.01)
        self.assertLess(good['head_fraction_relative_error'],.01)
        from opensmash_melee.proportions import source_head_fit
        previous_head=source_head_fit(mesh,skeleton,old)['bone_corrections']['Head']
        np.testing.assert_allclose(current['bone_corrections']['Head'],previous_head,atol=1e-7)
        changed={'Head','L_Hand','R_Hand','L_Foot','R_Foot','L_ToeBase','R_ToeBase'}
        for bone,matrix in old['bone_corrections'].items():
            if bone not in changed:np.testing.assert_allclose(current['bone_corrections'][bone],matrix,atol=1e-7)
