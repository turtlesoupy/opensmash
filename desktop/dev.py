"""Build the shared frontend and launch the unified native shell.

Requires Melee native payloads prepared in engines/melee/build.
"""
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
    npm='npm.cmd' if os.name=='nt' else 'npm'
    subprocess.run([npm,'--prefix',str(ROOT/'web-prototype'),'run','build'],cwd=ROOT,check=True)
    subprocess.run([sys.executable,str(ROOT/'engines/melee/tools/dev_desktop.py')],cwd=ROOT/'engines/melee',check=True,
                   env={**os.environ,'OPENSMASH_SHARED_LAUNCHER':'1'})
