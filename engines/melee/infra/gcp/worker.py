"""Build one release platform using versioned private GCS inputs, never an ISO."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path
from google.cloud import storage

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "infra/gcp/release.json").read_text())


def run(*args):
    subprocess.run(list(map(str, args)), cwd=ROOT, check=True)


def engine_recipe():
    digest = hashlib.sha256(CONFIG["inputs"].encode())
    files = [
        ROOT / "runtime/native/skin_bridge.cpp",
        ROOT / "runtime/mods/launch_match.c",
    ]
    files += [
        ROOT / "desktop/runtime.cmake",
        ROOT / "desktop/controllers.cpp",
        ROOT / "tools/build_desktop_runtime.py",
    ]
    for path in sorted(p for p in files if p.is_file()):
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def main(args):
    bucket = storage.Client().bucket(CONFIG["bucket"])
    prefix = f"jobs/{args.build}/{args.platform}"
    request = json.loads(
        bucket.blob(f"jobs/{args.build}/request.json").download_as_text()
    )
    os.environ["GITHUB_SHA"] = request["commit"]
    os.environ["CSC_IDENTITY_AUTO_DISCOVERY"] = "false"
    os.environ["CCACHE_DIR"] = str(ROOT / "build/ccache")
    os.environ["CCACHE_BASEDIR"] = str(ROOT)
    os.environ["CCACHE_MAXSIZE"] = "2G"
    if os.name == "nt":
        os.environ.update(CC="clang-cl", CXX="clang-cl")
    else:
        os.environ.update(CC="clang", CXX="g++-14")
    inputs = ROOT / "build/desktop-inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    cache = bucket.blob(f'cache/{CONFIG["runtime"]}/{args.platform}.tar.gz')
    success = False
    try:
        runtime = inputs / f"native-runtime-{args.platform}.zip"
        remote_runtime = bucket.blob(f'inputs/{CONFIG["runtime"]}/{runtime.name}')
        if remote_runtime.exists():
            remote_runtime.reload()
            if (remote_runtime.metadata or {}).get("recipe") != engine_recipe():
                raise ValueError(
                    "Native sources changed: bump runtime in infra/gcp/release.json before reusing the cache"
                )
            remote_runtime.download_to_filename(runtime)
        else:
            if cache.exists():
                archive = inputs / "ccache.tar.gz"
                cache.download_to_filename(archive)
                with tarfile.open(archive) as tar:
                    tar.extractall(ROOT / "build/ccache", filter="data")
            native_inputs = inputs / "native-inputs-v3.tar.gz"
            bucket.blob(
                f'inputs/{CONFIG["inputs"]}/{native_inputs.name}'
            ).download_to_filename(native_inputs)
            run(sys.executable, "-m", "pip", "install", "cmake", "ninja")
            run(sys.executable, "tools/build_desktop_runtime.py", native_inputs)
            shutil.make_archive(
                str(runtime.with_suffix("")), "zip", ROOT / "build/desktop-runtime"
            )
            # Generation precondition prevents two tags from overwriting the same cache.
            remote_runtime.metadata = {
                "recipe": engine_recipe(),
                "commit": request["commit"],
            }
            remote_runtime.upload_from_filename(runtime, if_generation_match=0)
        characters = inputs / "characters.tar.gz"
        bucket.blob(
            f'inputs/{CONFIG["characters"]}/characters.tar.gz'
        ).download_to_filename(characters)
        run(sys.executable, "-m", "pip", "install", "-r", "desktop/requirements.txt")
        run(sys.executable, "tools/prepare_desktop_release.py", runtime, characters)
        npm = "npm.cmd" if os.name == "nt" else "npm"
        run(npm, "--prefix", "web", "ci")
        run(npm, "--prefix", "web", "run", "build")
        run(sys.executable, "tools/build_desktop_payload.py")
        run(sys.executable, "-m", "unittest", "discover", "-s", "tests")
        run("node", "--test", "tests/launch_options.test.mjs")
        run(npm, "--prefix", "desktop", "ci")
        run(npm, "--prefix", "desktop", "run", "dist")
        resources = (
            ROOT
            / "build/desktop-artifacts"
            / ("win-unpacked" if os.name == "nt" else "linux-unpacked")
            / "resources"
        )
        run(sys.executable, "tools/verify_desktop_package.py", resources)
        run(sys.executable, "tools/desktop_artifact_manifest.py")
        artifacts = ROOT / "build/desktop-artifacts"
        names = ["build-manifest.json", "SHA256SUMS.txt"]
        names += list(json.loads((artifacts / "build-manifest.json").read_text())["files"])
        for name in names:
            bucket.blob(
                f'releases/{request["tag"]}/{args.platform}/{name}'
            ).upload_from_filename(artifacts / name)
        success = True
    finally:
        cache_dir = ROOT / "build/ccache"
        if cache_dir.exists():
            try:
                archive = shutil.make_archive(
                    str(inputs / "saved-ccache"), "gztar", cache_dir
                )
                cache.upload_from_filename(archive)
            except Exception as error:
                print(f"Could not save optional compiler cache: {error}", flush=True)
        result = {"success": success, "platform": args.platform, **request}
        (ROOT / "build/gcp-status.json").write_text(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", required=True)
    parser.add_argument(
        "--platform", required=True, choices=["linux-x64", "windows-x64"]
    )
    main(parser.parse_args())
