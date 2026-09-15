"""Compile the unmodified PPC routine and its specialization into one oracle."""
import argparse,json,os,subprocess
from pathlib import Path
from specialize_browser_math import specialize,specialize_scaled,ROOT,GENERATED

def validate(wasm=False, scaled=False):
    specialize();specialize_scaled()
    gx=ROOT/'build/browser-engine/moderngekko-web/vendor/dolphin/GXRuntime'
    out=ROOT/'build/moderngekko-validation'
    emsdk=Path(os.environ.get('MELEE_EMSDK', ROOT.parents[2]/'emsdk')).expanduser().resolve()
    env=os.environ|{'EM_CONFIG':str(emsdk/'.emscripten')}
    executable=out/('browser-math-test.js' if wasm else 'native-math-test')
    cmd=[str(emsdk/'upstream/emscripten/emcc') if wasm else 'clang','-O2','-ffp-contract=off','-fno-fast-math',
         '-DDOLRECOMP_CPU_HEADER="core/cpu.h"','-I'+str(GENERATED),'-I'+str(gx/'include'),
         str(ROOT/'tests/browser_math.c'),*[str(gx/'src/core'/name) for name in
         ['cpu.c','cpu_exception.c','cpu_interpreter.c','cpu_interpreter_table.c','cpu_interpreter_float.c','cpu_interpreter_integer.c']],
         '-o',str(executable)]
    if scaled:cmd += ['-DTEST_SCALED=1','-flto']
    if wasm:cmd += ['-sENVIRONMENT=node','-sINITIAL_MEMORY=134217728']
    subprocess.run(cmd,check=True,env=env)
    result=subprocess.run(['node',str(executable)] if wasm else [str(executable)],capture_output=True,text=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    print(('scaled: ' if scaled else 'concat: ')+result.stdout,end='')
    (out/(('browser-scaled-' if scaled else 'browser-math-')+('wasm.json' if wasm else 'native.json'))).write_text(result.stdout)
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--wasm',action='store_true')
    parser.add_argument('--scaled',action='store_true');args=parser.parse_args()
    validate(args.wasm,args.scaled)
