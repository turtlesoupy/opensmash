import struct
import tempfile
import unittest
from pathlib import Path

from tools.launch_dolphin import fixed_geometry, decode_qbytearray, configure_geometry
from opensmash_melee.disc import validate_iso


class LauncherTests(unittest.TestCase):
    def test_geometry_preserves_origin_and_sets_viewport_frame(self):
        original=decode_qbytearray(fixed_geometry())
        struct.pack_into('>4i',original,8,3007,1664,4606,2563)
        original[44]=1
        encoded='@ByteArray('+''.join(f'\\x{x:02x}' for x in original)+')'
        actual=decode_qbytearray(fixed_geometry(encoded))
        self.assertEqual(struct.unpack_from('>4i',actual,8),(3007,1664,3966,2471))
        self.assertEqual(actual[44:46],b'\0\0')
        for offset in (24,50):
            x,y,r,b=struct.unpack_from('>4i',actual,offset)
            self.assertEqual((r-x+1,b-y+1),(960,780))
        self.assertEqual(fixed_geometry(fixed_geometry(encoded)),fixed_geometry(encoded))

    def test_configure_preserves_unrelated_settings(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'Config').mkdir()
            p=root/'Config/Qt.ini';p.write_text('[other]\nkeep=yes\n\n[mainwindow]\nfoo=bar\n')
            configure_geometry(root);first=p.read_text();configure_geometry(root)
            self.assertEqual(first,p.read_text())
            self.assertIn('keep=yes',first);self.assertIn('foo=bar',first)
            self.assertEqual(first.count('geometry='),1)

    def test_unknown_geometry_version_rejected(self):
        with self.assertRaises(ValueError):fixed_geometry('@ByteArray(unknown)')


class DiscTests(unittest.TestCase):
    def test_valid_header_is_not_a_known_disc(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'fake.iso';data=bytearray(0x440)
            data[:6]=b'GALE01';data[7]=2
            struct.pack_into('>I',data,0x1c,0xc2339f3d);p.write_bytes(data)
            report=validate_iso(p)
            self.assertFalse(report['known_md5_match'])
            self.assertFalse(report['valid_for_project'])
            self.assertIsNone(report['sha1_reference_match'])
            self.assertEqual(p.read_bytes(),data)
