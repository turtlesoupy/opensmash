"""Start the converter inside the website container, using the existing private bucket."""
import hashlib,json,os,shutil,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def main():
    workspace=Path(os.environ.get('MELEE_WORKSPACE','/tmp/opensmash-melee')).resolve()
    if ROOT!=workspace:
        workspace.mkdir(parents=True,exist_ok=True)
        for name in ['tools','opensmash_melee','runtime']:
            shutil.copytree(ROOT/name,workspace/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        (workspace/'web/public').mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/'web/public/catalog.json',workspace/'web/public/catalog.json')
        os.execv(sys.executable,[sys.executable,str(workspace/'tools/serve_embedded.py')])
    from opensmash_melee.bucket_cache import Store,BucketAccess,unpack
    store=Store(os.environ.get('GCS_PRIVATE_BUCKET'),os.environ.get('MELEE_OBJECT_ROOT'))
    manifest_key=os.environ.get('MELEE_INPUT_MANIFEST')
    if not manifest_key:raise ValueError('Publish Melee inputs and set MELEE_INPUT_MANIFEST')
    raw=store.get(manifest_key)
    if raw is None:raise ValueError('Published Melee inputs are missing')
    manifest=json.loads(raw)
    if manifest.get('format')!='opensmash-melee-hosted-v1':raise ValueError('Invalid Melee input manifest')
    if manifest.get('nativeFitting')!=1:raise ValueError('Republish Melee inputs with native fitting before deploying this build')
    for name in ['templates','browser']:
        entry=manifest[name];marker=workspace/('.'+name+'-sha256')
        if marker.is_file() and marker.read_text()==entry['sha256']:continue
        bundle=store.get(entry['key'])
        if bundle is None or hashlib.sha256(bundle).hexdigest()!=entry['sha256']:raise ValueError('Melee input checksum mismatch')
        unpack(bundle,workspace);marker.write_text(entry['sha256'])
    os.environ['MELEE_BROWSER_BUILD']=str(workspace/'build/hosted-browser')
    os.environ['OPENSMASH_CHARACTER_ROOT']=str(workspace/'assets/library')
    import serve_melee as base
    from opensmash_melee.web_game import GameSetup
    base.TOKEN=os.environ['MELEE_SERVICE_TOKEN'];base.SETUP=GameSetup(workspace);base.SETUP.restore()
    if not base.SETUP.ready:raise ValueError('Melee conversion templates failed verification')
    from opensmash_melee.character_import import ImportManager
    base.IMPORTS=ImportManager(base.CATALOG,base.LOCK,workspace=workspace,queue_limit=16,origins=os.environ.get('MELEE_SOURCE_ORIGINS','https://smash.fun,https://www.smash.fun').split(','))
    from opensmash_melee.hosted_cache import ServiceCache
    # Content changes invalidate conversion caches; immutable source inputs and
    # owner grants are independent, so deploys never drop imported fighters.
    digest=hashlib.sha256(raw)
    for folder in ['opensmash_melee','tools']:
        for file in sorted((workspace/folder).glob('*.py')):digest.update(file.name.encode());digest.update(file.read_bytes())
    cache=ServiceCache(base,store,manifest,digest.hexdigest());cache.install_import_cache()
    from serve_hosted import handler
    server=base.ThreadingHTTPServer(('127.0.0.1',0),handler(base,BucketAccess(store),cache))
    print('MELEE_READY',server.server_port,flush=True)
    try:server.serve_forever()
    finally:server.server_close()

if __name__=='__main__':main()
