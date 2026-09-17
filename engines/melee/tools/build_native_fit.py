"""Build the native fitting experiment; contains no generated/game assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[1]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--emsdk',type=Path,default=os.environ.get('MELEE_EMSDK'))
    p.add_argument('--output',type=Path,default=ROOT/'build/native-fit')
    p.add_argument('--native',action='store_true',help='Also build a host library for offline Python oracle tests')
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    compiler=str(a.emsdk/'upstream/emscripten/em++') if a.emsdk else shutil.which('em++')
    if not compiler:p.error('Set MELEE_EMSDK or put em++ on PATH')
    source=ROOT/'runtime/fitting';files=[source/'round_fit.cpp',source/'humanoid_fit.cpp']
    common=[*[str(f) for f in files],'-std=c++17','-O3','-ffp-contract=off']
    subprocess.run([compiler,*common,'--no-entry','-s','MODULARIZE=1','-s','EXPORT_ES6=1',
                    '-s','ENVIRONMENT=web,worker','-s','ALLOW_MEMORY_GROWTH=1','-s','DISABLE_EXCEPTION_CATCHING=0',
                    '-s','EXPORTED_FUNCTIONS=["_fit_round","_fit_humanoid","_malloc","_free"]',
                    '-o',str(a.output/'fit.mjs')],check=True,timeout=120)
    if a.native:
        system=platform.system()
        if system not in ('Darwin','Linux'):p.error('Native oracle library is supported on macOS/Linux')
        shared=['-dynamiclib'] if system=='Darwin' else ['-shared','-fPIC']
        subprocess.run([os.environ.get('CXX','clang++'),*common,*shared,'-o',str(a.output/('fit.dylib' if system=='Darwin' else 'fit.so'))],check=True,timeout=120)
    shutil.copy2(source/'SCIPY-LICENSE.txt',a.output/'SCIPY-LICENSE.txt')
    manifest={'compiler':subprocess.check_output([compiler,'--version'],text=True).splitlines()[0],
              'sources':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(source.iterdir()) if f.is_file()},
              'wasmSha256':hashlib.sha256((a.output/'fit.wasm').read_bytes()).hexdigest()}
    (a.output/'build.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest))


if __name__=='__main__':main()
