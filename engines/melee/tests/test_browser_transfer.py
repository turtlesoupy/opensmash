"""Check the HTTP contract used by versioned browser runtime downloads."""
import gzip
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from tools import serve_melee


class BrowserTransferTest(unittest.TestCase):
    def test_compact_costume_route(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            slug = next(iter(serve_melee.CATALOG))
            target = serve_melee.CATALOG[slug]['target']
            ident = serve_melee.cache_id(slug, target, target)
            filename = serve_melee.BY_SLUG[target]['costumes'][0]['filename']
            for variant in ('browser', 'browser-compact'):
                folder = root / 'build/characters' / ident / variant
                folder.mkdir(parents=True)
                (folder / filename).write_bytes(variant.encode())
            class Handler(serve_melee.Handler):
                def log_message(self, *args):
                    pass
            with patch.object(serve_melee, 'ROOT', root), patch.object(serve_melee, 'TOKEN', ''):
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    url = f'http://127.0.0.1:{server.server_port}/api/costume/{slug}?skin=host'
                    with urlopen(url) as response:
                        self.assertEqual(response.read(), b'browser')
                    with urlopen(url + '&compact=1') as response:
                        self.assertEqual(response.read(), b'browser-compact')
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()

    def test_versioned_compressed_and_range_downloads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            raw = b'\0asm' + bytes(range(256)) * 50
            (root / 'opensmash-web.wasm').write_bytes(raw)
            (root / 'opensmash-web.wasm.gz').write_bytes(gzip.compress(raw))
            (root / 'opensmash-web-build.json').write_text(json.dumps({'id': 'wasm', 'cacheId': 'runtime'}))
            class Handler(serve_melee.Handler):
                def log_message(self, *args):
                    pass
            with patch.object(serve_melee, 'BUILD', root), patch.object(serve_melee, 'TOKEN', ''):
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                url = f'http://127.0.0.1:{server.server_port}/engine/opensmash-web.wasm'
                try:
                    with urlopen(Request(url + '?v=runtime', headers={'Accept-Encoding': 'gzip, deflate, br'})) as response:
                        self.assertEqual(response.headers['Content-Encoding'], 'gzip')
                        self.assertEqual(response.headers['Content-Type'], 'application/wasm')
                        self.assertIn('immutable', response.headers['Cache-Control'])
                        self.assertEqual(gzip.decompress(response.read()), raw)
                    with urlopen(Request(url + '?v=runtime', headers={'Accept-Encoding': 'gzip', 'Range': 'bytes=4-31'})) as response:
                        self.assertEqual(response.status, 206)
                        self.assertIsNone(response.headers['Content-Encoding'])
                        self.assertEqual(response.read(), raw[4:32])
                    with urlopen(Request(url, headers={'Accept-Encoding': 'gzip;q=0'})) as response:
                        self.assertIsNone(response.headers['Content-Encoding'])
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
                        self.assertEqual(response.read(), raw)
                    with self.assertRaises(HTTPError) as error:
                        urlopen(url + '?v=old-runtime')
                    self.assertEqual(error.exception.code, 409)
                    error.exception.close()
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()


if __name__ == '__main__':
    unittest.main()
