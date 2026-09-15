"""Exercise production suspension flags and bootstrap with real Wasm pthreads."""
import os
import re
import subprocess

from build_recomp_browser import EMSDK, ROOT


def main():
    output = ROOT / 'build/moderngekko-validation/browser-gpu-event-loop.js'
    output.parent.mkdir(parents=True, exist_ok=True)
    cmake = (ROOT / 'runtime/web/CMakeLists.txt').read_text()
    flags = re.findall(r'-sASYNCIFY(?:_[A-Z_]+)?=(?:\[[^\]]*\]|\d+)', cmake)
    if not flags:
        raise ValueError('The browser runtime has no suspension configuration')
    command = [str(EMSDK / 'upstream/emscripten/em++'), '-O2', '-std=c++20',
               '-pthread', '-sPROXY_TO_PTHREAD=1', '-sPTHREAD_POOL_SIZE=3',
               '-sENVIRONMENT=node', '-sEXIT_RUNTIME=1', *flags,
               '--pre-js', str(ROOT / 'runtime/web/register_canvas.js'),
               '--js-library', str(ROOT / 'runtime/web/synchronous-filesystem.js'),
               str(ROOT / 'tests/browser_gpu_event_loop.cpp'), '-o', str(output)]
    subprocess.run(command, env=os.environ | {'EM_CONFIG': str(EMSDK / '.emscripten')},
                   check=True)
    subprocess.run(['node', str(output)], check=True, timeout=30)


if __name__ == '__main__':
    main()
