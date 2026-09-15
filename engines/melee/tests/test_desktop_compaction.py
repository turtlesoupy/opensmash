import json
import struct
import io
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from PIL import Image

from tools.compact_desktop_glb import compact_glb


def encode(doc, binary):
    doc = json.dumps(doc).encode()
    doc += b' ' * (-len(doc) % 4)
    binary += b'\0' * (-len(binary) % 4)
    return (struct.pack('<III', 0x46546C67, 2, 28 + len(doc) + len(binary))
            + struct.pack('<II', len(doc), 0x4E4F534A) + doc
            + struct.pack('<II', len(binary), 0x004E4942) + binary)


def decode(raw):
    size = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20 + size]), raw[28 + size:]


class DesktopCompactionTests(unittest.TestCase):
    def fixture(self):
        return {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 204}],
                'bufferViews': [{'byteOffset': 0, 'byteLength': 100},
                                {'byteOffset': 100, 'byteLength': 100},
                                {'byteOffset': 200, 'byteLength': 4}],
                'accessors': [{'bufferView': 2}],
                'images': [{'bufferView': 0}, {'bufferView': 1}],
                'textures': [{'source': 0}, {'source': 1}],
                'materials': [{'normalTexture': {'index': 0},
                               'pbrMetallicRoughness': {'baseColorTexture': {'index': 1}}}]}

    def test_unused_map_removed_and_pixels_and_geometry_preserved(self):
        raw = encode(self.fixture(), b'N' * 100 + b'C' * 100 + b'MESH')
        packed = compact_glb(raw)
        doc, binary = decode(packed)
        self.assertLess(len(packed), len(raw))
        self.assertEqual(binary, b'C' * 100 + b'MESH')
        self.assertEqual(doc['accessors'][0]['bufferView'], 1)
        self.assertEqual(doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index'], 0)
        self.assertEqual(doc['textures'], [{'source': 0}])
        self.assertEqual(compact_glb(packed), packed)

    def test_shared_texture_image_and_accessor_views_survive(self):
        for shared in ('texture', 'image', 'view', 'accessor'):
            with self.subTest(shared=shared):
                doc = self.fixture()
                if shared == 'texture':
                    doc['materials'][0]['normalTexture']['index'] = 1
                elif shared == 'image':
                    doc['textures'][0]['source'] = 1
                elif shared == 'view':
                    doc['images'][0]['bufferView'] = 1
                else:
                    doc['accessors'].append({'bufferView': 0})
                packed, binary = decode(compact_glb(encode(doc, b'N' * 100 + b'C' * 100 + b'MESH')))
                self.assertIn(b'C' * 100, binary)
                self.assertIn(b'MESH', binary)
                if shared == 'accessor':
                    self.assertIn(b'N' * 100, binary)

    def test_unknown_extensions_are_untouched(self):
        doc = self.fixture()
        doc['textures'][0]['extensions'] = {'OTHER_texture': {'source': 0}}
        raw = encode(doc, b'x' * 204)
        self.assertEqual(compact_glb(raw), raw)

    def test_truncated_input_rejected(self):
        with self.assertRaises(ValueError):
            compact_glb(b'glTF')

    def test_release_preparation_compacts_existing_cached_roster(self):
        from tools.prepare_desktop_release import prepare

        raw = encode(self.fixture(), b'N' * 100 + b'C' * 100 + b'MESH')
        art = io.BytesIO()
        Image.new('RGBA', (32, 48), (200, 50, 80, 128)).save(art, 'PNG')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            runtime, characters = root / 'runtime.zip', root / 'characters.tar.gz'
            with zipfile.ZipFile(runtime, 'w') as archive:
                archive.writestr('runtime.json', json.dumps({
                    'protocol': 1, 'sha256': {}, 'runner': 'runner', 'controllers': 'controllers'}))
                for name in ('runner', 'controllers', 'dolrecomp'):
                    archive.writestr(name, b'fixture')
            with tarfile.open(characters, 'w:gz') as archive:
                for name, data in [('catalog.json', b'[{"slug":"example"}]'),
                                   ('example/rigged.glb', raw),
                                   ('example/portrait_raw.png', art.getvalue())]:
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    archive.addfile(entry, io.BytesIO(data))
            cached = characters.read_bytes()
            with patch('tools.prepare_desktop_release.ROOT', root):
                prepare(runtime, characters)
            roster = root / 'build/desktop-characters'
            self.assertEqual((roster / 'example/rigged.glb').read_bytes(), compact_glb(raw))
            self.assertFalse((roster / 'example/portrait_raw.png').exists())
            with Image.open(roster / 'example/portrait_raw.webp') as image:
                self.assertEqual(image.format, 'WEBP')
                self.assertEqual(image.size, (32, 48))
            self.assertEqual(characters.read_bytes(), cached)
