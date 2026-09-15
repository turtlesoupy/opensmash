"""Exercise preparation concurrency through the actual HTTP endpoint."""
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request, urlopen

from tools import serve_melee as server


class ParallelPreparation(unittest.TestCase):
    def test_independent_builds_overlap_and_duplicates_reuse_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog = {slug: {'target': 'fox'} for slug in ('first', 'second', 'third', 'fourth', 'fifth')}
            for slug in catalog:
                source = root / 'library' / slug
                source.mkdir(parents=True)
                (source / 'rigged.glb').touch()
            barrier = threading.Barrier(4, timeout=5)
            guard = threading.Lock()
            builds = []
            active = 0
            peak = 0

            def build(args, **kwargs):
                nonlocal active, peak
                ident = args[args.index('--id') + 1]
                with guard:
                    builds.append(ident)
                    active += 1
                    peak = max(peak, active)
                    ordinal = len(builds)
                # The first four builds must overlap; a global lock times out.
                if ordinal <= 4:
                    barrier.wait()
                output = root / 'build/characters' / ident
                output.mkdir(parents=True)
                (output / 'PlFxNr.dat').write_bytes(b'fixture')
                with guard:
                    active -= 1
                return SimpleNamespace(returncode=0, stdout='ok')

            with patch.multiple(server, ROOT=root, CHARACTERS=root/'library',
                                CATALOG=catalog, TOKEN='', SETUP=SimpleNamespace(ready=True),
                                PREPARATION_LOCKS={}, PREPARATION_SLOTS=threading.BoundedSemaphore(4)), \
                 patch.object(server.subprocess, 'run', side_effect=build), \
                 patch('tools.upgrade_character_surfaces.upgrade'), \
                 patch.object(server, 'upgrade_cached_lighting', side_effect=lambda raw: raw):
                http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
                thread = threading.Thread(target=http.serve_forever, daemon=True)
                thread.start()
                try:
                    def prepare(slug):
                        request = Request(f'http://127.0.0.1:{http.server_port}/api/prepare/{slug}',
                                          data=b'{}', method='POST')
                        with urlopen(request, timeout=10) as response:
                            return json.load(response)
                    with ThreadPoolExecutor(max_workers=10) as pool:
                        results = list(pool.map(prepare, [slug for slug in catalog for _ in range(2)]))
                    self.assertEqual(len(results), 10)
                    self.assertCountEqual(builds, [server.cache_id(slug, 'fox', 'fox') for slug in catalog])
                    self.assertEqual(peak, 4)
                finally:
                    http.shutdown()
                    http.server_close()
                    thread.join()


    def test_failed_preparation_retries_without_identifier_collision(self):
        from urllib.error import HTTPError
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'library/fixture';source.mkdir(parents=True)
            (source/'rigged.glb').write_bytes(b'source')
            calls=[]
            def build(args,**kwargs):
                ident=args[args.index('--id')+1]
                output=root/'build/characters'/ident;imported=root/'assets/characters'/ident
                self.assertFalse(output.exists());self.assertFalse(imported.exists())
                output.mkdir(parents=True);imported.mkdir(parents=True)
                (imported/'rigged.glb').write_bytes(b'source')
                calls.append(ident)
                if len(calls)==1:
                    (output/'shape.json').write_text('failed shape')
                    return SimpleNamespace(returncode=2,stdout='',stderr='Source-shape check needs manual review')
                (output/'PlFxNr.dat').write_bytes(b'fixture')
                return SimpleNamespace(returncode=0,stdout='ok',stderr='')
            with patch.multiple(server,ROOT=root,CHARACTERS=root/'library',CATALOG={'fixture':{'target':'fox'}},TOKEN='',SETUP=SimpleNamespace(ready=True),PREPARATION_LOCKS={},PREPARATION_SLOTS=threading.BoundedSemaphore(4)), patch.object(server.subprocess,'run',side_effect=build), patch('tools.upgrade_character_surfaces.upgrade'), patch.object(server,'upgrade_cached_lighting',side_effect=lambda raw:raw):
                http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
                thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
                try:
                    def request():return urlopen(Request(f'http://127.0.0.1:{http.server_port}/api/prepare/fixture',data=b'{}',method='POST'),timeout=10)
                    with self.assertRaises(HTTPError) as caught:request()
                    self.assertEqual(caught.exception.code,422)
                    self.assertIn('Fitting character for Fox failed',json.load(caught.exception)['error'])
                    with request() as response:self.assertEqual(response.status,200)
                    self.assertEqual(len(calls),2)
                    self.assertEqual(len(list((root/'build/character-imports/previous-builds').glob('*/output/shape.json'))),1)
                finally:http.shutdown();http.server_close();thread.join()
