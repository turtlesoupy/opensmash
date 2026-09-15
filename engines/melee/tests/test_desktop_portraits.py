import hashlib
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from opensmash_melee.__main__ import import_character
from opensmash_melee.character_assets import portrait_path
from opensmash_melee.character_select import portrait
from tools.compact_desktop_portraits import compact_portraits, encode_portrait
from tools.package_desktop_characters import package
from tools.verify_desktop_portraits import verify


class DesktopPortraitTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'source/fighter'
        self.source.mkdir(parents=True)
        self.image = Image.new('RGBA', (80, 100))
        self.image.putdata([(x * 3, y * 2, (x + y) % 256, (x * 7 + y * 11) % 256)
                            for y in range(100) for x in range(80)])
        self.image.save(self.source / 'portrait_raw.png')
        (self.source / 'character.json').write_text('{"display":"Fighter","short":"FIGHT"}')
        (self.source / 'rigged.glb').write_bytes(b'model')
        (self.source / 'announcer.wav').write_bytes(b'audio')
        for name in ('stock_raw.png', 'emblem_raw.png'):
            self.image.save(self.source / name)
        self.catalog = [{'slug': 'fighter', 'name': 'Fighter', 'short': 'FIGHT'}]
        (self.source.parent / 'catalog.json').write_text(json.dumps(self.catalog))

    def test_compaction_preserves_dimensions_alpha_and_is_not_reencoded(self):
        untouched = (self.source / 'stock_raw.png').read_bytes()
        report = compact_portraits(self.source.parent)
        self.assertEqual(report['changedPortraits'], 1)
        self.assertFalse((self.source / 'portrait_raw.png').exists())
        path = portrait_path(self.source)
        with Image.open(path) as result:
            self.assertEqual(result.format, 'WEBP')
            self.assertEqual(result.size, self.image.size)
            self.assertEqual(result.getchannel('A').tobytes(), self.image.getchannel('A').tobytes())
        first = path.read_bytes()
        self.assertEqual(compact_portraits(self.source.parent)['changedPortraits'], 0)
        self.assertEqual(path.read_bytes(), first)
        self.assertEqual((self.source / 'stock_raw.png').read_bytes(), untouched)
        self.assertEqual(verify(self.source.parent), {'portraits': 1, 'formats': {'WEBP': 1}})

    def test_both_formats_import_with_correct_manifest_and_render_in_menu(self):
        for compact in (False, True):
            with self.subTest(compact=compact):
                if compact:
                    compact_portraits(self.source.parent)
                name = portrait_path(self.source).name
                destination = self.root / ('import-webp' if compact else 'import-png')
                with patch('opensmash_melee.__main__.GLB') as glb:
                    glb.return_value.mesh.return_value = {'positions': [1], 'triangles': [1], 'names': ['root']}
                    manifest = import_character(self.source, destination)
                self.assertEqual(manifest['files'][name], hashlib.sha256((destination / name).read_bytes()).hexdigest())
                self.assertEqual((destination / name).read_bytes(), (self.source / name).read_bytes())
                for size, label in [((64, 56), True), ((160, 192), False)]:
                    self.assertEqual(portrait(destination, size, label).size, size)

    def test_new_cache_contains_webp_and_preserves_source_png(self):
        public = self.root / 'web/public'
        public.mkdir(parents=True)
        (public / 'catalog.json').write_text(json.dumps(self.catalog))
        png = (self.source / 'portrait_raw.png').read_bytes()
        archive = self.root / 'characters.tar.gz'
        with patch('tools.package_desktop_characters.ROOT', self.root), patch('tools.package_desktop_characters.compact_glb', side_effect=lambda raw: raw):
            package(self.source.parent, archive)
        with tarfile.open(archive) as tar:
            self.assertNotIn('fighter/portrait_raw.png', tar.getnames())
            webp = tar.extractfile('fighter/portrait_raw.webp').read()
            self.assertEqual(webp, encode_portrait(self.image))
            staged = self.root / 'staged'
            tar.extractall(staged, filter='data')
        self.assertEqual(compact_portraits(staged)['changedPortraits'], 0)
        self.assertEqual(verify(staged)['formats'], {'WEBP': 1})
        self.assertEqual((self.source / 'portrait_raw.png').read_bytes(), png)

    def test_corrupt_png_does_not_remove_existing_files(self):
        path = self.source / 'portrait_raw.png'
        path.write_bytes(b'corrupt')
        with self.assertRaises(OSError):
            compact_portraits(self.source.parent)
        self.assertEqual(path.read_bytes(), b'corrupt')
