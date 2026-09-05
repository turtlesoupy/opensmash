"""Resolve website characters and stage an offline BattleShip roster (stdlib only)."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import io
import os
import tempfile
import json
import math
from pathlib import Path
import re
import struct
import urllib.error
import urllib.parse
import urllib.request

FIGHTERS = ['mario', 'fox', 'donkey', 'samus', 'luigi', 'link', 'yoshi', 'captain', 'kirby', 'pikachu', 'purin', 'ness']
# Visual tile order used by the native character-select screen.
TILES = [4, 0, 2, 5, 3, 7, 11, 6, 8, 1, 9, 10]
MODELS = [296, 313, 317, 320, 323, 324, 338, 332, 328, 341, 330, 335]
MAINS = [203, 209, 213, 217, 221, 225, 247, 236, 229, 243, 233, 239]
TITLES = ['Mario', 'Fox', 'Donkey', 'Samus', 'Luigi', 'Link', 'Yoshi', 'Captain', 'Kirby', 'Pikachu', 'Purin', 'Ness']
LIMIT = 32 * 1024 * 1024


def fetch(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError('Character assets must use HTTP(S) URLs without embedded credentials')
    request = urllib.request.Request(url, headers={'User-Agent': 'OpenSmash-Build/1.0', 'Accept-Encoding': 'gzip'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read(LIMIT + 1)
            if len(data) > LIMIT:
                raise ValueError('Character response exceeds 32 MiB')
            if response.headers.get('Content-Encoding') == 'gzip':
                with gzip.GzipFile(fileobj=io.BytesIO(data)) as zipped:
                    data = zipped.read(LIMIT + 1)
            if len(data) > LIMIT:
                raise ValueError('Decoded character response exceeds 32 MiB')
            return data
    except (urllib.error.URLError, OSError) as exc:
        # Capability URLs can grant access to private fighters: never echo them.
        code = getattr(exc, 'code', None)
        raise ValueError(f'Could not download character data from {parsed.hostname}' +
                         (f' (HTTP {code})' if code else '') + '. Check the link and network connection.') from None


def clean_character(source, origin):
    c = dict(source)
    slug = c.get('slug', '')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,63}', slug):
        raise ValueError('Character needs a slug of 1–63 letters, digits, underscores or hyphens')
    for key in ('bundleUrl', 'uiUrl', 'voiceUrl', 'portrait'):
        if c.get(key):
            c[key] = urllib.parse.urljoin(origin, c[key])
    if not c.get('bundleUrl'):
        raise ValueError(f'{slug}: missing bundle URL')
    base = c.get('base')
    c['fkind'] = FIGHTERS.index(base) if base in FIGHTERS else int(c.get('fkind', 0))
    if not 0 <= c['fkind'] < 12:
        raise ValueError(f'{slug}: invalid fighter base')
    c['name'] = str(c.get('name') or c.get('display') or slug)
    c['short'] = str(c.get('short') or c['name']).upper()
    return c


def download_character(url):
    """Resolve companions for the download URL emitted by FighterJobModal.

    Private jobs use a capability route. Public jobs expose a versioned
    object-store URL. Both already publish a manifest; no API login is needed.
    Unknown standalone mesh URLs keep the legacy mesh-only behavior.
    """
    parsed = urllib.parse.urlsplit(url)
    private = re.fullmatch(r'(.*)/engine/bundles/([a-z0-9]+)-([A-Za-z0-9]{16})\.osb6', parsed.path)
    public = re.fullmatch(r'(.*/characters/([a-z0-9]+)/versions/[^/]+)/injection/\2\.osb6', parsed.path)
    if private:
        prefix, slug, capability = private.groups()
        root = f'{prefix}/engine/fighters/{slug}-{capability}'
        paths = dict(uiUrl=parsed.path[:-5]+'.osbui', voiceUrl=parsed.path[:-5]+'.wav',
                     portrait=root+'/portrait.png')
    elif public:
        root, slug = public.groups()
        paths = dict(uiUrl=parsed.path[:-5]+'.osbui', voiceUrl=root+'/announcer.wav',
                     portrait=root+'/portrait.png')
    else:
        return None

    def at(path):
        return urllib.parse.urlunsplit(parsed._replace(path=path, fragment=''))

    manifest_url = at(root+'/manifest.json')
    manifest = json.loads(fetch(manifest_url))
    character = manifest.get('character', {})
    artifacts = manifest.get('artifacts', {})
    if manifest.get('protocolVersion') != 1 or character.get('slug') != slug:
        raise ValueError('Character download manifest has an unsupported version or mismatched slug')
    for key in ('bundle', 'ui', 'announcer'):
        if not isinstance(artifacts.get(key), dict):
            raise ValueError(f'{slug}: download manifest is missing the {key} artifact')
    c = dict(character, bundleUrl=url, requireExtras=True)
    for key, artifact in [('uiUrl', 'ui'), ('voiceUrl', 'announcer'), ('portrait', 'portrait')]:
        source = artifacts.get(artifact, {})
        c[key] = urllib.parse.urljoin(manifest_url, source.get('url') or at(paths[key]))
    c['variants'] = artifacts.get('targets', [])
    return c


def from_url(url):
    """Copied build link, engine launch link, or a direct OSB6 URL."""
    parsed = urllib.parse.urlsplit(url)
    fragment = urllib.parse.parse_qs(parsed.fragment)
    query = urllib.parse.parse_qs(parsed.query)
    if 'opensmash-character' in fragment:
        c = json.loads(fragment['opensmash-character'][0])
    elif 'inject' in query:
        bundle = urllib.parse.urljoin(url, query['inject'][0])
        slug = re.sub(r'-[A-Za-z0-9]{16}$', '', Path(urllib.parse.urlsplit(bundle).path).stem)
        c = dict(slug=slug, bundleUrl=bundle, fkind=int(query.get('fkind', ['0'])[0]),
                 name=query.get('inject_name', [slug])[0], short=query.get('inject_short', [slug])[0],
                 uiUrl=query.get('inject_ui', [None])[0], voiceUrl=query.get('inject_voice', [None])[0])
    elif parsed.path.endswith(('.osb6', '.osb')):
        slug = re.sub(r'-[A-Za-z0-9]{16}$', '', Path(parsed.path).stem)
        c = download_character(url) or dict(slug=slug, bundleUrl=url)
    else:
        raise ValueError('Use Copy build link in fighter details, an engine launch URL, or a direct .osb6 URL')
    return clean_character(c, url)


def resolve(catalog, site, selectors, urls):
    selected = []
    tokens = [s.strip() for arg in (selectors or ['all']) for s in arg.split(',') if s.strip()]
    if ('all' in tokens or 'none' in tokens) and len(tokens) != 1:
        raise ValueError('Use all or none alone, or list character slugs')
    if tokens != ['none']:
        raw = fetch(catalog) if catalog.startswith(('https://', 'http://')) else Path(catalog).read_bytes()
        data = json.loads(raw)
        rows = data['characters'] if isinstance(data, dict) else data
        if not isinstance(rows, list):
            raise ValueError('Catalog must contain a characters array')
        by_slug = {c['slug']: c for c in rows}
        missing = [s for s in tokens if s != 'all' and s not in by_slug]
        if missing:
            raise ValueError('Unknown character(s): ' + ', '.join(missing))
        selected = [clean_character(c, site.rstrip('/') + '/') for c in
                    (rows if tokens == ['all'] else [by_slug[s] for s in tokens])]
    # Explicit links override a catalog record with the same slug.
    ordered = {c['slug']: c for c in selected}
    for url in urls:
        c = from_url(url)
        ordered[c['slug']] = c
    result = list(ordered.values())
    if not result:
        raise ValueError('No characters selected; use --vanilla for a native build without injection')
    if len(result) > 2048:
        raise ValueError('BattleShip supports at most 2048 roster entries')
    return result


def osb6_blocks(data):
    if len(data) < 16 or data[:4] != b'OSB6':
        raise ValueError('Expected an OSB6 fighter bundle')
    w, h, n = struct.unpack_from('<3I', data, 4)
    at = 16 + w * h * 2
    if not 0 < w <= 1024 or not 0 < h <= 1024 or not 0 < n <= 12 or at > len(data):
        raise ValueError('Invalid OSB6 header')
    blocks = {}
    for _ in range(n):
        if at + 8 > len(data):
            raise ValueError('Truncated OSB6 block header')
        fk, size = struct.unpack_from('<2I', data, at)
        at += 8
        if fk >= 12 or fk in blocks or size < 24 or at + size > len(data):
            raise ValueError('Invalid OSB6 block')
        payload = data[at:at + size]
        if payload[:4] != b'OSB5' or struct.unpack_from('<2I', payload, 16) != (0, 0):
            raise ValueError('Invalid OSB6 payload')
        blocks[fk] = payload
        at += size
    if at != len(data):
        raise ValueError('Unexpected OSB6 trailing bytes')
    return w, h, data[16:16 + w * h * 2], blocks


def extract(data, fk):
    if data[:4] == b'OSB5':
        validate_mesh(data)
        return data
    w, h, texture, blocks = osb6_blocks(data)
    if fk not in blocks:
        raise ValueError(f'Bundle has no {FIGHTERS[fk]} variant')
    payload = bytearray(blocks[fk])
    nj = struct.unpack_from('<I', payload, 4)[0]
    struct.pack_into('<2I', payload, 16, w, h)
    at = 24 + nj * 4
    mesh = bytes(payload[:at]) + texture + bytes(payload[at:])
    validate_mesh(mesh)
    return mesh


def validate_mesh(data):
    if len(data) < 24 or data[:4] != b'OSB5':
        raise ValueError('Expected an OSB5 mesh')
    nj, nv, nt, w, h = struct.unpack_from('<5I', data, 4)
    if not (0 < nj <= 32 and 0 < nv <= 65535 and 0 < nt <= 100000 and 0 < w <= 1024 and 0 < h <= 1024):
        raise ValueError('Invalid OSB5 dimensions')
    end = 24 + nj * 4 + w * h * 2 + nv * 28 + nt * 8
    if end > len(data):
        raise ValueError('Truncated OSB5 mesh')
    start = 24 + nj * 4 + w * h * 2
    for vertex in struct.iter_unpack('<fffhhBBBBBBBBbbbB', data[start:start+nv*28]):
        if not all(math.isfinite(x) for x in vertex[:3]) or max(vertex[5:9]) >= nj:
            raise ValueError('Invalid OSB5 vertex or joint index')
    for a, b, c, _ in struct.iter_unpack('<4H', data[end-nt*8:end]):
        if max(a, b, c) >= nv:
            raise ValueError('Invalid OSB5 triangle index')


def field(value, limit):
    # C's roster format is byte limited and delimiter based.
    return str(value).replace('|', ' ').replace('\n', ' ').replace('\r', ' ').replace('\0', '').encode('utf-8')[:limit].decode('utf-8', 'ignore')


OSBV_EMBLEM_OFFSET = 4 + 8640 + 64 * 16 + 80 + 32 + 64 * 12


def has_emblem(data):
    canvas = data[OSBV_EMBLEM_OFFSET:OSBV_EMBLEM_OFFSET + 48 * 48]
    return data[:4] == b'OSBV' and len(canvas) == 48 * 48 and any(canvas)


def validate_voice(data):
    """Match BattleShip's PCM s16 mono/stereo WAV reader, rejecting truncation."""
    if len(data) < 44 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('Announcer must be a PCM 16-bit WAV file')
    at, fmt, samples = 12, None, None
    while at + 8 <= len(data):
        kind, size = struct.unpack_from('<4sI', data, at)
        at += 8
        if at + size > len(data):
            raise ValueError('Truncated announcer WAV')
        if kind == b'fmt ' and size >= 16:
            fmt = struct.unpack_from('<HHIIHH', data, at)
        elif kind == b'data':
            samples = size
        at += size + size % 2
    if (fmt is None or fmt[0] != 1 or fmt[1] not in (1, 2) or fmt[2] == 0
            or fmt[5] != 16 or samples is None or samples < fmt[1] * 2
            or samples % (fmt[1] * 2)):
        raise ValueError('Announcer must be PCM 16-bit mono or stereo with nonempty audio')


