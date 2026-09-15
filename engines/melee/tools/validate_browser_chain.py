"""Differential-test region chaining in the actual browser game archive.

Each case runs one chained dispatch and, from an identical state, the sequence
of single-region dispatches the run loop would perform under the same
continuation rule. Guest CPU state, RAM, EXRAM and the memory/fallback callback
trace must match exactly.
"""
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
    output = ROOT / 'build/moderngekko-validation'
    output.mkdir(parents=True, exist_ok=True)
    archive = BUILD / 'libopensmash-game.a'
    executable = output / 'browser-chain-test.js'
    gx = SOURCE / 'vendor/dolphin/GXRuntime'
    command = [str(EMSDK / 'upstream/emscripten/emcc'), '-O3', '-pthread',
               '-ffp-contract=off', '-fno-fast-math',
               '-I' + str(GENERATED), '-I' + str(gx / 'include'),
               str(ROOT / 'tests/browser_chain.c'), str(archive),
               '-sENVIRONMENT=node', '-sSTACK_SIZE=2097152', '-sINITIAL_MEMORY=134217728', '-o', str(executable)]
    subprocess.run(command, env=os.environ | {'EM_CONFIG': str(EMSDK / '.emscripten')},
                   check=True)
    chaining = json.loads((GENERATED / 'opensmash_chain.json').read_text())
    regions = chaining['regions']
    workers = min(8, regions)
    def check_shard(index):
        first, end = regions * index // workers, regions * (index + 1) // workers
        result = subprocess.run(['node', str(executable), str(first), str(end)],
                                capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f'Chain regions {first}:{end} failed:\n{result.stderr}\n{result.stdout}')
        data = json.loads(result.stdout)
        if data.get('timebaseCases') != 48:
            raise RuntimeError('Missing timebase regression coverage')
        if data['cases'] != (end - first) * 4 * 6:
            raise RuntimeError(f'Incomplete chain coverage in regions {first}:{end}')
        return data
    with ThreadPoolExecutor(max_workers=workers) as pool:
        reports = list(pool.map(check_shard, range(workers)))
    report = {'timebaseCasesPerShard': 48, 'cases': sum(r['cases'] for r in reports),
              'chainedCases': sum(r['chainedCases'] for r in reports),
              'longestChain': max(r['longestChain'] for r in reports), 'shards': workers}
    if report['chainedCases'] == 0:
        raise RuntimeError('No case exercised a chained transfer')
    with archive.open('rb') as stream:
        report['archiveSha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    report['chaining'] = chaining
    text = json.dumps(report, indent=2) + '\n'
    (output / 'browser-chain-wasm.json').write_text(text)
    print(text, end='')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true',
                        help='Test the existing archive without reconfiguring or rebuilding')
    validate(parser.parse_args().skip_build)
