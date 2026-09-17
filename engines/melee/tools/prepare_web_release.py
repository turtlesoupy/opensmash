"""Ensure deployment has a Melee input release matching its committed inputs.

Reuses the private release index before invoking any build. Never bulk-bakes
characters: existing portable sources are packed, and missing ones fill lazily.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from opensmash_melee.bucket_cache import Store
from opensmash_melee.web_game import GameSetup, ISO_SHA256
from tools.publish_web_inputs import publish, default_melee_pc, character_files


def input_fingerprint(characters, root=ROOT):
    """Hash source inputs, not generated binaries or machine-specific paths."""
    root, characters = Path(root), Path(characters)
    digest = hashlib.sha256(b'opensmash-melee-release-v1\0' + ISO_SHA256.encode())
    files = [root/'upstream.json', root/'requirements.txt', root/'web/public/catalog.json']
    for folder in ('opensmash_melee', 'tools', 'runtime'):
        files += sorted(p for p in (root/folder).rglob('*')
                        if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc')
    def add(label, path):
        digest.update(label.encode()+b'\0')
        with path.open('rb') as stream:
            digest.update(hashlib.file_digest(stream, 'sha256').digest())
    for path in files:
        add(path.relative_to(root).as_posix(), path)
    for row in json.loads((root/'web/public/catalog.json').read_text()):
        slug = row['slug']
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', slug):
            raise ValueError('Invalid catalog character')
        source = characters/slug
        # The mesh and its descriptor are what conversion needs; presentation
        # art is packed when present (publish_web_inputs.character_files) and a
        # handful of catalog fighters ship without emblems or raw portraits.
        for name in ('rigged.glb', 'character.json'):
            if not (source/name).is_file():
                raise ValueError(f'Missing character input: {source/name}')
        for name in character_files(source):
            add('characters/'+slug+'/'+name, source/name)
    return digest.hexdigest()


def matching_manifest(store, key, fingerprint):
    if not re.fullmatch(r'melee/inputs/[a-f0-9]{64}\.json', key or ''):
        return False
    raw = store.get(key)
    if raw is None or hashlib.sha256(raw).hexdigest() != Path(key).stem:
        return False
    try:
        manifest = json.loads(raw)
        return (manifest.get('format') == 'opensmash-melee-hosted-v1'
                and manifest.get('nativeFitting') == 1
                and manifest.get('releaseFingerprint') == fingerprint)
    except (ValueError, AttributeError):
        return False


def build_inputs(workspace, melee_pc, iso, jobs):
    setup = GameSetup(workspace)
    if iso:
        setup.use_existing(iso)
    else:
        setup.restore()
    if not setup.ready:
        raise ValueError('No matching published release; provide a verified MELEE_WORKSPACE '
                         'or MELEE_ISO and its extracted game files before deploying.')
    env = {**os.environ, 'MELEE_PC_ROOT': str(melee_pc)}
    commands = [
        [sys.executable, ROOT/'tools/build_upstream.py', '--jobs', str(jobs)],
        [sys.executable, ROOT/'tools/prepare_native_fit_local.py',
         '--game', Path(workspace)/'assets/game/files', '--output', ROOT/'build/native-fit/local'],
    ]
    for command in commands:
        subprocess.run([str(x) for x in command], env=env, check=True, stdout=sys.stderr)


def ensure_release(workspace, characters, store, *, candidate=None, melee_pc=None,
                   iso=None, jobs=6, root=ROOT, builder=build_inputs, publisher=publish):
    fingerprint = input_fingerprint(characters, root)
    index_key = 'melee/releases/'+fingerprint+'.json'
    if matching_manifest(store, candidate, fingerprint):
        print('Reusing matching Melee input manifest', file=sys.stderr)
        return candidate
    index = store.get(index_key)
    try:
        indexed = json.loads(index).get('manifest') if index else None
    except (ValueError, AttributeError):
        indexed = None
    if matching_manifest(store, indexed, fingerprint):
        print('Reusing matching Melee input release', file=sys.stderr)
        return indexed
    print('Melee inputs changed or have not been published; building release', file=sys.stderr)
    melee_pc = Path(melee_pc) if melee_pc else default_melee_pc()
    builder(workspace, melee_pc, iso, jobs)
    # Detect edits to the library during a long build before publishing anything.
    if input_fingerprint(characters, root) != fingerprint:
        raise ValueError('Melee inputs changed during the build; retry deployment.')
    key = publisher(workspace, characters, store, melee_pc=melee_pc, iso=iso,
                    release_fingerprint=fingerprint)
    if input_fingerprint(characters, root) != fingerprint:
        raise ValueError('Melee inputs changed during publishing; retry deployment.')
    if not matching_manifest(store, key, fingerprint):
        raise ValueError('Published Melee manifest failed release verification')
    store.put(index_key, json.dumps({'manifest': key}, sort_keys=True).encode())
    return key


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace', type=Path, default=ROOT)
    p.add_argument('--characters', type=Path, default=ROOT.parents[1]/'play/ui')
    p.add_argument('--melee-pc', type=Path)
    p.add_argument('--iso', type=Path)
    p.add_argument('--candidate')
    p.add_argument('--jobs', type=int, default=6)
    store = p.add_mutually_exclusive_group(required=True)
    store.add_argument('--bucket')
    store.add_argument('--local-store', type=Path)
    args = p.parse_args()
    if args.jobs < 1:p.error('--jobs must be positive')
    try:
        key = ensure_release(args.workspace, args.characters, Store(args.bucket, args.local_store),
                             candidate=args.candidate, melee_pc=args.melee_pc, iso=args.iso, jobs=args.jobs)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        p.exit(2, f'Melee release preparation failed: {error}\n')
    print(key)

if __name__ == '__main__':
    main()
