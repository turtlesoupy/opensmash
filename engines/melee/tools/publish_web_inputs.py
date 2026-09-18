"""Publish versioned Melee inputs to the website's EXISTING PRIVATE bucket.
No conversions are prebuilt. Character sources are fetched lazily per fighter.
"""
import argparse,hashlib,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.bucket_cache import Store,pack
from opensmash_melee.web_game import ISO_SHA256,GameSetup

UPSTREAM_WEB_FILES=['runtime.html','runtime.mjs','index.html','disc-cache.mjs','save-migration.mjs','gpu-preflight.mjs','frame-worker.mjs','initial_pipeline_cache.db']
UPSTREAM_BUILT_FILES=['melee_browser.js','melee_browser.wasm']

def default_melee_pc():
    import os
    configured=os.environ.get('MELEE_PC_ROOT')
    return Path(configured) if configured else ROOT.parents[2]/'melee-pc'

def character_files(source):
    names=['rigged.glb','character.json','portrait_raw.png','portrait_raw.webp','portrait.png','portrait_transparent.png','stock_raw.png','emblem_raw.png','emblem_stencil.png','announcer.wav',
           'melee-source-ready.json','melee-source.json','melee-source.rgba8','melee-source.identity.dat']
    return [name for name in names if (Path(source)/name).is_file()]


def publish(workspace,characters,store,slugs=None,melee_pc=None,native_fit=None,iso=None,release_fingerprint=None):
    import shutil
    workspace=Path(workspace);characters=Path(characters)
    native_fit=Path(native_fit) if native_fit else ROOT/'build/native-fit'
    melee_pc=Path(melee_pc) if melee_pc else default_melee_pc()
    setup=GameSetup(workspace)
    if iso:setup.use_existing(iso)
    else:setup.restore()
    if not setup.ready:raise ValueError('Use an existing verified conversion workspace')
    manifest={'format':'opensmash-melee-hosted-v1','characters':{}}
    if release_fingerprint:manifest['releaseFingerprint']=release_fingerprint
    # Inputs are content-addressed, so a re-publish only uploads what changed.
    existing=set(store.keys('melee/inputs/'))
    def upload(raw):
        sha=hashlib.sha256(raw).hexdigest();key='melee/inputs/'+sha+'.tar.gz'
        if key not in existing:store.put(key,raw);existing.add(key)
        return {'key':key,'sha256':sha}
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
        # The default browser engine is the pinned Melee PC fork (UPSTREAM.md). The
        # website container has no checkout, so its runtime travels in this pack and
        # serve_melee.py reads it from build/hosted-browser/upstream/ when needed.
        pin=json.loads((ROOT/'upstream.json').read_text())
        upstream_sources=melee_pc/'platforms/browser';upstream_built=melee_pc/'build/browser/runtime/platforms/browser'
        for folder,source,names in [('platforms',upstream_sources,UPSTREAM_WEB_FILES),('runtime',upstream_built,UPSTREAM_BUILT_FILES)]:
            (target/'upstream'/folder).mkdir(parents=True,exist_ok=True)
            for name in names:
                if not (source/name).is_file():
                    if name=='frame-worker.mjs':continue
                    raise ValueError(f'Missing Melee PC browser runtime file {source/name}; build the pinned fork with tools/build_upstream.py')
                shutil.copy2(source/name,target/'upstream'/folder/name)
        # The direct-C audio consumer (Sonic time-stretch) is built by tools/build_upstream.py
        # next to this repository and is required by the upstream engine's audio path.
        audio=ROOT/'build/direct-c/melee-audio.wasm'
        if not audio.is_file():raise ValueError(f'Missing {audio}; run tools/build_upstream.py')
        (target/'direct-c').mkdir(parents=True,exist_ok=True);shutil.copy2(audio,target/'direct-c/melee-audio.wasm')
        # Native fitting is the sole browser character path. Derived target
        # templates stay in the input bundle, never in the source repository.
        fit_target=target/'native-fit';fit_target.mkdir()
        for name in ['native-fit.mjs','costume.mjs','presentation.mjs','worker.mjs']:
            shutil.copy2(ROOT/'runtime/fitting'/name,fit_target/name)
        for name in ['fit.mjs','fit.wasm','SCIPY-LICENSE.txt','build.json']:
            if not (native_fit/name).is_file():raise ValueError(f'Missing native fitter {name}; run tools/build_native_fit.py')
            shutil.copy2(native_fit/name,fit_target/name)
        from opensmash_melee.targets import BY_SLUG
        derived=native_fit/'local/targets';destination=fit_target/'assets/targets';destination.mkdir(parents=True)
        for slug,row in BY_SLUG.items():
            for name in [slug+'.json',*[f'{slug}-{i}.dat' for i in range(len(row['costumes']))]]:
                if not (derived/name).is_file():raise ValueError(f'Missing target {name}; run tools/prepare_native_fit_local.py')
                shutil.copy2(derived/name,destination/name)
        manifest['nativeFitting']=1
        manifest['upstream']={'repository':pin['repository'],'revision':pin['revision']}
        manifest['browser']=upload(pack(root,['build/hosted-browser']))
    catalog=json.loads((ROOT/'web/public/catalog.json').read_text())
    if slugs:catalog=[r for r in catalog if r['slug'] in slugs]
    for row in catalog:
        source=characters/row['slug']
        if not (source/'rigged.glb').is_file():raise ValueError('Missing character source: '+row['slug'])
        names=character_files(source)
        manifest['characters'][row['slug']]=upload(pack(source,names))
    raw=json.dumps(manifest,sort_keys=True).encode();key='melee/inputs/'+hashlib.sha256(raw).hexdigest()+'.json';store.put(key,raw)
    return key

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',type=Path,required=True);p.add_argument('--native-fit',type=Path,help='built fitter and derived targets (default: build/native-fit)');p.add_argument('--characters',type=Path,required=True)
    p.add_argument('--melee-pc',type=Path,help='pinned Melee PC fork checkout (default: MELEE_PC_ROOT or the sibling melee-pc directory)')
    p.add_argument('--iso',type=Path,help='Verify an existing extracted workspace against this original disc')
    p.add_argument('--only',nargs='*',help='publish only these character slugs (local checks)')
    group=p.add_mutually_exclusive_group(required=True);group.add_argument('--bucket');group.add_argument('--local-store',type=Path)
    a=p.parse_args();print(publish(a.workspace,a.characters,Store(a.bucket,a.local_store),slugs=a.only,melee_pc=a.melee_pc,native_fit=a.native_fit,iso=a.iso))
