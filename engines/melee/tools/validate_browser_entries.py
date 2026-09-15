"""Differential-test the actual browser game archive against retained originals."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import subprocess

from build_recomp_browser import BUILD, EMSDK, ROOT, SOURCE, build
from specialize_browser_math import GENERATED


def validate(skip_build=False):
    if not skip_build:
        build(target='opensmash-game')
    build(target='opensmash-game-reference')
    output = ROOT / 'build/moderngekko-validation'
    output.mkdir(parents=True, exist_ok=True)
    archive = BUILD / 'libopensmash-game.a'
    reference = BUILD / 'libopensmash-game-reference.a'
    executable = output / 'browser-entries-test.js'
    gx = SOURCE / 'vendor/dolphin/GXRuntime'
    command = [str(EMSDK / 'upstream/emscripten/emcc'), '-O3', '-pthread',
               '-ffp-contract=off', '-fno-fast-math',
               '-I' + str(GENERATED), '-I' + str(gx / 'include'),
               str(ROOT / 'tests/browser_entries.c'), str(archive), str(reference),
               '-sENVIRONMENT=node', '-sSTACK_SIZE=2097152', '-sINITIAL_MEMORY=134217728', '-o', str(executable)]
    subprocess.run(command, env=os.environ | {'EM_CONFIG': str(EMSDK / '.emscripten')},
                   check=True)
    specialization = json.loads((GENERATED / 'opensmash_entries.json').read_text())
    regions = specialization['regions'] + specialization.get('deferredRegions', 0)
    workers = min(8, regions)
    def check_shard(index):
        first, end = regions * index // workers, regions * (index + 1) // workers
        result = subprocess.run(['node', str(executable), str(first), str(end)],
                                capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f'Entry regions {first}:{end} failed:\n{result.stderr}\n{result.stdout}')
        data = json.loads(result.stdout)
        if data['cases'] != (end - first) * 256 * 14:
            raise RuntimeError(f'Incomplete entry coverage in regions {first}:{end}')
        return data
    with ThreadPoolExecutor(max_workers=workers) as pool:
        reports = list(pool.map(check_shard, range(workers)))
    report = reports[0] | {'cases': sum(r['cases'] for r in reports), 'shards': workers}
    if not all(r['fullCpu'] and r['ramAndExram'] and r['callbackStateAndOrder'] for r in reports):
        raise RuntimeError('Missing comparison coverage')
    with archive.open('rb') as stream:
        report['archiveSha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    report['specialization'] = specialization
    text = json.dumps(report, indent=2) + '\n'
    (output / 'browser-entries-wasm.json').write_text(text)
    print(text, end='')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true',
                        help='Test the existing archive without reconfiguring or rebuilding')
    validate(parser.parse_args().skip_build)
