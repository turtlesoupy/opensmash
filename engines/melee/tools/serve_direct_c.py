"""Serve only this worktree's direct-C build and its local-disc validation UI."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
 def end_headers(self):
  self.send_header('Cross-Origin-Opener-Policy','same-origin');self.send_header('Cross-Origin-Embedder-Policy','require-corp');self.send_header('Cache-Control','no-store');super().end_headers()
 def do_GET(self):
  self.path=self.path.split("?",1)[0]
  if self.path.startswith('/engine/direct-c/'):
   name=self.path[len('/engine/direct-c/'):];self.path=('/build/direct-c/' if name.startswith('melee-') else '/runtime/direct-c/web/')+name
  elif self.path.startswith('/engine/'):self.path='/runtime/web/'+self.path[len('/engine/'):]
  if self.path=='/':self.path='/runtime/direct-c/web/index.html'
  if self.path=='/worker.mjs':self.path='/runtime/direct-c/web/worker.mjs'
  return super().do_GET()
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=5188);a=ap.parse_args();print(f'http://127.0.0.1:{a.port}',flush=True);ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
