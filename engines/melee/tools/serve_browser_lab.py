"""Loopback-only lab with a bounded endpoint for saving browser-captured video."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json,time
ROOT=Path(__file__).resolve().parents[1]/'build/browser-port/lab'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def do_POST(self):
        if self.path!='/capture' or self.headers.get('Origin')!='http://127.0.0.1:8766':
            self.send_error(403);return
        try:size=int(self.headers.get('Content-Length','0'))
        except ValueError:self.send_error(400);return
        if not 0<size<=32*1024*1024 or self.headers.get('Content-Type')!='video/webm':
            self.send_error(400);return
        body=self.rfile.read(size)
        if len(body)!=size or not body.startswith(b'\x1a\x45\xdf\xa3'):
            self.send_error(400);return
        path=ROOT/'captures'/f'browser-{time.time_ns()}.webm';path.parent.mkdir(exist_ok=True);path.write_bytes(body)
        reply=json.dumps({'url':'/captures/'+path.name}).encode()
        self.send_response(201);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(reply)));self.end_headers();self.wfile.write(reply)
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',8766),Handler).serve_forever()
