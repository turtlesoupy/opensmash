import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from opensmash_melee.bucket_cache import Store
from tools.prepare_web_release import ensure_release, input_fingerprint


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'engine'
        self.characters = Path(self.temp.name)/'characters'
        (self.root/'web/public').mkdir(parents=True)
        (self.root/'web/public/catalog.json').write_text('[{"slug":"example"}]')
        (self.root/'upstream.json').write_text('{"revision":"one"}')
        (self.root/'requirements.txt').write_text('numpy')
        (self.root/'runtime/fitting').mkdir(parents=True)
        (self.root/'runtime/fitting/fit.cpp').write_text('fit')
        source = self.characters/'example'
        source.mkdir(parents=True)
        for name in ('rigged.glb','character.json','stock_raw.png','emblem_raw.png','announcer.wav','portrait_raw.png'):
            (source/name).write_bytes(name.encode())
        self.store = Store(local=Path(self.temp.name)/'store')
        self.builder = Mock()
        self.publisher = Mock(side_effect=self.publish)

    def publish(self, *args, release_fingerprint, **kwargs):
        raw = json.dumps({'format':'opensmash-melee-hosted-v1', 'nativeFitting':1,
                          'releaseFingerprint':release_fingerprint}).encode()
        key = 'melee/inputs/'+hashlib.sha256(raw).hexdigest()+'.json'
        self.store.put(key, raw)
        return key

    def ensure(self, **kwargs):
        return ensure_release(self.root, self.characters, self.store, root=self.root,
                              builder=self.builder, publisher=self.publisher, **kwargs)

    def test_first_release_builds_and_repeat_reuses_without_build_or_publish(self):
        key = self.ensure()
        self.assertEqual(self.ensure(), key)
        self.assertEqual(self.builder.call_count, 1)
        self.assertEqual(self.publisher.call_count, 1)
        self.assertEqual(self.ensure(candidate=key), key)
        self.assertEqual(self.builder.call_count, 1)

    def test_changed_fitter_pin_or_character_cannot_reuse_old_candidate(self):
        old = self.ensure()
        for path in (self.root/'runtime/fitting/fit.cpp', self.root/'upstream.json',
                     self.characters/'example/rigged.glb'):
            path.write_text(path.read_text()+'changed')
            current = self.ensure(candidate=old)
            self.assertNotEqual(current, old)
            old = current
        self.assertEqual(self.builder.call_count, 4)

    def test_failed_build_never_publishes_or_indexes(self):
        self.builder.side_effect = ValueError('Missing disc or toolchain')
        with self.assertRaisesRegex(ValueError, 'Missing disc'):
            self.ensure()
        self.publisher.assert_not_called()
        self.assertFalse(self.store.keys('melee/releases/'))

    def test_missing_character_fails_before_build(self):
        (self.characters/'example/rigged.glb').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing character input'):
            self.ensure()
        self.builder.assert_not_called()
        self.publisher.assert_not_called()

    def test_corrupt_manifest_is_not_reused(self):
        old = self.ensure()
        self.store.put(old, b'corrupt')
        self.ensure(candidate=old)
        self.assertEqual(self.builder.call_count, 2)

    def test_inputs_changed_during_build_fail_before_publish(self):
        self.builder.side_effect = lambda *args: (self.characters/'example/rigged.glb').write_bytes(b'edited')
        with self.assertRaisesRegex(ValueError, 'changed during'):
            self.ensure()
        self.publisher.assert_not_called()

    def test_inputs_changed_during_publish_are_not_indexed(self):
        def changed_publish(*args, **kwargs):
            key = self.publish(*args, **kwargs)
            (self.characters/'example/rigged.glb').write_bytes(b'edited')
            return key
        self.publisher.side_effect = changed_publish
        with self.assertRaisesRegex(ValueError, 'changed during publishing'):
            self.ensure()
        self.assertFalse(self.store.keys('melee/releases/'))

    def test_baked_source_and_template_code_change_fingerprint_not_build_outputs(self):
        before = input_fingerprint(self.characters, self.root)
        (self.root/'build').mkdir()
        (self.root/'build/out.wasm').write_bytes(b'generated')
        self.assertEqual(before, input_fingerprint(self.characters, self.root))
        (self.characters/'example/melee-source.json').write_text('{}')
        self.assertNotEqual(before, input_fingerprint(self.characters, self.root))


if __name__ == '__main__':
    unittest.main()
