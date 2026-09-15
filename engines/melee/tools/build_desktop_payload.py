"""Freeze the portable service and stage only launcher-owned code/config."""

import argparse, ast, importlib.util, json, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def stage(freeze=True):
    payload = ROOT / "build/desktop-payload"
    if payload.exists():
        shutil.rmtree(payload)
    payload.mkdir(parents=True)
    for name in ["opensmash_melee", "tools"]:
        target = payload / name
        target.mkdir(exist_ok=True)
        for p in (ROOT / name).glob("*.py"):
            shutil.copy2(p, target / p.name)
    shutil.copytree(
        ROOT / "runtime",
        payload / "runtime",
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("*.wasm", "*.dylib", "*.so", "*.dll"),
    )
    (payload / "web/public").mkdir(parents=True, exist_ok=True)
    shutil.copy2(
        ROOT / "build/desktop-characters/catalog.json",
        payload / "web/public/catalog.json",
    )
    if not freeze:
        return
    hidden = set()
    for folder in ["opensmash_melee", "tools"]:
        for source in (ROOT / folder).glob("*.py"):
            for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
                names = (
                    [n.name for n in node.names]
                    if isinstance(node, ast.Import)
                    else (
                        [node.module]
                        if isinstance(node, ast.ImportFrom)
                        and not node.level
                        and node.module
                        else []
                    )
                )
                for name in names:
                    if name.split(".")[0] in sys.stdlib_module_names:
                        try:
                            if importlib.util.find_spec(name):
                                hidden.add(name)
                        except (ImportError, ValueError):
                            pass
    imports = [arg for name in sorted(hidden) for arg in ["--hidden-import", name]]
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--name",
            "melee-backend",
            "--distpath",
            str(ROOT / "build/desktop-backend"),
            "--workpath",
            str(ROOT / "build/desktop-freeze"),
            "--specpath",
            str(ROOT / "build/desktop-freeze"),
            "--collect-all",
            "PIL",
            *[arg for name in ["numpy","scipy","Pillow","pyinstaller"] for arg in ["--copy-metadata",name]],
            *imports,
            str(ROOT / "desktop/backend_entry.py"),
        ],
        check=True,
    )


if __name__ == "__main__":
    stage()
