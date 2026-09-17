import json,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from opensmash_melee.service_access import Access
from tools.serve_hosted import handler
class HostedAccessTests(unittest.TestCase):
 def test_gateway_identity_gates_imported_costumes_and_forbids_local_control(self):
  with tempfile.TemporaryDirectory() as folder:
   access=Access(Path(folder)/'grants.json');one='1'*64;two='2'*64;secret='s'*40
   slug='import-'+'a'*24;access.grant(one,'fighter:'+slug)
   class Base(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def json(self,value,status=200):
     body=json.dumps(value).encode();self.send_response(status);self.end_headers();self.wfile.write(body)
    def do_GET(self):return self.json({'ok':True})
    def do_POST(self):return self.json({'fighter':8,'filename':'PlMrNr.dat'})
   base=SimpleNamespace(Handler=Base,TOKEN=secret,CATALOG={slug:{'imported':True},'public':{}},IMPORTS=SimpleNamespace())
   server=ThreadingHTTPServer(('127.0.0.1',0),handler(base,access));thread=threading.Thread(target=server.serve_forever);thread.start()
   def get(path,owner=one,token=secret,data=None):
    request=urllib.request.Request(f'http://127.0.0.1:{server.server_port}'+path,data=data,headers={'X-OpenSmash-Owner':owner,'X-OpenSmash-Token':token})
    try:
     with urllib.request.urlopen(request) as response:return response.status
    except urllib.error.HTTPError as error:
     status=error.code;error.close();return status
   try:
    self.assertEqual(get('/api/costume/'+slug),200)
    self.assertEqual(get('/api/costume/'+slug,two),404)
    self.assertEqual(get('/api/costume/public',two),200)
    self.assertEqual(get('/api/native-fit/source/public',data=b''),200)
    self.assertEqual(get('/api/native-fit/source/'+slug,owner=two,data=b''),404)
    self.assertEqual(get('/api/native-fit/source/'+slug,data=b''),200)
    revision='c'*64;asset='/api/native-fit/assets/'+revision+'/sources/'+slug+'.json'
    self.assertEqual(get(asset),404)
    access.grant(one,'native-source:'+revision)
    self.assertEqual(get(asset),200)
    self.assertEqual(get(asset,owner=two),404)
    self.assertEqual(get('/api/prepare/public',data=b'{}'),200)
    self.assertEqual(get('/api/prepare/public',data=b''),200)
    self.assertEqual(get('/api/character-select',data=b'{"costumes":[{"character":{}}]}'),404)
    self.assertEqual(get('/api/costume/public',token='wrong'),404)
    for path in ['/api/native/status','/api/setup','/api/game/sys/main.dol','/api/debug','/api/character-select/'+'a'*64+'/0.bin']:self.assertEqual(get(path),404,path)
    self.assertTrue(Access(Path(folder)/'grants.json').allows(one,'fighter:'+slug))
   finally:server.shutdown();server.server_close();thread.join()
