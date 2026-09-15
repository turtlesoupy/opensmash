#!/usr/bin/env python3
"""Build the pinned Melee PC fork and the launcher's standalone audio consumer."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ENGINE = Path(__file__).resolve().parents[1]
REPOSITORY = ENGINE.parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--jobs', type=int, default=6)
args = parser.parse_args()
pin = json.loads((ENGINE / 'upstream.json').read_text())
checkout = Path(os.environ.get('MELEE_PC_ROOT', REPOSITORY.parent / 'melee-pc'))

def run(command, cwd=checkout):
    subprocess.run([str(value) for value in command], cwd=cwd, check=True)

if not (checkout / '.git').exists():
    if checkout.exists():
        raise SystemExit(f'{checkout} exists but is not a Git checkout.')
    run(['git', 'clone', '--no-checkout', pin['repository'], checkout], REPOSITORY)
    run(['git', 'checkout', '--detach', pin['revision']])
    run(['git', 'remote', 'add', 'upstream', pin['upstreamRepository']])
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip()
if head != pin['revision']:
    raise SystemExit(f'Engine checkout is {head}; expected {pin["revision"]}. '
                     'Use a separate MELEE_PC_ROOT checkout for this pin, or update the clean checkout explicitly.')
dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=checkout, text=True).strip()
if dirty:
    raise SystemExit('The pinned engine checkout has uncommitted files. Commit or isolate engine development before building this pin.')
sdk = Path(os.environ.get('MELEE_EMSDK', checkout / 'build/browser/emsdk'))
if not (sdk / 'upstream/emscripten/emcc').exists():
    run([sys.executable, 'tools/browser/setup_sdk.py'])
run([sys.executable, 'tools/browser/build.py', '--jobs', args.jobs])

# The shared Sonic consumer is independent of the former game backend.
port = ENGINE / 'runtime/direct-c'
out = ENGINE / 'build/direct-c/melee-audio.wasm'
out.parent.mkdir(parents=True, exist_ok=True)
exports = ['_audio_' + name for name in ['create', 'input', 'output', 'speed', 'write', 'read', 'available']]
run([sdk / 'upstream/emscripten/emcc', port / 'audio/playback.c', port / 'vendor/sonic/sonic.c',
     '-I' + str(port / 'vendor/sonic'), '-O2', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
     '-sINITIAL_MEMORY=2097152', '-sSTACK_SIZE=65536', '-sALLOW_MEMORY_GROWTH=0',
     '-sMALLOC=emmalloc', '-sABORTING_MALLOC=0', '--no-entry',
     '-sEXPORTED_FUNCTIONS=' + json.dumps(exports), '-o', out])
print(f'Built upstream engine {head} at {checkout}')
