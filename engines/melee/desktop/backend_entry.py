"""Frozen Python service; owned source files stay separate from user game data."""

import argparse, json, os, runpy, shutil, sys, tempfile, time

STARTED = time.monotonic()


def startup_log(message):
    if "--desktop" in sys.argv:
        print(f'[startup {time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} '
              f'+{time.monotonic() - STARTED:.3f}s] {message}',
              file=sys.stderr, flush=True)


startup_log("Loading Python dependencies")
from pathlib import Path

# Collected into the frozen interpreter; project code loads from the versioned payload.
import numpy, PIL.Image, scipy.spatial, scipy.optimize
startup_log("Python dependencies ready")


def refresh_code(payload, workspace, development_root=None):
    """Replace owned code completely; never merge stale modules into a new app."""
    with tempfile.TemporaryDirectory(
        prefix=".launcher-update-", dir=workspace
    ) as staging:
        staging = Path(staging)
        names = ["opensmash_melee", "tools", "runtime", "web"]
        for name in names:
            startup_log(f"Staging application folder: {name}")
            # Development launches must use the current service sources, just
            # as they use web/dist. A previously staged release payload can
            # otherwise silently omit endpoints used by the current UI.
            source = development_root if development_root and name != "web" else payload
            shutil.copytree(source / name, staging / name,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        for name in names:
            startup_log(f"Replacing application folder: {name}")
            destination = workspace / name
            previous = staging / (name + ".previous")
            if destination.exists():
                destination.rename(previous)
            try:
                (staging / name).rename(destination)
            except OSError:
                if previous.exists():
                    previous.rename(destination)
                raise


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "-m":
        name = sys.argv[2]
        if name != "opensmash_melee":
            raise SystemExit("Unsupported worker module")
        sys.argv = sys.argv[2:]
        sys.path.insert(0, os.getcwd())
        runpy.run_module(name, run_name="__main__")
        return
    if len(sys.argv) > 1 and sys.argv[1].endswith(".py"):
        script = Path(sys.argv[1]).resolve()
        root = Path(os.environ["OPENSMASH_WORKSPACE"]).resolve()
        if not script.is_relative_to(root / "tools"):
            raise SystemExit("Unsupported worker script")
        sys.argv = sys.argv[1:]
        sys.path.insert(0, str(root))
        runpy.run_path(str(script), run_name="__main__")
        return
    p = argparse.ArgumentParser()
    p.add_argument("--development", action="store_true")
    p.add_argument("--desktop", type=Path, required=True)
    p.add_argument("--resources", type=Path, required=True)
    a = p.parse_args()
    workspace = a.desktop / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    payload = a.resources / ("desktop-payload" if a.development else "payload")
    runtime = a.resources / ("desktop-runtime" if a.development else "runtime")
    characters = a.resources / ("desktop-characters" if a.development else "characters")
    web = a.resources.parent / "web/dist" if a.development else a.resources / "web"
    # Only application-owned code/config folders are refreshed. assets/ and build/ persist.
    startup_log("Refreshing application code")
    refresh_code(payload, workspace, Path(__file__).resolve().parents[1] if a.development else None)
    startup_log("Application code refreshed")
    os.environ["OPENSMASH_WORKSPACE"] = str(workspace)
    os.environ["OPENSMASH_RUNTIME"] = str(runtime)
    os.environ["OPENSMASH_CHARACTER_ROOT"] = str(characters)
    os.environ["OPENSMASH_WEB_DIST"] = str(web)
    os.chdir(workspace)
    sys.path.insert(0, str(workspace))
    sys.path.insert(0, str(workspace / "tools"))
    startup_log("Loading local game server")
    sys.argv = ["serve_melee.py", "--port", "0", "--desktop"]
    runpy.run_path(str(workspace / "tools/serve_melee.py"), run_name="__main__")


if __name__ == "__main__":
    main()
