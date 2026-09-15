"""Exercise the prepared browser BlockingLoop with real Wasm pthreads."""
import os
import subprocess

from build_recomp_browser import EMSDK, ROOT, SOURCE


def main():
    output = ROOT / 'build/moderngekko-validation/browser-gpu-wakeup.js'
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [str(EMSDK / 'upstream/emscripten/em++'), '-O2', '-std=c++20',
               '-pthread', '-sPROXY_TO_PTHREAD=1', '-sPTHREAD_POOL_SIZE=4',
               '-sENVIRONMENT=node', '-sEXIT_RUNTIME=1',
               '-I' + str(SOURCE / 'vendor/dolphin/Source/Core'),
               str(ROOT / 'tests/browser_gpu_wakeup.cpp'), '-o', str(output)]
    subprocess.run(command, env=os.environ | {'EM_CONFIG': str(EMSDK / '.emscripten')},
                   check=True)
    subprocess.run(['node', str(output)], check=True, timeout=60)


if __name__ == '__main__':
    main()
