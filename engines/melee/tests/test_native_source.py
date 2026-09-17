import concurrent.futures
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
from opensmash_melee.native_source import prepare


class NativeSourceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root/'character'
        self.source.mkdir()
        (self.source/'rigged.glb').write_bytes(b'geometry')

    def build(self, args, **kwargs):
        time.sleep(.02)
        output = Path(args[args.index('--output')+1])/'sources'
        output.mkdir()
        for suffix in ('.json', '.rgba8', '.identity.dat'):
            (output/('obama'+suffix)).write_bytes(b'asset')
        return subprocess.CompletedProcess(args, 0, '', '')

    def test_concurrent_requests_build_once_and_source_changes_invalidate(self):
        with patch('opensmash_melee.native_source.subprocess.run', side_effect=self.build) as run:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: prepare(self.root,self.source,'obama'),range(4)))
            self.assertEqual(run.call_count,1)
            self.assertEqual(sum(not r['cached'] for r in results),1)
            self.assertEqual(len({r['base'] for r in results}),1)
            (self.source/'rigged.glb').write_bytes(b'new geometry')
            changed = prepare(self.root,self.source,'obama')
            self.assertNotEqual(changed['base'],results[0]['base'])
            self.assertEqual(run.call_count,2)

    def test_portable_build_package_needs_no_conversion(self):
        import shutil
        with patch('opensmash_melee.native_source.subprocess.run', side_effect=self.build):
            first = prepare(self.root,self.source,'obama')
        directory = self.root/'build/native-fit/local/revisions'/first['base'].split('/')[-3]
        for suffix in ('.json','.rgba8','.identity.dat'):
            shutil.copyfile(directory/'sources'/f'obama{suffix}',self.source/f'melee-source{suffix}')
        shutil.copyfile(directory/'ready.json',self.source/'melee-source-ready.json')
        shutil.rmtree(directory)
        with patch('opensmash_melee.native_source.subprocess.run') as run:
            self.assertEqual(prepare(self.root,self.source,'obama')['base'],first['base'])
            run.assert_not_called()

    def test_hosted_prepare_restores_current_revision_before_building(self):
        import shutil
        from types import SimpleNamespace
        from opensmash_melee.bucket_cache import Store
        from opensmash_melee.hosted_cache import ServiceCache
        store = Store(local=self.root/'bucket')
        first_cache = ServiceCache(SimpleNamespace(ROOT=self.root),store,{},'v1')
        request = SimpleNamespace(path='/api/native-fit/source/obama')
        with patch('opensmash_melee.native_source.subprocess.run',side_effect=self.build):
            first = prepare(self.root,self.source,'obama')
        first_cache.response(request,first,200)
        shutil.rmtree(self.root/'build/native-fit/local/revisions')
        cold = ServiceCache(SimpleNamespace(ROOT=self.root),store,{},'v1')
        with patch.object(cold,'source') as source:
            cold.before_request(request)
            source.assert_called_once_with('obama')
        with patch('opensmash_melee.native_source.subprocess.run',side_effect=self.build) as run:
            restored = prepare(self.root,self.source,'obama',restore=request.restore_native_source)
            self.assertTrue(restored['cached'])
            self.assertEqual(restored['base'],first['base'])
            run.assert_not_called()
            # A changed model must miss the old shared cache and build anew.
            (self.source/'rigged.glb').write_bytes(b'changed geometry')
            changed = prepare(self.root,self.source,'obama',restore=request.restore_native_source)
            self.assertFalse(changed['cached'])
            self.assertNotEqual(changed['base'],first['base'])
            self.assertEqual(run.call_count,1)

    def test_timeout_does_not_publish_partial_source(self):
        with patch('opensmash_melee.native_source.subprocess.run', side_effect=subprocess.TimeoutExpired('prepare',60)):
            with self.assertRaisesRegex(ValueError,'timed out'):
                prepare(self.root,self.source,'obama')
        self.assertEqual(list((self.root/'build').rglob('ready.json')),[])
        with patch('opensmash_melee.native_source.subprocess.run', side_effect=self.build):
            self.assertFalse(prepare(self.root,self.source,'obama')['cached'])


if __name__ == '__main__':
    unittest.main()
