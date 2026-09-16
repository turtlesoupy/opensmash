"""Private localhost asset/conversion server for the browser Melee runtime."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from urllib.parse import unquote, urlsplit, parse_qs

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from opensmash_melee.costume_variant import costume_variant, SCHEMA
from opensmash_melee.materials import upgrade_cached_lighting
from opensmash_melee.__main__ import atomic_write
from opensmash_melee.character_build import archive_previous_build,run_stage
GAME = ROOT / 'assets/game'
CHARACTERS = Path(os.environ.get('OPENSMASH_CHARACTER_ROOT', ROOT.parents[1] / 'play/ui')).expanduser().resolve()
SYS = ROOT / 'build/browser-engine/moderngekko-web/vendor/dolphin/Data/Sys'
WEB = ROOT / 'runtime/web'
BUILD = Path(os.environ.get('MELEE_BROWSER_BUILD', ROOT / 'build/moderngekko-wasm')).expanduser().resolve()
# Hosted deployments address engine files under /engine/v/<build>/ so browsers
# and the CDN can cache them forever; the id is the published input manifest's
# hash, which changes whenever the runtime or templates change.
_manifest_key = os.environ.get('MELEE_INPUT_MANIFEST', '')
_manifest_hash = re.search(r'([a-f0-9]{64})\.json$', _manifest_key)
BUILD_VERSION = _manifest_hash.group(1)[:16] if _manifest_hash else ''
IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
CATALOG = {r['slug']: r for r in json.loads((ROOT / 'web/public/catalog.json').read_text())}
from opensmash_melee.targets import PLAYABLE, BY_SLUG, cache_id
KINDS = {slug:(row['fighter'],row['code']) for slug,row in BY_SLUG.items()}
LOCK = threading.Lock()
# Serialize writes to one character/moveset cache, while allowing independent
# characters to prepare together. Duplicate requests must not consume slots.
# Each conversion holds several hundred MB of numpy state; the hosted 2 GiB
# container was OOM-killed with four in flight next to Node.
PREPARATION_SLOTS = threading.BoundedSemaphore(int(os.environ.get('MELEE_PREPARATION_SLOTS', '2')))
PREPARATION_LOCKS = {}


def preparation_lock(ident):
    with LOCK:
        return PREPARATION_LOCKS.setdefault(ident, threading.Lock())

TRACE_IO = False
IMPORTS = None
SETUP = None
NATIVE = None
TOKEN = os.environ.get("OPENSMASH_DESKTOP_TOKEN", "")
DIST = Path(os.environ["OPENSMASH_WEB_DIST"]) if os.environ.get("OPENSMASH_WEB_DIST") else None


def upstream_root(name):
    """Where the pinned Melee PC browser runtime lives for one requested file.

    Developers build the fork into the sibling melee-pc checkout (or MELEE_PC_ROOT).
    Hosted deployments have no checkout: publish_web_inputs.py ships the same files
    inside the browser input pack under build/hosted-browser/upstream/.
    """
    built = name.startswith('melee_browser.')
    configured = os.environ.get('MELEE_PC_ROOT')
    checkout = Path(configured) if configured else (ROOT.parents[2] / 'melee-pc' if len(ROOT.parents) > 2 else None)
    if checkout and checkout.is_dir():
        return checkout / ('build/browser/runtime/platforms/browser' if built else 'platforms/browser')
    return BUILD / 'upstream' / ('runtime' if built else 'platforms')


def descendant(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise FileNotFoundError(relative)
    return path


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cache-Control', getattr(self, 'asset_cache_control', 'no-store'))
        self.asset_cache_control = 'no-store'
        super().end_headers()

    def json(self, value, status=200):
        body = json.dumps(value).encode()
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Reloading abandons in-flight requests; session cleanup is owned
            # by the desktop main process and must still finish normally.
            pass

    def file(self, path):
        content_type = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        compressed = False
        if path.parent == BUILD and path.suffix in ('.wasm', '.js'):
            build = json.loads((BUILD / 'opensmash-web-build.json').read_text())
            identity = build.get('cacheId', build['id'])
            version = parse_qs(urlsplit(self.path).query).get('v')
            if version and version != [identity]:
                return self.send_error(409, 'The engine was updated. Refresh to load the new build.')
            packed = path.with_name(path.name + '.gz')
            encodings = self.headers.get('Accept-Encoding', '')
            # Range requests address the original bytes; keep those uncompressed.
            if not self.headers.get('Range') and re.search(r'(?:^|,)\s*gzip\s*(?:,|$)', encodings) and packed.is_file() and packed.stat().st_mtime >= path.stat().st_mtime:
                path = packed
                compressed = True
            if version == [identity]:
                self.asset_cache_control = 'public, max-age=31536000, immutable'
        size = path.stat().st_size
        start, end = 0, size - 1
        header = self.headers.get('Range')
        if header:
            match = re.fullmatch(r'bytes=(\d+)-(\d*)', header)
            if not match:
                return self.send_error(416)
            start = int(match[1])
            end = min(int(match[2]) if match[2] else end, end)
            if start > end:
                return self.send_error(416)
        self.send_response(206 if header else 200)
        self.send_header('Content-Type', content_type)
        self.send_header('Vary', 'Accept-Encoding')
        if compressed:
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Accept-Ranges', 'bytes')
        if header:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        if self.command == 'HEAD':
            return
        with path.open('rb') as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = stream.read(min(remaining, 1024 * 1024))
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if TOKEN and self.headers.get("X-OpenSmash-Token") != TOKEN:
            return self.send_error(403)
        started = time.perf_counter()
        try:
            self.get_resource()
        finally:
            if TRACE_IO and self.path.startswith(('/api/game/', '/engine/sys/')):
                entry = {'time': time.time(), 'method': self.command, 'path': self.path,
                         'durationMs': (time.perf_counter() - started) * 1000}
                with LOCK, (ROOT / 'build/moderngekko-validation/startup-io.jsonl').open('a') as stream:
                    stream.write(json.dumps(entry) + '\n')

    def get_resource(self):
        route = unquote(urlsplit(self.path).path)
        versioned = re.fullmatch(r'/engine/v/([a-f0-9]{16})/(.+)', route)
        if versioned:
            if not BUILD_VERSION or versioned.group(1) != BUILD_VERSION:
                return self.send_error(404)
            route = '/engine/' + versioned.group(2)
            self.asset_cache_control = IMMUTABLE_CACHE
        elif BUILD_VERSION and route.startswith('/engine/'):
            # Unversioned addresses (the upstream runtime resolves a few modules
            # and the pipeline-cache seed from its own base path) redirect to the
            # current build so nothing unversioned is ever cached or mismatched.
            target = '/engine/v/' + BUILD_VERSION + route[len('/engine'):]
            query = urlsplit(self.path).query
            self.send_response(302)
            self.send_header('Location', (self.path[:self.path.index('/engine/')] if '/engine/' in self.path else '') + target + ('?' + query if query else ''))
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        try:
            if route == '/api/native/status' and NATIVE:
                return self.json(NATIVE.status())
            if route == '/api/setup':
                return self.json(SETUP.status())
            if route.startswith('/api/game') and not SETUP.ready:
                return self.json({'error': 'Choose and verify your Melee ISO first.'}, 409)
            if route.startswith('/api/announcer/'):
                slug = route.removeprefix('/api/announcer/')
                if slug not in CATALOG:
                    raise FileNotFoundError(slug)
                ident = 'web-v1-' + hashlib.sha256(slug.encode()).hexdigest()[:16]
                imported = ROOT / 'assets/characters' / ident / 'announcer.wav'
                return self.file(imported if imported.is_file() else descendant(CHARACTERS, slug + '/announcer.wav'))
            if route == '/api/imports':
                return self.json(list(IMPORTS.rows))
            if NATIVE and route == '/catalog.json':return self.file(ROOT/'web/public/catalog.json')
            if route.startswith('/api/imports/portraits/'):
                name=route.removeprefix('/api/imports/portraits/')
                if not re.fullmatch(r'import-[a-f0-9]{24}\.webp',name):raise FileNotFoundError(name)
                return self.file(descendant(IMPORTS.root,name))
            if route.startswith('/api/imports/'):
                job=IMPORTS.jobs.get(route.removeprefix('/api/imports/'))
                return self.json(dict(job)) if job else self.json({'error':'Import status is no longer available. Try importing the link again.'},404)
            if route == '/api/game':
                sizes = {p.relative_to(GAME).as_posix(): p.stat().st_size for p in GAME.rglob('*') if p.is_file()}
                return self.json({'verified': True, 'revision': 'USA 1.02',
                                  'files': list(sizes), 'sizes': sizes})
            if route.startswith('/api/game/'):
                return self.file(descendant(GAME, route[len('/api/game/'):]))
            if route.startswith('/api/character-select/'):
                name = route.removeprefix('/api/character-select/')
                if not re.fullmatch(r'[a-f0-9]{64}/[0-3]\.bin', name):
                    raise FileNotFoundError(name)
                return self.file(descendant(ROOT / 'build/character-select', name))
            if route.startswith('/api/costume/'):
                slug = route[len('/api/costume/'):]
                if slug not in CATALOG:
                    raise FileNotFoundError(slug)
                query = parse_qs(urlsplit(self.path).query)
                target = query.get('target',[CATALOG[slug]['target']])[0]
                if target not in BY_SLUG: raise ValueError('Unknown moveset')
                fighter, code = KINDS[target]
                ident = cache_id(slug,target,CATALOG[slug].get('original_target', CATALOG[slug]['target']))
                variant = ('browser-compact/' if query.get('compact') == ['1'] else 'browser/') if query.get('skin') == ['host'] else ''
                color = int(query.get('color', ['0'])[0])
                slots = BY_SLUG[target]['costumes']
                if not 0 <= color < len(slots): raise ValueError('Invalid color')
                filename = slots[color]['filename']
                return self.file(descendant(ROOT / 'build/characters', f'{ident}/{variant}{filename}'))
            if route == '/engine/sys-manifest.json':
                return self.json([p.relative_to(SYS).as_posix() for p in SYS.rglob('*') if p.is_file()])
            if route == '/engine/sys-bundle.bin':
                return self.file(BUILD / 'sys-bundle.bin')
            if route.startswith('/engine/sys/'):
                return self.file(descendant(SYS, route[len('/engine/sys/'):]))
            if route.startswith('/engine/upstream/'):
                name = route[len('/engine/upstream/'):]
                return self.file(descendant(upstream_root(name), name))
            if route.startswith('/engine/direct-c/'):
                name=route[len('/engine/direct-c/'):]
                if name.startswith('melee-'):
                    # Built artifacts: a developer build, else the hosted browser pack.
                    root=ROOT/'build/direct-c' if (ROOT/'build/direct-c'/name).is_file() else BUILD/'direct-c'
                else:root=ROOT/'runtime/direct-c/web'
                return self.file(descendant(root,name))
            if route.startswith('/engine/'):
                name = route[len('/engine/'):]
                root = BUILD if name.startswith('opensmash-web') else WEB
                return self.file(descendant(root, name))
            if DIST:
                return self.file(descendant(DIST, route.lstrip('/') or 'index.html'))
            self.send_error(404)
        except (ValueError, FileNotFoundError):
            self.send_error(404)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def local_ui_request(self):
        # Only same-origin local UI calls may start a converter process or change the roster.
        if TOKEN and self.headers.get('X-OpenSmash-Token') != TOKEN:
            return False
        origin = self.headers.get('Origin', '')
        return TOKEN or not origin or origin in (
            'http://127.0.0.1:5174', 'http://localhost:5174',
            f'http://127.0.0.1:{self.server.server_port}',
            f'http://localhost:{self.server.server_port}')

    def do_DELETE(self):
        if not self.local_ui_request():
            return self.send_error(403)
        slug = unquote(urlsplit(self.path).path).removeprefix('/api/imports/')
        if not self.path.startswith('/api/imports/') or not re.fullmatch(r'import-[a-f0-9]{24}', slug):
            return self.send_error(404)
        try:
            return self.json({'removed': IMPORTS.remove(slug)})
        except ValueError as error:
            return self.json({'error': str(error)}, 409)

    def do_POST(self):
        if not self.local_ui_request():
            return self.send_error(403)
        if self.path == '/api/setup/clear':
            try:
                if NATIVE:
                    NATIVE.stop()
                return self.json(SETUP.clear())
            except (ValueError, OSError) as error:
                return self.json({'error': str(error)}, 409)
        if self.path.startswith('/api/native/') and NATIVE:
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536:raise ValueError('Invalid request size')
                body=json.loads(self.rfile.read(length))
                if self.path=='/api/native/begin':return self.json(NATIVE.begin(body.get('session')))
                if self.path=='/api/native/preflight':return self.json(NATIVE.preflight(body))
                if self.path=='/api/native/launch':return self.json(NATIVE.launch(body))
                if self.path=='/api/native/shutdown':
                    SETUP.cancel()
                    return self.json(NATIVE.stop())
                if self.path=='/api/native/stop':return self.json(NATIVE.stop(body.get('session')))
                if self.path=='/api/native/disc':
                    path=Path(body['path']).expanduser().resolve()
                    if not path.is_file():raise ValueError('Disc file is unavailable')
                    def receive_disc():
                        try:
                            SETUP.receive_path(path)
                        except Exception as error:SETUP.progress('error',str(error))
                    threading.Thread(target=receive_disc,daemon=True).start()
                    return self.json({'accepted':True},202)
                return self.send_error(404)
            except (ValueError,KeyError,TypeError,OSError) as error:return self.json({'error':str(error)},400)
        if self.path == '/api/setup/disc':
            try:
                self.connection.settimeout(60)
                if self.headers.get_content_type() != 'application/octet-stream':
                    raise ValueError('Choose an ISO or GCM file.')
                SETUP.receive(self.rfile, int(self.headers.get('Content-Length', '0')))
                return self.json(SETUP.status(), 202)
            except (ValueError, OSError) as error:
                self.close_connection = True
                try:
                    return self.json({'error': str(error)}, 400)
                except (BrokenPipeError, ConnectionResetError):
                    return
        if (self.path == '/api/imports' or self.path.startswith('/api/prepare/')) and not SETUP.ready:
            return self.json({'error': 'Choose and verify your Melee ISO first.'}, 409)
        if self.path == '/api/character-select':
            if not SETUP.ready:
                return self.json({'error': 'Choose and verify your Melee ISO first.'}, 409)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 16384:
                    raise ValueError('Invalid lineup request')
                body = json.loads(self.rfile.read(length))
                from opensmash_melee.character_select import catalog_identities, character_select_assets
                entries = catalog_identities(ROOT, CATALOG, body.get('costumes'))
                with LOCK:
                    assets = character_select_assets(GAME, entries, cache=ROOT / 'build/announcer-cache')
                    key = hashlib.sha256(b''.join(assets.values())).hexdigest()
                    folder = ROOT / 'build/character-select' / key
                    folder.mkdir(parents=True, exist_ok=True)
                    result = []
                    for index, (name, data) in enumerate(assets.items()):
                        path = folder / f'{index}.bin'
                        if not path.exists(): atomic_write(path, data)
                        result.append({'filename': name, 'url': f'/api/character-select/{key}/{index}.bin'})
                return self.json({'assets': result})
            except (ValueError, TypeError, AttributeError, OSError) as error:
                return self.json({'error': str(error)}, 400)
        if self.path == '/api/imports':
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=16384 or self.headers.get_content_type()!='application/json':
                    return self.json({'error':'Send a character import URL as JSON.'},400)
                body=json.loads(self.rfile.read(length))
                return self.json(IMPORTS.start(body.get('url'),body.get('target','mario')),202)
            except (ValueError,TypeError,AttributeError):
                return self.json({'error':str(sys.exc_info()[1])},400)
        if self.path == '/api/debug':
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length < 65536:
                return self.send_error(400)
            entry = json.loads(self.rfile.read(length))
            trace = ROOT / 'build/moderngekko-validation/browser-trace.jsonl'
            trace.parent.mkdir(parents=True, exist_ok=True)
            with LOCK, trace.open('a') as stream:
                stream.write(json.dumps(entry) + '\n')
            return self.json({'ok': True})
        slug = unquote(urlsplit(self.path).path).removeprefix('/api/prepare/')
        if not self.path.startswith('/api/prepare/') or slug not in CATALOG:
            return self.send_error(404)
        query = parse_qs(urlsplit(self.path).query)
        try: color = int(query.get('color', ['0'])[0])
        except ValueError: return self.send_error(400)
        row = CATALOG[slug]
        target = query.get('target',[row['target']])[0]
        if target not in BY_SLUG: return self.json({'error':'Unknown moveset'},400)
        fighter, code = KINDS[target]
        slots = BY_SLUG[target]['costumes']
        if not 0 <= color < len(slots): return self.send_error(400)
        ident = cache_id(slug,target,row.get('original_target', row['target']))
        output = ROOT / 'build/characters' / ident
        with preparation_lock(ident), PREPARATION_SLOTS:
            if not (output / f'Pl{code}Nr.dat').is_file():
                source = CHARACTERS / slug
                if row.get('imported'): source = ROOT/'assets/characters'/cache_id(slug,row['target'],row['target'])
                if not (source / 'rigged.glb').is_file():
                    return self.json({'error':'Character source is missing. Reinstall the character library or import the character again.'},422)
                try:
                    source=archive_previous_build(ROOT,ident,source)
                    run_stage(['tools/build_character.py',str(source),'--id',ident,'--target',target,
                               *(['--prepare-web'] if query.get('skin') == ['host'] else []),
                               *(['--compact'] if query.get('compact') == ['1'] else [])],
                              ROOT,ROOT/'build/character-imports'/(ident+'.log'),'Fitting character',target)
                except (ValueError,OSError) as error:
                    return self.json({'error':str(error)},422)
            from tools.upgrade_character_surfaces import upgrade
            try:
                upgrade(ident, CHARACTERS / slug)
            except Exception as error:
                log=ROOT/'build/character-imports'/(ident+'.log')
                log.parent.mkdir(parents=True,exist_ok=True)
                with log.open('a',encoding='utf-8') as stream:stream.write(f'\n[Preparing textures and artwork: {target}]\n{error}\n')
                return self.json({'error':f'Preparing textures and artwork for {target} failed. Retry; if this repeats, share the diagnostic log: {log}'},422)
            host_skin = parse_qs(urlsplit(self.path).query).get('skin') == ['host']
            compact = host_skin and query.get('compact') == ['1']
            skin_folder = 'browser-compact' if compact else 'browser'
            if host_skin:
                stats_path = output / skin_folder / 'stats.json'
                stats = json.loads(stats_path.read_text()) if stats_path.is_file() else {}
                from opensmash_melee.costume_memory import VERSION as MEMORY_VERSION
                from opensmash_melee.costume_forms import forms_current
                profile = json.loads((output / 'profile.json').read_text())
                if not (output / skin_folder / f'Pl{code}Nr.dat').is_file() or stats.get('texture_slot_version') != 1 or stats.get('memory_layout_version') != MEMORY_VERSION or not forms_current(stats, profile):
                    try:
                        run_stage(['tools/build_browser_skin_costume.py',ident,*(['--compact'] if compact else [])],
                                  ROOT,ROOT/'build/character-imports'/(ident+'.log'),'Building playable costume',target)
                    except ValueError as error:
                        return self.json({'error':str(error)},422)
            filename = slots[color]['filename']
            # Refresh existing caches too; a material fix must reach previously
            # selected fighters without forcing another mesh conversion.
            folder = output / skin_folder if host_skin else output
            base = folder / slots[0]['filename']
            old = base.read_bytes()
            lit = upgrade_cached_lighting(old)
            if lit != old:
                atomic_write(base, lit)
                metadata = base.with_suffix(base.suffix + '.json')
                if metadata.is_file():
                    info = json.loads(metadata.read_text())
                    info.update(output_sha256=hashlib.sha256(lit).hexdigest(),
                                output_bytes=len(lit), lighting='melee-diffuse-replace-v2')
                    atomic_write(metadata, (json.dumps(info, indent=2) + '\n').encode())
            if color:
                folder = output / skin_folder if host_skin else output
                raw = costume_variant((folder / slots[0]['filename']).read_bytes(), fighter, color, target)
                (folder / filename).write_bytes(raw)
        self.json({'fighter': fighter, 'filename': filename, 'url': f'/api/costume/{slug}?target={target}&color={color}' + ('&skin=host' if host_skin else '') + ('&compact=1' if compact else '')})

    def log_message(self, fmt, *args):
        if self.command == 'POST' or (args and str(args[1]) not in ('200', '206')):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--desktop', action='store_true')
    parser.add_argument('--upstream', action='store_true', help='Serve the pinned Melee PC browser backend')
    parser.add_argument('--direct-c', action='store_true', help='Serve the direct-C backend without Dolphin system assets')
    parser.add_argument('--iso', type=Path, help='Optional existing ISO; otherwise choose a disc in the web boot screen')
    parser.add_argument('--port', type=int, default=8781)
    parser.add_argument('--characters', type=Path, default=CHARACTERS, help='Exported character library (one directory per roster slug)')
    parser.add_argument('--import-origin', action='append', default=[], help='Additional exact source-export origin for local development')
    parser.add_argument('--trace-io', action='store_true', help='Record local asset request timings for startup profiling')
    args = parser.parse_args()
    startup_started = time.monotonic()
    def startup_log(message):
        if args.desktop:
            print(f'[startup {time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} '
                  f'+{time.monotonic() - startup_started:.3f}s] {message}',
                  file=sys.stderr, flush=True)
    startup_log('Initializing game setup')
    TRACE_IO = args.trace_io
    CHARACTERS = args.characters.expanduser().resolve()
    from opensmash_melee.web_game import GameSetup
    SETUP = GameSetup(ROOT)
    if args.iso:
        SETUP.use_existing(args.iso)
    else:
        threading.Thread(target=SETUP.restore, daemon=True).start()
    if not args.desktop and not args.direct_c and not args.upstream:
        from pack_browser_sys import pack
        pack(SYS, BUILD / 'sys-bundle.bin')
    startup_log('Loading character import service')
    from opensmash_melee.character_import import ImportManager
    IMPORTS=ImportManager(CATALOG,LOCK,['https://smash.fun','https://www.smash.fun',*args.import_origin])
    startup_log('Character import service ready')
    if args.desktop:
        if not TOKEN:raise SystemExit('Desktop service requires its session token')
        startup_log('Loading native service')
        from opensmash_melee.native_service import NativeService
        NATIVE=NativeService(ROOT,CATALOG,SETUP,os.environ['OPENSMASH_RUNTIME'],startup_log=startup_log)
    startup_log('Binding localhost HTTP server')
    server=ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    startup_log(f'Localhost HTTP server ready on port {server.server_port}')
    suffix='/?engine=upstream' if args.upstream else '/?engine=direct-c' if args.direct_c else ''
    print(f'Local game setup and asset server: http://127.0.0.1:{server.server_port}{suffix}', flush=True)
    if args.desktop:print(json.dumps({'port':server.server_port,'protocol':1}),flush=True)
    try:server.serve_forever()
    finally:
        if NATIVE:NATIVE.stop()