def cached_asset(url, cache):
    key = hashlib.sha256(url.encode()).hexdigest()
    path = cache / key
    if path.exists():
        data = path.read_bytes()
    else:
        data = fetch(url)
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as tmp:
            tmp.write(data)
            temporary = Path(tmp.name)
        os.replace(temporary, path)
    # Immutable bucket objects include their decoded content hash.
    match = re.search(r'/objects/([a-f0-9]{64})/', urllib.parse.urlsplit(url).path)
    if match and hashlib.sha256(data).hexdigest() != match[1]:
        path.unlink(missing_ok=True)
        raise ValueError('Character asset hash mismatch; retry the download')
    return data


def assign_rom(available, preferred):
    """Bipartite slot assignment: never discard a requested fighter or reuse a slot."""
    owners = {}
    def place(i, seen):
        choices = sorted(available[i], key=lambda fk: (fk != preferred[i], fk))
        for fk in choices:
            if fk in seen:
                continue
            seen.add(fk)
            if fk not in owners or place(owners[fk], seen):
                owners[fk] = i
                return True
        return False
    for i in range(len(available)):
        if not place(i, set()):
            raise ValueError('Selected characters do not have enough distinct ROM skeleton variants; choose fewer characters')
    return {i: fk for fk, i in owners.items()}


