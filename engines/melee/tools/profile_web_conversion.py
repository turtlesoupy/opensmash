"""Measure a real cold prepare request in isolated workspaces, using unique cache keys (existing entries are preserved).
Use --fixture from smoke_embedded.mjs (objects/ and instance-one/) and --output.
Runs three ordinary timings plus one cProfile run; profiler timings are separate.
"""
import argparse,json,os,shutil,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def worker(fixture,output,profile):
    import hashlib,threading,urllib.request,uuid
    sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'tools'))
    os.environ['OPENSMASH_CHARACTER_ROOT']=str(ROOT/'assets/library')
    import serve_melee as base
    from opensmash_melee.bucket_cache import Store,BucketAccess
    import opensmash_melee.hosted_cache as cache_module
    from opensmash_melee.web_game import GameSetup
    from opensmash_melee.character_import import ImportManager
    from serve_hosted import handler
    import tools.upgrade_character_surfaces as surfaces
    store=Store(local=fixture/'objects');key=(fixture/'manifest-key.txt').read_text().strip();manifest=json.loads(store.get(key))
    base.TOKEN='local-profile-only-token-000000000000';base.SETUP=GameSetup(ROOT);base.SETUP.restore()
    assert base.SETUP.ready
    base.IMPORTS=ImportManager(base.CATALOG,base.LOCK,workspace=ROOT)
    cache=cache_module.ServiceCache(base,store,manifest,'profile-'+uuid.uuid4().hex)
    events=[]
    def wrap(obj,name,label):
        original=getattr(obj,name)
        def timed(*args,**kwargs):
            started=time.perf_counter()
            try:return original(*args,**kwargs)
            finally:events.append({'stage':label(*args,**kwargs) if callable(label) else label,'ms':(time.perf_counter()-started)*1000})
        setattr(obj,name,timed)
    wrap(base,'run_stage',lambda args,*rest:'subprocess '+str(args[0]))
    wrap(surfaces,'upgrade','surface/artwork upgrade')
    wrap(base,'upgrade_cached_lighting','lighting update')
    wrap(cache,'source','source retrieval/unpack')
    wrap(cache_module,'pack',lambda root,paths:'pack '+','.join(paths))
    wrap(cache,'response','persist cache response (includes packs)')
    # Profiling the actual handler thread, not the idle server main thread.
    Base=handler(base,BucketAccess(store),cache)
    class Measured(Base):
        def do_POST(self):
            if not profile:return super().do_POST()
            import cProfile
            p=cProfile.Profile();p.enable()
            try:return super().do_POST()
            finally:p.disable();p.dump_stats(str(output/'request.prof'))
    server=base.ThreadingHTTPServer(('127.0.0.1',0),Measured)
    thread=threading.Thread(target=server.serve_forever);thread.start()
    try:
        start=time.perf_counter()
        req=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/prepare/donaldtrump?target=falco&color=0&skin=host',data=b'',headers={'X-OpenSmash-Token':base.TOKEN,'X-OpenSmash-Owner':'a'*64})
        with urllib.request.urlopen(req) as response:result=json.load(response)
        elapsed=(time.perf_counter()-start)*1000
        output.joinpath('timings.json').write_text(json.dumps({'request_ms':elapsed,'profiled':profile,'events':events,'result':result},indent=2))
    finally:server.shutdown();server.server_close();thread.join()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fixture',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--worker',action='store_true');p.add_argument('--profile',action='store_true');a=p.parse_args()
    fixture=a.fixture.resolve();output=a.output.resolve();output.mkdir(parents=True,exist_ok=True)
    if a.worker:return worker(fixture,output,a.profile)
    # Only the profiling run adds cProfile to subprocesses, including the nested
    # native converter spawned by build_character.py.
    hooks=output/'hooks';hooks.mkdir(exist_ok=True)
    (hooks/'sitecustomize.py').write_text("import os\nif os.environ.get('MELEE_PROFILE_DIR'):\n import cProfile,atexit\n p=cProfile.Profile();p.enable()\n def finish():\n  p.disable();p.dump_stats(os.path.join(os.environ['MELEE_PROFILE_DIR'],'process-'+str(os.getpid())+'.prof'))\n atexit.register(finish)\n")
    for index in range(4):
        profiled=index==3;run=output/('profiled' if profiled else 'baseline-'+str(index+1));run.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='conversion-',dir=output) as temp:
            work=Path(temp)
            for name in ['tools','opensmash_melee','runtime','web/public']:
                shutil.copytree(ROOT/name,work/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
            (work/'assets').mkdir();(work/'assets/game').symlink_to(fixture/'instance-one/assets/game',target_is_directory=True)
            (work/'build/web-game').mkdir(parents=True)
            shutil.copy2(fixture/'instance-one/build/web-game/verified.json',work/'build/web-game/verified.json')
            from conversion_timing import instrument
            instrument(work,hooks)
            env={**os.environ,'MELEE_TIMING_DIR':str(run),'PYTHONPATH':str(hooks),'MELEE_PROFILE_DIR':str(run) if profiled else ''}
            command=[sys.executable,str(work/'tools/profile_web_conversion.py'),'--fixture',str(fixture),'--output',str(run),'--worker']
            if profiled:command.append('--profile')
            subprocess.run(command,env=env,check=True,stdout=subprocess.DEVNULL)
            print(run.name,(run/'timings.json').read_text(),flush=True)
if __name__=='__main__':main()
