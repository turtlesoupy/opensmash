"""Regression checks against optional local, verified Melee costume data."""
from pathlib import Path
import unittest
import numpy as np
from PIL import Image
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.gx import replace_costume
from opensmash_melee.costume_memory import compact_body_textures
from opensmash_melee.costume_forms import form_joints, forms_current, VERSION

GAME = Path(__file__).resolve().parents[1] / 'assets/game/files'


def dobjs(a, sk):
    for joint in sk:
        d = joint['dobj']
        while d is not None:
            yield joint['index'], d
            d = a.ptr(d + 4)


class CostumeFormsTests(unittest.TestCase):
    def test_old_profiles_and_cache_versions(self):
        for symbol, index in [('PlyKoopa5K_Share_joint', 23), ('PlyYoshi5K_Share_joint', 3)]:
            profile = dict(symbol=symbol)
            self.assertEqual(form_joints(profile), (index,))
            self.assertFalse(forms_current({}, profile))
            self.assertTrue(forms_current({'costume_forms_version': VERSION}, profile))
        self.assertTrue(forms_current({}, {'symbol': 'PlyMario5K_Share_joint'}))

    @unittest.skipUnless((GAME / 'PlKpNr.dat').exists() and (GAME / 'PlYsNr.dat').exists(), 'requires local Melee data')
    def test_alternate_forms_survive_native_and_compacted_exports(self):
        for code, name in [('Kp', 'Koopa'), ('Ys', 'Yoshi')]:
            original = Archive.read(GAME / f'Pl{code}Nr.dat')
            profile = dict(symbol=f'Ply{name}5K_Share_joint', mesh_joint=0)
            sk = joints(original, profile['symbol'])
            for compact in (False, True):
                with self.subTest(code=code, compact=compact):
                    raw = original.serialize()
                    if compact:
                        raw, _ = compact_body_textures(raw, sk, profile)
                    a = Archive(raw)
                    current = joints(a, profile['symbol'])
                    # Compare retained display bytes and texture bytes before replacement.
                    for (ji, old), (_, new) in zip(dobjs(original, sk), dobjs(a, current), strict=True):
                        if ji not in form_joints(profile):
                            continue
                        op, nptr = original.ptr(old+12), a.ptr(new+12)
                        while op is not None:
                            size = original.unpack('H', op+14)[0]*32
                            self.assertEqual(a.unpack('H', nptr+14)[0]*32, size)
                            self.assertEqual(original.data[original.ptr(op+16):original.ptr(op+16)+size], a.data[a.ptr(nptr+16):a.ptr(nptr+16)+size])
                            op, nptr = original.ptr(op+4), a.ptr(nptr+4)
                        ot, nt = original.ptr(original.ptr(old+8)+8), a.ptr(a.ptr(new+8)+8)
                        while ot is not None:
                            oi, ni = original.ptr(ot+76), a.ptr(nt+76)
                            if oi is not None:
                                self.assertEqual(original.data[oi+4:oi+24], a.data[ni+4:ni+24])
                                self.assertEqual(original.data[original.ptr(oi):original.ptr(oi)+32], a.data[a.ptr(ni):a.ptr(ni)+32])
                            ot, nt = original.ptr(ot+4), a.ptr(nt+4)
                    mesh = dict(positions=np.array([[0.,0,0],[1,0,0],[0,1,0]]), normals=np.array([[0.,0,1]]*3), uv=np.zeros((3,2)), triangles=np.array([[0,1,2]]), envelopes=[((4,1.),)]*3, image=Image.new('RGBA',(4,4)))
                    replace_costume(a, mesh, current, profile)
                    emitted = list(dobjs(a, current))
                    self.assertEqual(len(emitted), len(list(dobjs(original, sk))))
                    for i, (ji, d) in enumerate(emitted):
                        self.assertEqual(a.ptr(d+12) is not None, i == 0 or ji in form_joints(profile))
                    # Original high/low-detail model visibility states must each
                    # retain drawable geometry for the shell or egg (state 1).
                    data = Archive.read(GAME / f'Pl{code}.dat')
                    desc = data.ptr(next(iter(data.roots().values()))+8)
                    table = data.ptr(desc+4)
                    for category in (0,1,3):
                        lookup = data.ptr(table+category*4)
                        states = data.ptr(lookup+4)
                        count, indices = data.unpack('II', states+8)
                        visible = list(data.data[indices:indices+count])
                        self.assertTrue(any(a.ptr(emitted[i][1]+12) is not None for i in visible))
                    Archive(a.serialize())
