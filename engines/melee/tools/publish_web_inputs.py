"""Publish versioned Melee inputs to the website's EXISTING PRIVATE bucket.
No conversions are prebuilt. Character sources are fetched lazily per fighter.
"""
import argparse,hashlib,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.bucket_cache import Store,pack
from opensmash_melee.web_game import ISO_SHA256,GameSetup

def publish(workspace,browser,characters,store,slugs=None):
    import shutil
    workspace=Path(workspace);browser=Path(browser);characters=Path(characters)
    setup=GameSetup(workspace);setup.restore()
    if not setup.ready:raise ValueError('Use an existing verified conversion workspace')
    manifest={'format':'opensmash-melee-hosted-v1','characters':{}}
    def upload(raw):
        sha=hashlib.sha256(raw).hexdigest();key='melee/inputs/'+sha+'.tar.gz'
        store.put(key,raw);return {'key':key,'sha256':sha}
    with tempfile.TemporaryDirectory() as temp:
        root=Path(temp);files=root/'assets/game/files';files.mkdir(parents=True)
        # Costume skeletons/forms and menu/audio templates; never the full disc,
        # executable, stages or match audio. These stay in the private bucket.
        names=[p.relative_to(workspace/'assets/game/files') for p in (workspace/'assets/game/files').glob('Pl*.dat')]
        names += [Path(n) for n in ['MnSlChr.dat','MnSlChr.usd','audio/nr_select.ssm','audio/us/nr_select.ssm']]
        hashes={}
        for name in names:
            src=workspace/'assets/game/files'/name;dest=files/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
            hashes['files/'+name.as_posix()]=hashlib.sha256(dest.read_bytes()).hexdigest()
        receipt=root/'build/web-game/verified.json';receipt.parent.mkdir(parents=True);receipt.write_text(json.dumps({'iso_sha256':ISO_SHA256,'files':hashes}))
        manifest['templates']=upload(pack(root,['assets/game','build/web-game/verified.json']))
        target=root/'build/hosted-browser';target.mkdir(parents=True)
        required=['opensmash-web.js','opensmash-web.wasm','opensmash-web.worker.js','opensmash-web-build.json','sys-bundle.bin']
        for name in required:
            if not (browser/name).is_file():raise ValueError('Missing browser runtime: '+name)
            shutil.copy2(browser/name,target/name)
        for name in ['opensmash-web.js.gz','opensmash-web.wasm.gz','opensmash-web.worker.js.gz']:
            if (browser/name).is_file():shutil.copy2(browser/name,target/name)
        manifest['browser']=upload(pack(root,['build/hosted-browser']))
    catalog=json.loads((ROOT/'web/public/catalog.json').read_text())
    if slugs:catalog=[r for r in catalog if r['slug'] in slugs]
    for row in catalog:
        source=characters/row['slug']
        if not (source/'rigged.glb').is_file():raise ValueError('Missing character source: '+row['slug'])
        names=[name for name in ['rigged.glb','character.json','portrait_raw.png','portrait_raw.webp','portrait.png','portrait_transparent.png','stock_raw.png','emblem_raw.png','emblem_stencil.png','announcer.wav'] if (source/name).is_file()]
        manifest['characters'][row['slug']]=upload(pack(source,names))
    raw=json.dumps(manifest,sort_keys=True).encode();key='melee/inputs/'+hashlib.sha256(raw).hexdigest()+'.json';store.put(key,raw)
    return key

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',type=Path,required=True);p.add_argument('--browser',type=Path,required=True);p.add_argument('--characters',type=Path,required=True)
    group=p.add_mutually_exclusive_group(required=True);group.add_argument('--bucket');group.add_argument('--local-store',type=Path)
    a=p.parse_args();print(publish(a.workspace,a.browser,a.characters,Store(a.bucket,a.local_store)))
