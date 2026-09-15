"""Compare PPC FMA CPU state against the pinned unmodified implementation."""
import os,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
gx=ROOT/'build/browser-engine/moderngekko-web/vendor/dolphin/GXRuntime'
original=ROOT/'build/browser-engine/meleepad/ref/ModernGekko/vendor/dolphin/GXRuntime/src/core/cpu_interpreter_float.c'
out=ROOT/'build/moderngekko-validation'
emsdk=Path(os.environ.get('MELEE_EMSDK', ROOT.parents[2]/'emsdk')).expanduser().resolve()
env=os.environ|{'EM_CONFIG':str(emsdk/'.emscripten')}
cc=[str(emsdk/'upstream/emscripten/emcc'),'-O2','-ffp-contract=off','-fno-fast-math','-I'+str(gx/'include')]
symbols=re.findall(r'^(?:GXRUNTIME_ALWAYS_INLINE )?(?:void|bool|f64|f32|FPRes|u32|int|unsigned) (\w+)\(',original.read_text(),re.M)
subprocess.run([*cc,*['-D'+s+'=reference_'+s for s in symbols],'-c',str(original),'-o',str(out/'fma-oracle.o')],env=env,check=True)
subprocess.run([*cc,str(ROOT/'tests/browser_fma.c'),str(out/'fma-oracle.o'),
 *[str(gx/'src/core'/name) for name in ['cpu.c','cpu_exception.c','cpu_interpreter.c','cpu_interpreter_table.c','cpu_interpreter_float.c','cpu_interpreter_integer.c']],
 '-sENVIRONMENT=node','-o',str(out/'fma-test.js')],env=env,check=True)
r=subprocess.run(['node',str(out/'fma-test.js')],capture_output=True,text=True,check=True)
print(r.stdout,end='');(out/'browser-fma-wasm.json').write_text(r.stdout)
