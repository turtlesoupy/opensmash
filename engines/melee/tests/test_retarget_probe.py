import copy, unittest
from pathlib import Path
import numpy as np
from opensmash_melee.archive import Archive
from opensmash_melee.gx import isolate_body_texture_animation
from opensmash_melee.retarget_probe import TARGETS,load
from opensmash_melee.multi_fighter import TARGETS as SHIPPING,load_target,fit
from opensmash_melee.proportions import source_head_fit
from opensmash_melee.glb import GLB
from opensmash_melee.retarget import conform
from opensmash_melee.target_presentation import attachment_transform
from tools.validate_shape import shape_metrics
ROOT=Path(__file__).resolve().parents[1];GAME=ROOT/'assets/game/files'
SOURCE=ROOT.parent/'opensmash/pipeline/play/ui/alanturing/rigged.glb'

@unittest.skipUnless((GAME/'PlPpNr.dat').exists(),'Local validated game assets required')
class ProbeTests(unittest.TestCase):
 def test_material_isolation_preserves_other_list_entries(self):
  a=Archive.read(GAME/'PlPpNr.dat');symbol='PlyPopo5K_Share_joint';r=a.roots()['PlyPopo5K_Share_matanim_joint'];old=a.ptr(r+8);raw=bytes(a.data[old:old+16]);following=a.ptr(old)
  self.assertIsNotNone(a.ptr(old+8))
  image=a.alloc(24)
  self.assertTrue(isolate_body_texture_animation(a,symbol,0,image))
  new=a.ptr(r+8);self.assertNotEqual(new,old)
  self.assertEqual(bytes(a.data[old:old+16]),raw)
  self.assertEqual(a.ptr(new),following)
  self.assertEqual(a.ptr(new+4),a.ptr(old+4))
  tex=a.ptr(new+8);oldtex=a.ptr(old+8)
  self.assertNotEqual(tex,oldtex);self.assertEqual(a.ptr(tex+8),a.ptr(oldtex+8))
  count=a.unpack('H',tex+20)[0];self.assertGreater(count,0)
  self.assertEqual([a.ptr(a.ptr(tex+12)+i*4) for i in range(count)],[image]*count)
  b=Archive(a.serialize());self.assertEqual(b.ptr(new),following)
 def test_unbound_rigid_attachment_has_guarded_fallback(self):
  t=load(GAME,next(s for s in TARGETS if s[0]=='roy'));sk=t['skeleton']
  self.assertIsNone(sk[78]['inverse_bind'])
  p={'attachment_scale':1.5,'attachment_anchors':{'78':77}}
  m=attachment_transform(sk,'roy',78,p)
  np.testing.assert_allclose(np.linalg.svd(m[:3,:3],compute_uv=False),[1.5]*3,atol=1e-6)
  bad=copy.deepcopy(sk);bad[78]['scale']=[2,1,1]
  with self.assertRaisesRegex(ValueError,'scaled ancestry'):attachment_transform(bad,'roy',78,p)
 @unittest.skipUnless(SOURCE.exists(),'Local source mesh required')
 def test_all_rigs_fit_and_existing_targets_are_unchanged(self):
  mesh=GLB(SOURCE).mesh()
  for spec in TARGETS:
   with self.subTest(target=spec[0]):
    t=load(GAME,spec);p=fit(mesh,t)
    if spec[0] in SHIPPING:
     old=load_target(GAME,spec[0]);np.testing.assert_allclose(conform(mesh,t['skeleton'],p)['positions'],conform(mesh,old['skeleton'],fit(mesh,old))['positions'],atol=1e-8)
    p=source_head_fit(mesh,t['skeleton'],p);c=conform(mesh,t['skeleton'],p);m=shape_metrics(mesh,c,p,t['skeleton'])
    self.assertLess(m['head_anisotropy'],1.03);self.assertLess(m['head_fraction_relative_error'],.05)
    self.assertTrue(np.isfinite(c['positions']).all())

 @unittest.skipUnless(SOURCE.exists(),'Local source mesh required')
 def test_ball_fit_preserves_head_topology_and_limb_joints(self):
  for source in [SOURCE,SOURCE.parent.parent/'abrahamlincoln/rigged.glb']:
   mesh=GLB(source).mesh();head=mesh['names'].index('Head')
   weight=np.where(mesh['joints']==head,mesh['weights'],0).sum(axis=1)
   core=(weight>.999)&(mesh['positions'][:,1]>mesh['bind'][head][1,3]+.10*np.ptp(mesh['positions'][:,1]))
   self.assertGreater(core.sum(),20)
   for slug in ['kirby','jigglypuff']:
    target=load(GAME,next(t for t in TARGETS if t[0]==slug));profile=fit(mesh,target)
    profile['ball_fit']={'version':1,'radius':4.3}
    fitted=conform(mesh,target['skeleton'],profile)
    np.testing.assert_array_equal(fitted['triangles'],mesh['triangles'])
    np.testing.assert_array_equal(fitted['uv'],mesh['uv'])
    self.assertTrue(np.isfinite(fitted['positions']).all())
    self.assertTrue(np.isfinite(fitted['normals']).all())
    x=mesh['positions'][core];y=fitted['positions'][core]
    affine=np.linalg.lstsq(np.c_[x,np.ones(len(x))],y,rcond=None)[0]
    singular=np.linalg.svd(affine[:3],compute_uv=False)
    self.assertLess(singular.max()/singular.min(),1.001)
    np.testing.assert_allclose(np.c_[x,np.ones(len(x))]@affine,y,atol=1e-6)
    for env in fitted['envelopes']:self.assertAlmostEqual(sum(w for _,w in env),1,places=5)
    joints={j for env in fitted['envelopes'] for j,w in env if w>.9}
    for name in ['Head','L_Hand','R_Hand','L_Foot','R_Foot']:self.assertIn(profile['joint_map'][name],joints)

 @unittest.skipUnless(SOURCE.exists() and (ROOT/'build/retarget-roster-probe/kirby/poses.json').exists(),'Local pose samples required')
 def test_ball_hand_clearance_keeps_authored_shoes(self):
  import json
  from tools.fit_ball_hands import fit_hands
  mesh=GLB(SOURCE).mesh();target=load(GAME,next(t for t in TARGETS if t[0]=='kirby'));profile=fit(mesh,target)
  profile['ball_fit']={'version':1,'radius':4.3}
  samples=json.loads((ROOT/'build/retarget-roster-probe/kirby/poses.json').read_text()).get('clearancePoses')
  if not samples:self.skipTest('Regenerate sampled clearance poses')
  before=conform(mesh,target['skeleton'],profile);updated=fit_hands(mesh,target['skeleton'],profile,samples);after=conform(mesh,target['skeleton'],updated)
  hands=updated['ball_fit']['hand_clearance']['hands']
  self.assertGreater(sum(r['before_inside'] for r in hands.values()),0)
  self.assertEqual(sum(r['after_inside'] for r in hands.values()),0)
  footids=[mesh['names'].index(n) for n in ['L_Foot','L_ToeBase','R_Foot','R_ToeBase']]
  shoes=np.where(np.isin(mesh['joints'],footids),mesh['weights'],0).sum(axis=1)>.9
  np.testing.assert_allclose(before['positions'][shoes],after['positions'][shoes],atol=1e-8)
  np.testing.assert_array_equal(mesh['uv'][shoes],after['uv'][shoes])
  self.assertIs(after['image'],mesh['image'])
