"""Refresh shared launcher code and run desktop without freezing or rebuilding the engine."""

import os, subprocess, sys
from pathlib import Path
from build_desktop_payload import stage

ROOT = Path(__file__).resolve().parents[1]
if __name__ == "__main__":
    for name in ["desktop-runtime/runtime.json", "desktop-characters/catalog.json"]:
        if not (ROOT / "build" / name).is_file():
            raise SystemExit(
                "Prepare desktop release inputs first: missing build/" + name
            )
    stage(freeze=False)
    subprocess.run(
        ["npm.cmd" if os.name == "nt" else "npm", "--prefix", "web", "run", "build"],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["npm.cmd" if os.name == "nt" else "npm", "--prefix", "desktop", "run", "dev"],
        cwd=ROOT,
        env={**os.environ, "OPENSMASH_DESKTOP_PYTHON": sys.executable},
        check=True,
    )
