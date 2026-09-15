import json,threading,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request,urlopen
from http.server import ThreadingHTTPServer
from tools import serve_melee as server
from opensmash_melee.targets import cache_id

class RetargetPreparation(unittest.TestCase):
 def test_target_url_resolves_requested_costume_in_separate_cache(self):
  import tempfile
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);slug='fixture';ident=cache_id(slug,'kirby','fox')
   path=root/'build/characters'/ident/'browser/PlKbNr.dat';path.parent.mkdir(parents=True);path.write_bytes(b'kirby-fixture')
   catalog={slug:{'slug':slug,'target':'kirby','original_target':'fox'}}
   with patch.multiple(server,ROOT=root,CATALOG=catalog,TOKEN='',SETUP=SimpleNamespace(ready=True)):
    http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
    thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
    try:
     url=f'http://127.0.0.1:{http.server_port}/api/costume/{slug}?target=kirby&color=0&skin=host'
     with urlopen(url) as response:self.assertEqual(response.read(),b'kirby-fixture')
    finally:http.shutdown();http.server_close();thread.join()
