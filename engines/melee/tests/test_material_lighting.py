import unittest
from opensmash_melee.archive import Archive
from opensmash_melee.gx import replace_costume
from opensmash_melee.materials import upgrade_cached_lighting
from opensmash_melee.skeleton import joints
from tests.test_pipeline import fixture, mesh_fixture
from opensmash_melee.retarget import conform


class MaterialLightingTests(unittest.TestCase):
    def costume(self, browser=False):
        a = fixture(); skel = joints(a, 'custom_joint')
        profile = dict(mesh_joint=0, joint_map={'root': 0, 'head': 1}, browser_skinning=browser)
        replace_costume(a, conform(mesh_fixture(), skel, profile), skel, profile)
        return Archive(a.serialize()), skel[0]['dobj']

    def test_native_and_browser_select_hsd_lit_channel(self):
        for browser in (False, True):
            with self.subTest(browser=browser):
                a, d = self.costume(browser)
                m = a.ptr(d + 8)
                # HSD_SetupChannelMode only enables diffuse lights for case 4.
                self.assertEqual(a.u32(m + 4) & 7, 4)
                self.assertTrue(a.u32(m + 4) & 0x10)
                self.assertEqual(a.unpack('II', a.ptr(m + 12)), (0xb3b3b3ff,) * 2)
                # Mario's diffuse texture REPLACEs the material RGB. Modulate
                # multiplies every texture value by 179/255 before lighting.
                self.assertEqual(a.u32(a.ptr(m + 8) + 64), 0x50010)
                self.assertEqual(upgrade_cached_lighting(a.serialize()), a.serialize())

    def test_migration_only_changes_material_bytes(self):
        for browser in (False, True):
            a, d = self.costume(browser)
            m = a.ptr(d + 8); mat = a.ptr(m + 12)
            tex = a.ptr(m + 8)
            expected = a.serialize()
            a.pack('I', m + 4, 0x15)
            a.pack('II', mat, 0xffffffff, 0xffffffff)
            a.pack('I', tex + 64, 0x40010)
            old = a.serialize()
            self.assertNotEqual(old, expected)
            upgraded = upgrade_cached_lighting(old)
            self.assertEqual(upgraded, expected)
            changed = {i for i, (x, y) in enumerate(zip(old, upgraded)) if x != y}
            self.assertEqual(len(changed), 8)
            self.assertTrue(changed <= set(range(32+m+4, 32+m+8)) | set(range(32+mat, 32+mat+8)) | set(range(32+tex+64, 32+tex+68)))

    def test_migrate_first_lighting_fix_without_touching_other_bytes(self):
        for browser in (False, True):
            a, d = self.costume(browser)
            tex = a.ptr(a.ptr(d + 8) + 8)
            expected = a.serialize()
            a.pack('I', tex + 64, 0x40010)
            old = a.serialize()
            self.assertEqual(upgrade_cached_lighting(old), expected)
            self.assertEqual(sum(x != y for x, y in zip(old, expected)), 1)

    def test_does_not_restyle_unrelated_material(self):
        a, d = self.costume()
        m = a.ptr(d + 8)
        a.pack('I', m + 4, 0x15)
        a.pack('I', a.ptr(m + 12), 0x808080ff)
        a.pack('I', a.ptr(m + 8) + 64, 0x40010)
        raw = a.serialize()
        self.assertEqual(upgrade_cached_lighting(raw), raw)


if __name__ == '__main__': unittest.main()