def prepare(args):
    characters = resolve(args.catalog, args.site, args.characters, args.character_url)
    if args.target == 'rom' and len(characters) > 12:
        raise ValueError(f'Catalog has {len(characters)} characters; this ROM exporter has 12 fixed slots, not runtime pagination. '
                         'Select up to 12 with --characters slug1,slug2 (private links count toward this limit).')
    output = args.output.resolve()
    cache = output / 'character-cache'
    cache.mkdir(parents=True, exist_ok=True)
    print(f'Preparing {len(characters)} characters for {args.target}…', flush=True)
    # Files are cached on disk; retain only one fighter per worker in memory.
    def download(c):
        keys = ['bundleUrl'] if args.target == 'rom' else ['bundleUrl', 'uiUrl', 'voiceUrl', 'portrait']
        for key in keys:
            if c.get(key):
                cached_asset(c[key], cache)
        return c
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, _ in enumerate(pool.map(download, characters), 1):
            if i % 100 == 0:
                print(f'  Downloaded {i}/{len(characters)}', flush=True)
    assignments = {}
    if args.target == 'rom':
        available = []
        for c in characters:
            data = cached_asset(c['bundleUrl'], cache)
            available.append(list(osb6_blocks(data)[3]) if data[:4] == b'OSB6' else [c['fkind']])
        assignments = assign_rom(available, [c['fkind'] for c in characters])
    rows, report, loadout = [], [], []
    for i, c in enumerate(characters):
        folder = output / 'characters' / c['slug']
        folder.mkdir(parents=True, exist_ok=True)
        data = cached_asset(c['bundleUrl'], cache)
        fk = assignments[i] if args.target == 'rom' else c['fkind']
        mesh = extract(data, fk)
        (folder/'mesh.osb').write_bytes(mesh)
        paths = {'bundleUrl': (folder/'mesh.osb').relative_to(output).as_posix()}
        extras = dict(announcer=False, emblem=False)
        if args.target == 'native':
            for key, filename, magic in [('uiUrl', 'ui.osbui', (b'OSBU', b'OSBV')), ('voiceUrl', 'voice.wav', b'RIFF'), ('portrait', 'portrait.png', b'\x89PNG')]:
                if c.get(key):
                    asset = cached_asset(c[key], cache)
                    # The engine validates UI versions. Basic signature checks prevent saving error pages.
                    if not asset.startswith(magic):
                        raise ValueError(f'{c["slug"]}: invalid {key} asset')
                    if key == 'voiceUrl':
                        validate_voice(asset)
                        extras['announcer'] = True
                    elif key == 'uiUrl':
                        extras['emblem'] = has_emblem(asset)
                        if c.get('requireExtras') and not extras['emblem']:
                            raise ValueError(f'{c["slug"]}: UI pack has no embedded emblem; regenerate its UI assets')
                    (folder/filename).write_bytes(asset)
                    paths[key] = (folder/filename).relative_to(output).as_posix()
            rows.append('|'.join([c['slug'], str(TILES[i % 12]), paths['bundleUrl'], paths.get('uiUrl', ''),
                                  paths.get('voiceUrl', ''), field(c['short'], 10), str(fk), field(c['name'], 47), paths.get('portrait', '')]))
        else:
            loadout.append(dict(name=c['name'], slot=TITLES[fk], asset=paths['bundleUrl'], model_file=MODELS[fk],
                                model_source=f'{MODELS[fk]}_{TITLES[fk]}Model.c', main_source=f'{MAINS[fk]}_{TITLES[fk]}Main.c'))
        report.append(dict(slug=c['slug'], name=c['name'], base=FIGHTERS[fk], page=1+i//12,
                           mesh_sha256=hashlib.sha256(mesh).hexdigest(), mesh_bytes=len(mesh), **extras))
    # Publish roster only after every selected character has staged successfully.
    if args.target == 'native':
        (output/'roster.txt').write_text('\n'.join(rows)+'\n')
        (output/'play.py').write_text(LAUNCHER)
        (output/'Play.command').write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec python3 play.py "$@"\n')
        (output/'Play.command').chmod(0o755)
        (output/'Play.bat').write_text('@echo off\r\ncd /d "%~dp0"\r\npy play.py %*\r\n')
    else:
        (output/'loadout.json').write_text(json.dumps(loadout, indent=2)+'\n')
    (output/'characters.json').write_text(json.dumps(dict(target=args.target, count=len(report), characters=report), indent=2)+'\n')
    print(f'Prepared {len(report)} characters' + (f' on {(len(report)+11)//12} custom pages (+ vanilla)' if args.target == 'native' else ''), flush=True)


