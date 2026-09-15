"""Wrap a verified published Mac app without rebuilding its runtime payload."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
def run(*args, **kwargs):
    return subprocess.run(list(map(str,args)), cwd=ROOT, check=True, **kwargs)

def main():
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise SystemExit("An Apple Silicon Mac is required.")
    version=json.loads((ROOT/"desktop/package.json").read_text())["version"]
    tag=os.environ.get("RELEASE_TAG", "v"+version)
    if tag != "v"+version:
        raise SystemExit("Release tag must match desktop/package.json.")
    out=ROOT/"build/dmg-candidate"
    out.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="opensmash-dmg-") as folder:
        temp=Path(folder)
        archive=f"OpenSmash-Melee-{version}-mac-arm64.zip"
        run("gh","release","download",tag,"--pattern",archive,"--pattern","build-manifest-macos-arm64.json","--dir",temp)
        old=json.loads((temp/"build-manifest-macos-arm64.json").read_text())
        expected=old["files"][archive]
        with (temp/archive).open("rb") as stream:
            digest=hashlib.file_digest(stream,"sha256").hexdigest()
        if digest != expected["sha256"] or (temp/archive).stat().st_size != expected["bytes"]:
            raise ValueError("Published source archive checksum mismatch")
        unpacked=temp/"unpacked"
        run("ditto","-x","-k",temp/archive,unpacked)
        app=unpacked/"OpenSmash Melee.app"
        if not app.is_dir(): raise ValueError("Missing app bundle")
        run("node",ROOT/"desktop/node_modules/electron-builder/cli.js","--projectDir","desktop","--mac","dmg","--arm64","--publish","never","--prepackaged",app,"--config.directories.output="+str(out))
        dmg=out/f"OpenSmash-Melee-{version}-mac-arm64.dmg"
        run("hdiutil","verify",dmg)
        mount=temp/"volume"
        mounted=False
        try:
            run("hdiutil","attach",dmg,"-readonly","-nobrowse","-mountpoint",mount)
            mounted=True
            if not (mount/"Applications").is_symlink() or os.readlink(mount/"Applications") != "/Applications":
                raise ValueError("Missing Applications shortcut")
            if not (mount/".DS_Store").is_file(): raise ValueError("Missing Finder layout")
            installed=temp/"installed/OpenSmash Melee.app"
            start=time.monotonic()
            run("ditto",mount/"OpenSmash Melee.app",installed)
            copy_seconds=time.monotonic()-start
            resources=installed/"Contents/Resources"
            package=run(sys.executable,ROOT/"tools/verify_desktop_package.py",resources,capture_output=True,text=True)
            checks=json.loads(package.stdout)
            profile=temp/"profile"
            with (out/"launcher-log.txt").open("w") as log:
                launcher=subprocess.Popen([str(installed/"Contents/MacOS/OpenSmash Melee"),"--user-data-dir="+str(profile)],stdout=log,stderr=log)
                try:
                    time.sleep(12)
                    if launcher.poll() is not None: raise ValueError("Installed launcher exited during startup")
                    # Evidence captures are best effort on a hosted runner's WindowServer.
                    subprocess.run(["screencapture","-x",str(out/"launcher.png")],check=False)
                finally:
                    launcher.terminate()
                    launcher.wait(timeout=15)
            run("open",mount)
            time.sleep(3)
            subprocess.run(["screencapture","-x",str(out/"finder-layout.png")],check=False)
            files=[p for p in installed.rglob("*") if p.is_file()]
            report={"package":checks,"applicationSourceCommit":old["sourceCommit"],"sourceArchive":archive,"sourceArchiveSha256":digest,"copySeconds":copy_seconds,"installedFiles":len(files),"installedBytes":sum(p.stat().st_size for p in files),"readOnlyMount":True,"applicationsShortcut":True,"finderLayoutPresent":True,"launcherStayedRunning":True,"signed":False}
            (out/"dmg-validation.json").write_text(json.dumps(report,indent=2)+"\n")
        finally:
            if mounted: run("hdiutil","detach",mount)
        run(sys.executable,ROOT/"tools/desktop_artifact_manifest.py","--output",out)
        manifest=json.loads((out/"build-manifest.json").read_text())
        manifest.update(applicationSourceCommit=old["sourceCommit"],sourceArchiveSha256=digest)
        (out/"build-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")

if __name__ == "__main__": main()
