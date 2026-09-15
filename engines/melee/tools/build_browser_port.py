"""Build the first real-engine Wasm module, with no unresolved-symbol stubs."""
import hashlib, json, os, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get('MELEE_EMSDK', ROOT.parents[2]/'emsdk'))
CLANG = SDK/'upstream/bin/clang'
OUT = ROOT/'build/browser-port/runtime'
SOURCES = ['src/sysdolphin/baselib/fobj.c', 'src/sysdolphin/baselib/aobj.c',
           'src/sysdolphin/baselib/spline.c', 'src/sysdolphin/baselib/mtx.c', 'src/melee/ft/ftcommon.c']
EXPORTS = ['port_input','port_bind','port_pose','port_begin','port_add_track','port_seek',
           'port_step','port_frame','port_error','port_fall','port_ground_friction','port_srt_input','port_srt']

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    flags = ['--target=wasm32-unknown-emscripten','-std=c99','-nostdinc','-fno-builtin',
             '-fno-strict-aliasing','-ffp-contract=off','-ffunction-sections','-fdata-sections',
             '-DLINT','-I'+str(ROOT/'browser-port/include'),'-Isrc','-isystemsrc/MSL',
             '-isystemextern/dolphin/include','-isystemextern/dolphin/src',
             '-Wno-typedef-redefinition','-O2']
    files = [ROOT/'melee'/s for s in SOURCES] + [ROOT/'browser-port/src/animation_bridge.c']
    objects = []
    for src in files:
        obj = OUT/(src.stem+'.o'); objects.append(obj)
        subprocess.run([str(CLANG),*flags,'-c',str(src),'-o',str(obj)],cwd=ROOT/'melee',check=True)
    wasm = OUT/'melee-animation.wasm'
    env=dict(os.environ,EM_CONFIG=str(SDK/'.emscripten'))
    subprocess.run([str(SDK/'upstream/emscripten/emcc'),*[str(o) for o in objects],
                    '--no-entry','-O2','-sSTANDALONE_WASM=1','-sFILESYSTEM=0',
                    '-sINITIAL_MEMORY=4194304','-sMAXIMUM_MEMORY=4194304',
                    '-sEXPORTED_FUNCTIONS='+json.dumps(['_'+s for s in EXPORTS]),
                    '-o',str(wasm)],env=env,check=True)
    report = dict(scope='original HSD animation interpreter and two shared fighter physics functions; not a match runtime',
                  wasm_sha256=hashlib.sha256(wasm.read_bytes()).hexdigest(), bytes=wasm.stat().st_size,
                  upstream=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT/'melee',text=True).strip(),
                  sources={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, exports=EXPORTS)
    (OUT/'build.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__': main()
