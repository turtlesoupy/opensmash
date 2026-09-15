import unittest
from PIL import Image
from opensmash_melee.archive import Archive
from opensmash_melee.costume_memory import compact_body_textures
from opensmash_melee.gx import material
from opensmash_melee.skeleton import joints
from tests.test_pipeline import fixture


class CostumeMemoryTests(unittest.TestCase):
    def test_hidden_display_removed_but_attachment_display_preserved(self):
        a, skel = self.fixture()
        for joint, byte in zip(skel, (0x81, 0x92)):
            polygon = a.alloc(24)
            a.pointer(joint['dobj'] + 12, polygon)
            a.pointer(polygon + 16, a.append(bytes([byte]) * 1024, 32))
            a.pack('H', polygon + 14, 32)
        packed, _ = compact_body_textures(a.serialize(), skel, {'preserve_attachment_joints': [1]})
        b = Archive(packed)
        after = joints(b, 'custom_joint')
        hidden = b.ptr(after[0]['dobj'] + 12)
        visible = b.ptr(after[1]['dobj'] + 12)
        self.assertEqual(b.unpack('H', hidden + 14), (1,))
        self.assertEqual(b.unpack('H', visible + 14), (32,))
        start = b.ptr(visible + 16)
        self.assertEqual(bytes(b.data[start:start+1024]), bytes([0x92]) * 1024)

    def fixture(self):
        a = fixture()
        skel = joints(a, 'custom_joint')
        body = material(a, Image.new('RGBA', (64, 64), (10, 20, 30, 255)))
        a.pointer(skel[0]['dobj'] + 8, body)
        attachment = a.alloc(16)
        a.pointer(skel[1]['offset'] + 16, attachment)
        visible = material(a, Image.new('RGBA', (8, 8), (255, 80, 20, 255)))
        a.pointer(attachment + 8, visible)
        return a, joints(a, 'custom_joint')

    def image(self, a, joint):
        return a.ptr(a.ptr(a.ptr(joint['dobj'] + 8) + 8) + 76)

    def test_compacts_hidden_payload_and_relocates_without_touching_attachment(self):
        a, skel = self.fixture()
        raw = a.serialize()
        image = self.image(a, skel[1])
        pixels = bytes(a.data[a.ptr(image):a.ptr(image)+256])
        packed, saved = compact_body_textures(raw, skel, {'preserve_attachment_joints': [1]})
        self.assertGreater(saved, 16000)
        self.assertEqual(len(raw) - len(packed), saved)
        b = Archive(packed)
        after = joints(b, 'custom_joint')
        for old, new in zip(skel, after):
            self.assertEqual(old['inverse_bind'], new['inverse_bind'])
        image = self.image(b, after[1])
        self.assertEqual(b.unpack('HHI', image + 4), (8, 8, 6))
        self.assertEqual(bytes(b.data[b.ptr(image):b.ptr(image)+256]), pixels)
        self.assertEqual(b.unpack('HHI', self.image(b, after[0]) + 4), (4, 4, 6))

    def test_shared_or_unknown_references_keep_original_payload(self):
        for mode in ('shared', 'unknown', 'interior', 'mipmaps'):
            with self.subTest(mode=mode):
                a, skel = self.fixture()
                image = self.image(a, skel[0])
                if mode == 'shared':
                    a.pointer(skel[1]['dobj'] + 8, a.ptr(skel[0]['dobj'] + 8))
                elif mode == 'mipmaps':
                    a.pack('I', image + 12, 1)
                else:
                    reference = a.alloc(4)
                    a.pointer(reference, a.ptr(image) + (32 if mode == 'interior' else 0))
                raw = a.serialize()
                self.assertEqual(compact_body_textures(raw, skel, {'preserve_attachment_joints': [1]}), (raw, 0))
