"""Bounded, content-addressed source preprocessing for browser native fitting.

This prepares a source once, independent of moveset. Fitting remains in WASM.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

_slots = threading.BoundedSemaphore(2)
_guard = threading.Lock()
_locks = {}


def prepare(root, source, slug, restore=None):
    root, source = Path(root), Path(source)
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', slug):
        raise ValueError('Invalid character identifier')
    if not (source/'rigged.glb').is_file():
        raise ValueError('This character’s model is unavailable.')
    started = time.monotonic()
    digest = hashlib.sha256(b'native-source-v1\0')
    # Only source art/geometry and preprocessing code affect these assets.
    files = [source/name for name in ('rigged.glb','stock_raw.png','emblem_raw.png','emblem_stencil.png')]
    files += sorted((root/'opensmash_melee').glob('*.py'))
    files += [root/'tools/prepare_native_fit_local.py']
    # Only rendered identity fields matter; imported sources omit generation metadata.
    metadata=source/'character.json'
    if metadata.is_file():
        identity=json.loads(metadata.read_text())
        digest.update(json.dumps([(identity.get('short') or identity['display']).upper(),identity['display'].upper()]).encode())
    for file in files:
        digest.update(file.name.encode()+b'\0')
        if file.is_file():
            with file.open('rb') as stream:digest.update(hashlib.file_digest(stream,'sha256').digest())
        else:digest.update(b'missing')
    key = digest.hexdigest()
    revisions = root/'build/native-fit/local/revisions'
    storage_key=hashlib.sha256((key+slug).encode()).hexdigest()
    destination = revisions/storage_key
    expected = [destination/'sources'/f'{slug}{suffix}' for suffix in ('.json','.rgba8','.identity.dat')]
    def ready():return (destination/'ready.json').is_file() and all(p.is_file() for p in expected)
    with _guard:lock = _locks.setdefault(storage_key, threading.Lock())
    remaining = lambda:max(.001,60-(time.monotonic()-started))
    if not lock.acquire(timeout=remaining()):raise ValueError('Character preparation is busy. Please try again.')
    try:
        cached = ready()
        if not cached and restore is not None:
            # Restore only the revision computed from current source and code.
            restore(storage_key)
            cached = ready()
        if not cached:
            if not _slots.acquire(timeout=remaining()):raise ValueError('Character preparation is busy. Please try again.')
            try:
                revisions.mkdir(parents=True,exist_ok=True)
                with tempfile.TemporaryDirectory(prefix='.source-',dir=revisions) as temporary:
                    stage=Path(temporary)
                    baked=source/'melee-source-ready.json'
                    try:baked_ready=json.loads(baked.read_text()).get('key')==key
                    except (OSError,ValueError):baked_ready=False
                    suffixes=('.json','.rgba8','.identity.dat')
                    if baked_ready and all((source/f'melee-source{suffix}').is_file() for suffix in suffixes):
                        (stage/'sources').mkdir()
                        for suffix in suffixes:shutil.copyfile(source/f'melee-source{suffix}',stage/'sources'/f'{slug}{suffix}')
                    else:
                        result=subprocess.run([sys.executable,str(root/'tools/prepare_native_fit_local.py'),
                            '--source',str(source),'--slug',slug,'--source-only','--output',str(stage)],
                            cwd=root,capture_output=True,text=True,timeout=remaining())
                        if result.returncode:
                            log=root/'build/native-fit'/f'{slug}-source.log'
                            log.write_text(result.stdout+'\n'+result.stderr)
                            raise ValueError('This character’s model could not be prepared. Please try another character.')
                    for suffix in ('.json','.rgba8','.identity.dat'):
                        if not (stage/'sources'/f'{slug}{suffix}').is_file():raise ValueError('Character preparation did not finish.')
                    (stage/'ready.json').write_text(json.dumps({'key':key,'slug':slug}))
                    if destination.exists():shutil.rmtree(destination)
                    stage.rename(destination)
            except subprocess.TimeoutExpired:
                raise ValueError('Character preparation timed out. Please try again.') from None
            finally:_slots.release()
        return {'base':f'/api/native-fit/assets/{storage_key}/sources/{slug}',
                'cached':cached,'sourcePreparationMs':(time.monotonic()-started)*1000}
    finally:lock.release()
