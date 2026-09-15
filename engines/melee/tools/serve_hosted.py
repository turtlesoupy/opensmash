"""Private conversion/asset API. Never exposes game setup, disc files or native process control."""
import argparse,hmac,io,json,os,re,shutil,sys
from pathlib import Path
from urllib.parse import unquote,urlsplit
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from opensmash_melee.service_access import Access,route_allowed

def handler(base,access,cache=None):
    class Hosted(base.Handler):
        def authorize(self):
            route=unquote(urlsplit(self.path).path)
            self.owner=self.headers.get('X-OpenSmash-Owner','')
            if not hmac.compare_digest(self.headers.get('X-OpenSmash-Token',''),base.TOKEN) or not re.fullmatch('[a-f0-9]{64}',self.owner):return False
            if not route_allowed(self.command,route):return False
            self.post_body=None
            if self.command=='POST':
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<=length<=16384:return False
                    if not length and not route.startswith('/api/prepare/'):return False
                    raw=self.rfile.read(length);self.post_body=json.loads(raw) if raw else {};self.rfile=io.BytesIO(raw)
                except (ValueError,TypeError):return False
                if not isinstance(self.post_body,dict):return False
            if cache:cache.before_authorize(self,access)
            def fighter(slug):return isinstance(slug,str) and slug in base.CATALOG and (not base.CATALOG[slug].get('imported') or access.allows(self.owner,'fighter:'+slug))
            for prefix in ['/api/prepare/','/api/costume/','/api/announcer/']:
                if route.startswith(prefix):return fighter(route[len(prefix):])
            if route.startswith('/api/imports/portraits/'):return fighter(route.rsplit('/',1)[1][:-5])
            if route.startswith('/api/imports/'):return access.allows(self.owner,'job:'+route.rsplit('/',1)[1])
            if route.startswith('/api/character-select/'):return access.allows(self.owner,'selection:'+route.split('/')[3])
            if route=='/api/character-select':
                costumes=self.post_body.get('costumes')
                return isinstance(costumes,list) and all(isinstance(c,dict) and fighter(c.get('character')) for c in costumes)
            return True
        def local_ui_request(self):return True # authorize() has verified the private gateway token and owner.
        def do_GET(self):
            return self.dispatch(super().do_GET)
        def do_HEAD(self):return self.do_GET()
        def do_POST(self):
            return self.dispatch(super().do_POST)
        def dispatch(self,action):
            from contextlib import nullcontext
            try:
                if not self.authorize():return self.send_error(404)
                with cache.request_lock(self) if cache else nullcontext():
                    if cache:cache.before_request(self)
                    if getattr(self,'cached_value',None):return self.json(self.cached_value)
                    if getattr(self,'remote_job',None):return self.json(self.remote_job)
                    return action()
            except (OSError,ValueError,KeyError) as error:
                print('Melee preparation failed:',type(error).__name__,flush=True)
                return self.json({'error':'Melee preparation is unavailable. Please retry.'},503)
        def do_DELETE(self):return self.send_error(404)
        def json(self,value,status=200):
            if cache:cache.response(self,value,status)
            if isinstance(value,list) and urlsplit(self.path).path=='/api/imports':value=[r for r in value if access.allows(self.owner,'fighter:'+r['slug'])]
            if isinstance(value,dict) and status<300:
                if value.get('id'):access.grant(self.owner,'job:'+value['id'])
                if isinstance(value.get('fighter'),dict) and value['fighter'].get('slug'):access.grant(self.owner,'fighter:'+value['fighter']['slug'])
                for asset in value.get('assets',[]):access.grant(self.owner,'selection:'+asset['url'].split('/')[3])
            return super().json(value,status)
    return Hosted

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--workspace',type=Path,required=True);p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=int(os.environ.get('PORT','8782')));a=p.parse_args()
    token=os.environ.get('MELEE_SERVICE_TOKEN','')
    if len(token)<32:raise SystemExit('MELEE_SERVICE_TOKEN must contain at least 32 characters')
    workspace=a.workspace.resolve();workspace.mkdir(parents=True,exist_ok=True)
    # Code is copied into the writable conversion workspace so existing build
    # tools resolve their assets and caches there, never in the deployment image.
    for name in ([] if ROOT==workspace else ['tools','opensmash_melee','runtime']):
        shutil.copytree(ROOT/name,workspace/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    (workspace/'web/public').mkdir(parents=True,exist_ok=True)
    if ROOT!=workspace:
        shutil.copy2(ROOT/'web/public/catalog.json',workspace/'web/public/catalog.json')
        os.execv(sys.executable,[sys.executable,str(workspace/'tools/serve_hosted.py'),*sys.argv[1:]])
    sys.path.insert(0,str(workspace/'tools'))
    import serve_melee as base
    base.ROOT=workspace;base.GAME=workspace/'assets/game';base.TOKEN=token
    if os.environ.get('MELEE_SYS_ROOT'):base.SYS=Path(os.environ['MELEE_SYS_ROOT'])
    from opensmash_melee.web_game import GameSetup
    base.SETUP=GameSetup(workspace);base.SETUP.restore()
    if not base.SETUP.ready:raise SystemExit('Provision a verified assets/game and build/web-game/verified.json before starting the converter')
    from opensmash_melee.character_import import ImportManager
    base.IMPORTS=ImportManager(base.CATALOG,base.LOCK,workspace=workspace,queue_limit=16,origins=os.environ.get('MELEE_SOURCE_ORIGINS','https://smash.fun,https://www.smash.fun').split(','))
    access=Access(workspace/'build/service-access.json')
    server=base.ThreadingHTTPServer((a.host,a.port),handler(base,access))
    print('Private Melee asset service ready',flush=True)
    try:server.serve_forever()
    finally:server.server_close()
if __name__=='__main__':main()
