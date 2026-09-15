import json
from pathlib import Path
import struct
import tempfile
import unittest
import numpy as np
from PIL import Image
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.retarget import conform,skin
from opensmash_melee.gx import batches,polygons,rgba8,replace_costume
from opensmash_melee.glb import GLB


def fixture(binds=None):
    if binds is None:
        b = np.eye(4); b[1,3] = 2
        binds = [np.eye(4),b]
    strings = b'custom_joint\0'
    # Nonzero first allocation avoids confusing a null pointer with offset 0.
    data = bytes(4)
    a = Archive(struct.pack('>5I',32+len(data)+len(strings),len(data),0,0,0)+bytes(12)+data+strings)
    offsets = [a.alloc(64) for _ in binds]
    a.public = [(offsets[0],0)]
    for i, (offset,bind) in enumerate(zip(offsets,binds)):
        a.pack('I',offset+4,2 if i == 0 else 1)
        a.pack('3f',offset+32,1,1,1)
        ibm = a.append(np.asarray(np.linalg.inv(bind)[:3],dtype='>f4').tobytes())
        a.pointer(offset+56,ibm)
        if i:
            if i == 1:
                a.pointer(offsets[0]+8,offset)
            else:
                a.pointer(offsets[i-1]+12,offset)
    d = a.alloc(16)
    a.pointer(offsets[0]+16,d)
    return a


def mesh_fixture():
    bind = np.eye(4); bind[1,3] = 2
    return dict(positions=np.array([[0.,0,0],[1,1,0],[0,2,0]]),
                normals=np.array([[0.,0,1]]*3),uv=np.array([[0.,0],[1,0],[0,1]]),
                triangles=np.array([[0,1,2]]),joints=np.array([[0,0,0,0],[0,1,0,0],[1,0,0,0]]),
                weights=np.array([[1.,0,0,0],[.5,.5,0,0],[1,0,0,0]]),
                bind=np.array([np.eye(4),bind]),names=['root','head'],image=Image.new('RGBA',(4,4),(11,22,33,255)))


class TextureSlotTests(unittest.TestCase):
    def test_replacement_retains_texture_slot_ids_and_count(self):
        from opensmash_melee.gx import material
        a=fixture();sk=joints(a,'custom_joint');d=sk[0]['dobj'];mesh=mesh_fixture()
        original=material(a,mesh['image']);first=a.ptr(original+8)
        extra=material(a,mesh['image']);second=a.ptr(extra+8)
        a.pack('I',second+8,1);a.pointer(first+4,second);a.pointer(d+8,original)
        profile={'mesh_joint':0,'joint_map':{'root':0,'head':1}}
        replace_costume(a,conform(mesh,sk,profile),sk,profile)
        t=a.ptr(a.ptr(d+8)+8);ids=[]
        while t is not None:
            ids.append(a.unpack('I',t+8)[0]);t=a.ptr(t+4)
        self.assertEqual(ids,[0,1])
        self.assertEqual(a.ptr(first+4),second)
        Archive(a.serialize())


