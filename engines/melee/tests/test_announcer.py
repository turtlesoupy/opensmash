import hashlib
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from tools import serve_melee


class AnnouncerTests(unittest.TestCase):
    def test_bundled_imported_ranges_and_unknown_characters(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'library' / 'bundled'
            source.mkdir(parents=True)
            (source / 'announcer.wav').write_bytes(b'RIFFbundled')
            ident = 'web-v1-' + hashlib.sha256(b'imported').hexdigest()[:16]
            imported = root / 'assets/characters' / ident
            imported.mkdir(parents=True)
            (imported / 'announcer.wav').write_bytes(b'RIFFimported')
            with patch.multiple(serve_melee, ROOT=root, CHARACTERS=root/'library', TOKEN='', CATALOG={'bundled': {}, 'imported': {}}):
                server = ThreadingHTTPServer(('127.0.0.1', 0), serve_melee.Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    base = 'http://127.0.0.1:%d/api/announcer/' % server.server_port
                    with urlopen(base + 'bundled') as response:
                        self.assertEqual(response.read(), b'RIFFbundled')
                        self.assertIn('audio/', response.headers['Content-Type'])
                    with urlopen(Request(base + 'imported', headers={'Range':'bytes=4-7'})) as response:
                        self.assertEqual(response.status, 206)
                        self.assertEqual(response.read(), b'impo')
                    with self.assertRaises(HTTPError) as error:
                        urlopen(base + 'unknown')
                    self.assertEqual(error.exception.code, 404)
                    error.exception.close()
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()
