"""Regression checks for canonical weight cleanup."""
from pathlib import Path
import sys
import struct
import os
import json
import tempfile
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from skinning.export import damp_arm_leaks, blank_joint_ids

class WeightCleanupTests(unittest.TestCase):
    def setUp(self):
        self.frames=np.zeros((3,12))
        self.frames[1,:3]=[0,100,0]
        self.frames[2,:3]=[100,100,0]
        self.parents=[-1,0,1]
        self.slots=np.array([[0,1,0,0]])

    def test_distant_waist_vertex_loses_minor_arm_influence(self):
        weights,changed=damp_arm_leaks(np.array([[0,0,0]]),self.slots,np.array([[200,55,0,0]]),self.frames,self.parents)
        np.testing.assert_array_equal(weights,[[255,0,0,0]])
        self.assertEqual(changed,1)

    def test_near_shoulder_keeps_minor_arm_influence(self):
        weights,changed=damp_arm_leaks(np.array([[10,100,0]]),self.slots,np.array([[200,55,0,0]]),self.frames,self.parents)
        np.testing.assert_array_equal(weights,[[200,55,0,0]])
        self.assertEqual(changed,0)

    def test_dominant_sleeve_weight_is_preserved(self):
        weights,changed=damp_arm_leaks(np.array([[0,0,0]]),self.slots,np.array([[55,200,0,0]]),self.frames,self.parents)
        np.testing.assert_array_equal(weights,[[55,200,0,0]])
        self.assertEqual(changed,0)

class BodyBlankingTests(unittest.TestCase):
    def test_extra_body_parts_are_hidden_but_unlisted_props_survive(self):
        data=b'BLNK'+struct.pack('<4I',3,5,7,12)
        self.assertEqual(blank_joint_ids(data,0,[6,8,16]),{5,7,12})

    def test_old_assets_fall_back_to_skinned_joint_set(self):
        self.assertEqual(blank_joint_ids(b'',0,[6,8,8]),{6,8})

    def test_truncated_blank_list_is_rejected(self):
        with self.assertRaises(ValueError):
            blank_joint_ids(b'BLNK'+struct.pack('<I',3),0,[6])

@unittest.skipUnless(os.environ.get('SKIN_ROM'), 'Built ROM native source manifest required')
class NativeContractTests(unittest.TestCase):
    def test_native_behavior_change_requires_parity_review(self):
        from skinning.native_pose import generate, function
        manifest=Path(os.environ['SKIN_ROM']).parent/'mips-runtime/native_pose.json'
        source=Path(json.loads(manifest.read_text())['source']).read_text()
        body=function(source,'osb5_skin_update_body')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);native=root/'src/ft/ftport.c';native.parent.mkdir(parents=True)
            native.write_text(source)
            generate(root,root/'generated')
            native.write_text(source.replace(body,body.replace('{','{/* test behavior drift */',1),1))
            with self.assertRaisesRegex(ValueError,'parity adapter'):
                generate(root,root/'changed')


class ModelBlankingTests(unittest.TestCase):
    def test_body_and_alternate_hands_are_hidden_while_props_survive(self):
        from build_rom import blank_model_body, chain
        from presentation import Reloc
        raw=bytearray(0x230)
        pointers={}
        for tree,body,prop in [(0,0x200,0x208),(0x84,0x210,0x218),(0x108,0x200,0x208)]:
            struct.pack_into('>I',raw,tree+88,18)
            pointers[tree+4]=body
            pointers[tree+48]=prop
        for at in range(0x200,0x230,8):
            struct.pack_into('>II',raw,at,0xdf000000,0)
        packed,first,ext=Reloc(raw,pointers,{}).finish()
        source='DObjDesc: JointTreeA @ 0x0\nDObjDesc: JointTreeB @ 0x84\nDObjDesc: JointTreeProp @ 0x108'
        main='FTModelPart hands[2] = {\n{ (Gfx*)&D_0x200 },\n{ (Gfx*)&D_0x220 }\n};\nFTModelPart props[2] = {\n{ (Gfx*)&D_0x208 },\n{ (Gfx*)&D_0x228 }\n};'
        blob,first,ext=blank_model_body(packed,[0,first,0,ext,0],source,{4},main)
        mapped=chain(blob,first)
        for at in [4,0x88,0x204,0x214,0x224]:
            target=mapped[at]
            self.assertEqual(blob[target:target+8],bytes.fromhex('df00000000000000'))
        self.assertEqual(mapped[48],0x208)
        self.assertEqual(mapped[0x84+48],0x218)
        self.assertEqual(mapped[0x108+4],0x200)
        for at in [0x208,0x218,0x228]:
            self.assertEqual(blob[at:at+8],packed[at:at+8])