def decode_vertices(a, first):
    """Independent decode of emitted GX stream and HSD envelope references."""
    triangles, seen, joint_offsets = [],set(),set()
    p = first
    while p is not None:
        if p in seen:
            raise AssertionError('Cycle in polygons')
        seen.add(p)
        flags,n = a.unpack('HH',p+12)
        assert flags & 0x3000 == 0x2000
        desc = a.ptr(p+8)
        attrs = [a.unpack('4I',desc+i*24)[:2] for i in range(5)]
        assert attrs == [(0,1),(9,3),(10,3),(13,3),(255,0)]
        env_table = a.ptr(p+20)
        palette=[]
        for i in range(11):
            env_ptr = a.ptr(env_table+4*i)
            if env_ptr is None:
                break
            env=[]
            while True:
                joint = a.ptr(env_ptr)
                if joint is None:
                    break
                weight = a.unpack('f',env_ptr+4)[0]
                assert np.isfinite(weight) and weight > 0
                env.append((joint,weight)); joint_offsets.add(joint)
                env_ptr += 8
            assert len(env) >= 2
            assert abs(sum(w for _,w in env)-1) < 1e-6
            palette.append(env)
        assert len(palette) <= 10
        dl = a.ptr(p+16)
        assert dl % 32 == 0
        command,count = a.unpack('BH',dl)
        assert command == 0x90 and count % 3 == 0
        assert 3+count*7 <= n*32
        vertices=[]
        for i in range(count):
            matrix,pos,nrm,uv = a.unpack('BHHH',dl+3+i*7)
            assert matrix % 3 == 0 and matrix//3 < len(palette)
            vertex=np.array(a.unpack('3f',a.ptr(desc+24+20)+pos*12))
            normal=np.array(a.unpack('3f',a.ptr(desc+48+20)+nrm*12))
            tex=np.array(a.unpack('2f',a.ptr(desc+72+20)+uv*8))
            vertices.append((vertex,normal,tex,palette[matrix//3]))
        triangles.extend([vertices[i:i+3] for i in range(0,count,3)])
        p = a.ptr(p+4)
    return triangles,joint_offsets


class ArchiveTests(unittest.TestCase):
    def test_roundtrip_append_preserves_original_offsets(self):
        a=fixture(); original=a.serialize(); b=Archive(original)
        self.assertEqual(b.serialize(),original)
        before=bytes(b.data); roots=b.roots(); b.append(b'new model',32)
        c=Archive(b.serialize())
        self.assertEqual(c.data[:len(before)],before)
        self.assertEqual(c.roots(),roots)

    def test_offset_zero_pointer_is_not_null(self):
        a=fixture(); field=a.alloc(4); a.pointer(field,0)
        self.assertEqual(Archive(a.serialize()).ptr(field),0)
        a.pointer(field,None)
        self.assertIsNone(Archive(a.serialize()).ptr(field))

    def test_truncation_and_invalid_relocation_rejected(self):
        raw=fixture().serialize()
        with self.assertRaises(ValueError): Archive(raw[:-1])
        raw=bytearray(raw); struct.pack_into('>I',raw,4,0xfffffff0)
        with self.assertRaises(ValueError): Archive(raw)
        a=fixture(); field=a.alloc(4); a.relocs.add(field); a.pack('I',field,0xffffff)
        with self.assertRaises(ValueError): a.serialize()

    def test_cycle_rejected(self):
        a=fixture(); root=a.roots()['custom_joint']; a.pointer(root+8,root)
        with self.assertRaises(ValueError): joints(a,'custom_joint')


class SkinTests(unittest.TestCase):
    def test_identity_bind_and_known_bend(self):
        mesh=mesh_fixture(); s=joints(fixture(),'custom_joint')
        result=conform(mesh,s,dict(joint_map={'root':0,'head':1}))
        np.testing.assert_allclose(result['positions'],mesh['positions'],atol=1e-6)
        inverse=np.array([j['inverse_bind'] for j in s]); world=np.linalg.inv(inverse)
        np.testing.assert_allclose(skin(result['positions'],result['envelopes'],world,inverse),mesh['positions'],atol=1e-6)
        # Rotate the head 90 degrees about its bind origin (0,2,0).
        world[1,:3,:3]=[[0,-1,0],[1,0,0],[0,0,1]]
        moved=skin(result['positions'],result['envelopes'],world,inverse)
        np.testing.assert_allclose(moved,[[0,0,0],[1,2,0],[0,2,0]],atol=1e-6)

    def test_unmapped_and_missing_bind_fail(self):
        mesh=mesh_fixture(); s=joints(fixture(),'custom_joint')
        with self.assertRaisesRegex(ValueError,'Unmapped'): conform(mesh,s,dict(joint_map={'root':0}))
        s[1]['inverse_bind']=None
        with self.assertRaisesRegex(ValueError,'inverse bind'): conform(mesh,s,dict(joint_map={'root':0,'head':1}))

    def test_many_to_one_merges_influences(self):
        result=conform(mesh_fixture(),joints(fixture(),'custom_joint'),dict(joint_map={'root':0,'head':0}))
        self.assertEqual(result['envelopes'],[((0,1.0),)]*3)


class ExportTests(unittest.TestCase):
    def test_actual_binary_roundtrip_and_skeleton_retention(self):
        a=fixture(); s=joints(a,'custom_joint'); mesh=mesh_fixture()
        model=conform(mesh,s,dict(joint_map={'root':0,'head':1}))
        info=replace_costume(a,model,s,dict(mesh_joint=0))
        a=Archive(a.serialize()); after=joints(a,'custom_joint')
        self.assertEqual([j['offset'] for j in s],[j['offset'] for j in after])
        self.assertEqual([j['parent'] for j in s],[j['parent'] for j in after])
        self.assertEqual([j['inverse_bind'] for j in s],[j['inverse_bind'] for j in after])
        triangles,offsets=decode_vertices(a,a.ptr(after[0]['dobj']+12))
        self.assertEqual(len(triangles),info['triangles'])
        for expected,vertex in zip(mesh['positions'],triangles[0]):
            np.testing.assert_allclose(expected,vertex[0],atol=1e-6)
        self.assertEqual(offsets,set(j['offset'] for j in s))

    def test_palette_limit_and_no_triangle_loss(self):
        mesh=dict(triangles=np.arange(33).reshape(-1,3),envelopes=[((i,1.),) for i in range(33)])
        result=list(batches(mesh))
        self.assertTrue(all(len(palette)<=10 for palette,_ in result))
        self.assertCountEqual([t for _,tris in result for t in tris],[tuple(t) for t in mesh['triangles']])

    def test_texture_tile_order(self):
        pixels=np.arange(8*8*4,dtype=np.uint8).reshape(8,8,4)
        data=rgba8(Image.fromarray(pixels)); out=np.zeros_like(pixels)
        pos=0
        for y in (0,4):
            for x in (0,4):
                tile=np.zeros((16,4),dtype=np.uint8)
                ar=np.frombuffer(data[pos:pos+32],dtype=np.uint8).reshape(16,2)
                gb=np.frombuffer(data[pos+32:pos+64],dtype=np.uint8).reshape(16,2)
                tile[:,3],tile[:,0]=ar[:,0],ar[:,1]
                tile[:,1],tile[:,2]=gb[:,0],gb[:,1]
                out[y:y+4,x:x+4]=tile.reshape(4,4,4); pos+=64
        np.testing.assert_array_equal(out,pixels)

    def test_owner_restrictions(self):
        a=fixture(); s=joints(a,'custom_joint')
        with self.assertRaisesRegex(ValueError,'SKELETON_ROOT'):
            replace_costume(a,{},s,dict(mesh_joint=1))


class GLBTests(unittest.TestCase):
    def test_invalid_glb_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'bad.glb'; path.write_bytes(b'not a glb')
            with self.assertRaises(ValueError): GLB(path)

    def test_interleaved_normalized_accessor(self):
        g=object.__new__(GLB)
        g.bin=bytes([0,255,99,99,128,64,99,99])
        g.g=dict(bufferViews=[dict(byteLength=8,byteStride=4)],
                 accessors=[dict(bufferView=0,count=2,type='VEC2',componentType=5121,normalized=True)])
        np.testing.assert_allclose(g.accessor(0),[[0,1],[128/255,64/255]])
        g.g['accessors'][0]['count']=3
        with self.assertRaises(ValueError): g.accessor(0)


if __name__ == '__main__':
    unittest.main()
