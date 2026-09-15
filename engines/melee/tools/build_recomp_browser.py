"""Cross-build the pinned, patched ModernGekko runtime with Emscripten."""
import argparse
import hashlib
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess

from prepare_moderngekko import CHECKOUT, ROOT
from specialize_browser_math import specialize, specialize_scaled, containing_chunk
from specialize_browser_entries import specialize_entries
from chain_browser_chunks import chain_chunks

SOURCE = ROOT / 'build/browser-engine/moderngekko-web'
BUILD = ROOT / 'build/moderngekko-wasm'
EMSDK = Path(os.environ.get('MELEE_EMSDK', ROOT.parents[2] / 'emsdk')).expanduser().resolve()


def write_build_identity(dev_link=False, output=None):
    output = output or BUILD
    wasm = output / 'opensmash-web.wasm'
    with wasm.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    runtime_digest = hashlib.sha256(bytes.fromhex(digest))
    for source in sorted(output.glob('opensmash-web*.js')):
        runtime_digest.update(source.name.encode())
        runtime_digest.update(source.read_bytes())
    (output / 'opensmash-web-build.json').write_text(json.dumps({
        'id': digest[:16], 'wasmSha256': digest, 'wasmBytes': wasm.stat().st_size,
        'cacheId': runtime_digest.hexdigest()[:24],
        'chunkInstructions': 256, 'hotLto': False,
        'regionChaining': json.loads((ROOT / 'build/browser-engine/melee-wasm-code/generated/opensmash_chain.json').read_text()),
        'linkOptimization': 'O1' if dev_link else 'O3',
        'patchSha256': hashlib.sha256((ROOT / 'runtime/patches/browser/0001-emscripten-runtime.patch').read_bytes()).hexdigest(),
        'patches': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted((ROOT / 'runtime/patches/browser').glob('*.patch'))},
    }, indent=2) + '\n')
    # Serve a compact transfer while preserving the exact compiled bytes and
    # build identity. Do this at build time, never during a user's first launch.
    for source in output.glob('opensmash-web*'):
        if source.suffix not in ('.wasm', '.js'):
            continue
        temporary = source.with_name(source.name + '.gz.tmp')
        with source.open('rb') as src, temporary.open('wb') as dest:
            with gzip.GzipFile(filename='', mode='wb', fileobj=dest, compresslevel=6, mtime=0) as packed:
                shutil.copyfileobj(src, packed)
        temporary.replace(source.with_name(source.name + '.gz'))


def build(configure_only=False, target='opensmash-web', dev_link=False):
    output = BUILD
    original = CHECKOUT / 'ref/ModernGekko'
    if not SOURCE.exists():
        if not (original / 'vendor/dolphin/Source/Core/Core/PowerPC/StaticRecomp').is_dir():
            raise ValueError('Run prepare_moderngekko.py first')
        def ignore(directory, names):
            # Externals such as zstd keep their *source* CMake files in build/.
            return [name for name in names if name == '.git' or
                    (Path(directory) == original and name.startswith('build'))]
        shutil.copytree(original, SOURCE, ignore=ignore)
    # Anchor git apply here; otherwise git discovers the parent project and can
    # silently skip every patch path as outside the current directory.
    if not (SOURCE / '.git').exists():
        subprocess.run(['git', 'init', '--quiet', str(SOURCE)], check=True)
    for patch in sorted((ROOT / 'runtime/patches/browser').glob('*.patch')):
        reverse = subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)],
                                 cwd=SOURCE, capture_output=True)
        if reverse.returncode:
            subprocess.run(['git', 'apply', '--check', str(patch)], cwd=SOURCE, check=True)
            subprocess.run(['git', 'apply', str(patch)], cwd=SOURCE, check=True)
    env = os.environ.copy()
    env['EM_CONFIG'] = str(EMSDK / '.emscripten')
    options = dict(CMAKE_BUILD_TYPE='Release', EMSCRIPTEN_SYSTEM_PROCESSOR='wasm32', ENABLE_GENERIC='ON', USE_SYSTEM_LIBS='OFF',
                   ENABLE_VULKAN='OFF', ENABLE_QT='OFF', ENABLE_TESTS='OFF', BUILD_TESTING='OFF',
                   ENABLE_X11='OFF', ENABLE_WAYLAND='OFF', ENABLE_EGL='OFF', ENABLE_ALSA='OFF',
                   ENABLE_PULSEAUDIO='OFF', ENABLE_OPENAL='OFF',
                   MODERNGEKKO_ENABLE_DYNAMIC_MODULES='OFF',
                   CMAKE_C_FLAGS='-pthread',
                   CMAKE_CXX_FLAGS='-pthread')
    # Smaller recompiler regions avoid LLVM's pathological irreducible-CFG pass
    # on a 4096-instruction native chunk. This changes host code partitioning only.
    generated = ROOT / 'build/browser-engine/melee-wasm-code/generated'
    if not (generated / 'generated.h').exists():
        game_env = env | {'DOLRECOMP_C_CHUNK_INSTRUCTIONS': '256'}
        subprocess.run([str(original / 'build-desktop-tools-meleepad/dolrecomp'),
                        '--gamecube', '--cpu', 'gekko', '-j8',
                        str(ROOT / 'assets/game/sys/main.dol'), str(generated.parent)],
                       env=game_env, check=True)
    shutil.copy2(ROOT / 'assets/game/sys/main.dol', generated / 'main.dol')
    specialize(generated)
    specialize_scaled(generated)
    specialize_entries(generated)
    chain_chunks(generated)
    hot_addresses = [0x80341140, 0x80342204, 0x80379A20, 0x8037A54C]
    options.update(OPENSMASH_WASM_LINK_OPT='-O1' if dev_link else '-O3',
                   OPENSMASH_BROWSER_FRONTEND=str(ROOT / 'runtime/web'),
                   OPENSMASH_WEB_OUTPUT_DIRECTORY=str(output),
                   OPENSMASH_RECOMPILED_GAME=str(generated),
                   OPENSMASH_HOT_GAME_CHUNKS=';'.join(str(containing_chunk(generated, address)) for address in hot_addresses))
    subprocess.run([str(EMSDK / 'upstream/emscripten/emcmake'), 'cmake', '-S', str(SOURCE),
                    '-B', str(BUILD), '-G', 'Ninja',
                    *[f'-D{key}={value}' for key, value in options.items()]], env=env, check=True)
    if not configure_only:
        subprocess.run(['cmake', '--build', str(BUILD), '--target', target, '-j8'], env=env, check=True)
        if target == 'opensmash-web':
            write_build_identity(dev_link, output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configure-only', action='store_true')
    parser.add_argument('--target', default='opensmash-web')
    parser.add_argument('--dev-link', action='store_true', help='Fast development link; use default optimized build for FPS validation')
    args = parser.parse_args()
    build(args.configure_only, args.target, args.dev_link)
