import unittest
import numpy as np
from test_pipeline import fixture,mesh_fixture
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.retarget import conform
from opensmash_melee.gx import replace_costume
from opensmash_melee.browser_skin import MAGIC

class BrowserSkinTests(unittest.TestCase):
    def test_live_joint_descriptors_and_exact_vertex_weights_roundtrip(self):
        a=fixture();skel=joints(a,'custom_joint');source=mesh_fixture()
        profile={'joint_map':{'root':0,'head':1},'mesh_joint':0,'browser_skinning':True}
        mesh=conform(source,skel,profile);stats=replace_costume(a,mesh,skel,profile)
        a=Archive(a.serialize());pobj=a.ptr(skel[0]['dobj']+12);desc=a.ptr(pobj+8)
        self.assertEqual(stats['draw_batches'],1)
        self.assertEqual(a.unpack('II',desc+96),(255,MAGIC))
        meta=a.ptr(desc+116)
        self.assertEqual(a.unpack('5I',meta),(MAGIC,1,3,3,2))
        for key,source_field,destination_field in [('positions',20,36),('normals',24,40)]:
            src=a.ptr(meta+source_field);dst=a.ptr(meta+destination_field)
            self.assertNotEqual(src,dst)
            expected=np.asarray(mesh[key],dtype=np.float32)
            actual=np.array([a.unpack('3f',src+12*i) for i in range(3)],dtype=np.float32)
            np.testing.assert_array_equal(actual,expected)
            self.assertEqual(a.data[src:src+36],a.data[dst:dst+36])
        records=a.ptr(meta+28);mapping=a.ptr(meta+32)
        for i,expected in enumerate(mesh['envelopes']):
            entry=a.ptr(records+a.unpack('H',mapping+2*i)[0]*4)
            weights={}
            for k in range(a.u32(entry)):
                bone,weight=a.unpack('If',entry+4+k*8);weights[bone]=weights.get(bone,0)+weight
            self.assertEqual(weights,dict(expected))
        table=a.ptr(pobj+20);bones=a.ptr(table)
        self.assertEqual([a.ptr(bones+i*8) for i in range(2)],[j['offset'] for j in skel])
        dl=a.ptr(pobj+16);self.assertEqual(a.unpack('BH',dl),(0x90,3))
        self.assertEqual([a.unpack('BHHH',dl+3+7*i) for i in range(3)],[(0,i,i,i) for i in range(3)])
        self.assertIsNone(a.ptr(pobj+4))

if __name__=='__main__':unittest.main()