LAUNCHER = '''#!/usr/bin/env python3
"""Start the locally staged OpenSmash roster; no network needed."""
import os
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parent
candidates = [root/'BattleShip', root/'BattleShip.exe']
candidates += [root/c/'BattleShip.exe' for c in ('Release', 'Debug', 'RelWithDebInfo')]
binary = next((p for p in candidates if p.is_file()), None)
if binary is None:
    sys.exit('BattleShip executable missing; run the native build first.')
env = {k: v for k, v in os.environ.items() if not k.startswith(('SSB64_INJECT_', 'SSB64_PLAYER_CHARS', 'SSB64_BOOT_BATTLE'))}
env.update(SSB64_ROSTER_FILE=str(root/'roster.txt'), SSB64_ROSTER_PAGE='1', SSB64_START_SCENE='16')
sys.exit(subprocess.call([str(binary), *sys.argv[1:]], cwd=root, env=env))
'''


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target', choices=['rom', 'native'], required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--site', default='https://smash.fun')
    p.add_argument('--catalog', default='https://smash.fun/api/characters')
    p.add_argument('--characters', nargs='+')
    p.add_argument('--character-url', action='append', default=[])
    args = p.parse_args()
    try:
        prepare(args)
    except (ValueError, OSError, KeyError, struct.error) as exc:
        p.exit(1, f'Character preparation failed: {exc}\n')
