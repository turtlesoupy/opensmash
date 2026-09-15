"""Bounded guest-memory validation for the shared native/browser intro routing."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include'


class VsIntroTest(unittest.TestCase):
    @unittest.skipUnless((INCLUDE / 'moderngekko/mod_abi.h').exists(), 'Requires runtime headers')
    def test_scene_detour(self):
        compiler = shutil.which('clang') or shutil.which('cc')
        if not compiler:
            self.skipTest('Requires C compiler')
        with tempfile.TemporaryDirectory() as tmp:
            executable = Path(tmp) / 'vs-intro-test'
            subprocess.run([compiler, '-std=c11', '-D_POSIX_C_SOURCE=200809L', '-I', str(INCLUDE),
                            str(ROOT / 'tests/vs_intro_runtime.c'), '-lm', '-o', str(executable)], check=True)
            subprocess.run([str(executable)], check=True)


if __name__ == '__main__':
    unittest.main()
