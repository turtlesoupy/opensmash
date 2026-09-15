import tempfile
import unittest
from pathlib import Path
from PIL import Image
import numpy as np
from opensmash_melee.presentation import attach, i4, import_stencil, MAGIC, VERSION, OSBV_SIZE, portrait_fit, panel
from opensmash_melee.archive import Archive
from tests import test_material_lighting


class PresentationTests(unittest.TestCase):
    def test_i4_tiles_and_nibbles(self):
        im=Image.new('L',(16,8));im.paste(255,(8,0,16,8));im.putpixel((0,0),34);im.putpixel((1,0),85)
        encoded=i4(im)
        self.assertEqual(encoded[:2],bytes([0x25,0]))
        self.assertEqual(encoded[32:],bytes([255])*32)

    def test_identity_survives_relocation_without_changing_fighter_material(self):
        for browser in (False,True):
            a,d=test_material_lighting.MaterialLightingTests().costume(browser)
            old=a.ptr(d+8);material=bytes(a.data[old:old+24]);geometry=a.ptr(d+12)
            attach(a,d,Image.new('L',(256,256),255))
            a=Archive(a.serialize());m=a.ptr(d+8)
            self.assertEqual(a.data[m:m+24],material)
            self.assertEqual(a.ptr(d+12),geometry)
            self.assertEqual(a.unpack('II',m+24),(MAGIC,VERSION))
            for offset in (8,12):self.assertEqual(a.ptr(m+offset),a.ptr(old+offset))
            im=a.ptr(m+32)
            self.assertEqual(a.unpack('HHI',im+4),(256,256,0))
            self.assertEqual(a.data[a.ptr(im):a.ptr(im)+32768],bytes([255])*32768)
            p=a.ptr(m+36)
            self.assertEqual(a.unpack('HH',p+12),(0x8000,1))
            self.assertIsNone(a.ptr(p+20))

    def test_portrait_bounds_are_measured_in_head_bind_space(self):
        inverse=np.eye(4);inverse[:3,3]=[-10,-20,-30]
        skeleton=[dict(offset=0,inverse_bind=inverse.tolist())]
        points=np.array([[9,18,30],[11,18,30],[9,22,30],[11,22,30]])
        head,center,radius=portrait_fit(dict(positions=points,envelopes=[((0,1),)]*4),skeleton,{'joint_map':{'Head':0}})
        self.assertEqual(head,0);np.testing.assert_allclose(center,[0,0,0]);self.assertAlmostEqual(radius,np.sqrt(5))
        np.testing.assert_array_equal(points,[[9,18,30],[11,18,30],[9,22,30],[11,22,30]])

    def test_panel_uses_short_name_and_keeps_emblem_in_winner_layer(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'character.json').write_text(json.dumps({'display':'Alan Turing','short':'TURING'}))
            Image.new('L',(48,48),255).save(root/'emblem_stencil.png')
            Image.new('RGBA',(32,32),(255,0,0,255)).save(root/'stock_raw.png')
            image=panel(root)
            self.assertIsNone(image.crop((0,0,256,192)).getbbox())
            self.assertIsNotNone(image.info['emblem'].getbbox())
            self.assertIsNotNone(image.info['title'].getbbox())
            self.assertLess(image.getbbox()[2]-image.getbbox()[0],image.info['title'].getbbox()[2]-image.info['title'].getbbox()[0])

    def test_import_uses_verified_osbv_layout_not_arbitrary_trailing_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';dest=root/'dest';source.mkdir();dest.mkdir()
            p=source/'character.osbui';p.write_bytes(b'OSBV'+bytes(OSBV_SIZE-5))
            self.assertFalse(import_stencil(source,dest))
            p.write_bytes(b'OSBV'+bytes(OSBV_SIZE-4-2304)+bytes([123])*2304)
            self.assertTrue(import_stencil(source,dest))
            im=Image.open(dest/'emblem_stencil.png')
            self.assertEqual(im.size,(48,48));self.assertEqual(im.getextrema(),(123,123))
