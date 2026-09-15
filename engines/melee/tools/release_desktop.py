"""Build and verify a release on this machine using cached private inputs."""

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args, capture=False):
    return subprocess.run(list(map(str, args)), cwd=ROOT, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, default=ROOT / "build/desktop-artifacts",
                        help="Output directory; use an empty directory for candidate builds")
    parser.add_argument("--commit", help="Exact release SHA; defaults to freshly fetched origin/main")
    parser.add_argument("--inputs", type=Path, default=ROOT / "build/desktop-inputs/native-inputs-v3.tar.gz")
    parser.add_argument("--characters", type=Path, default=ROOT / "build/desktop-inputs/characters.tar.gz")
    args = parser.parse_args()
    if run("git", "status", "--porcelain", "--untracked-files=no", capture=True).stdout.strip():
        raise SystemExit("Commit tracked changes before building a release.")
    run("git", "fetch", "origin")
    target = args.commit or "origin/main"
    if args.commit and (len(args.commit) != 40 or any(c not in "0123456789abcdef" for c in args.commit)):
        raise SystemExit("--commit must be a full 40-character commit SHA.")
    expected = run("git", "rev-parse", target + "^{commit}", capture=True).stdout.strip()
    run("git", "merge", "--ff-only", expected)
    if run("git", "rev-parse", "HEAD", capture=True).stdout.strip() != expected:
        raise SystemExit("Checkout is ahead of or diverged from the release commit; use a clean checkout.")
    # Re-exec after a fast-forward so release tooling also comes from that commit.
    if os.environ.get("OPENSMASH_RELEASE_SYNCED") != expected:
        os.environ["OPENSMASH_RELEASE_SYNCED"] = expected
        run(sys.executable, Path(__file__), "--commit", expected,
            "--inputs", args.inputs.resolve(), "--characters", args.characters.resolve(),
            "--artifacts", args.artifacts.resolve())
        return
    for path in (args.inputs, args.characters):
        if not path.is_file():
            raise SystemExit(f"Missing private build input: {path}")
    commit = run("git", "rev-parse", "HEAD", capture=True).stdout.strip()
    config = json.loads((ROOT / "infra/gcp/release.json").read_text())
    os.environ.update(GITHUB_SHA=commit, OPENSMASH_RUNTIME_SOURCE=config["runtime"],
                      CSC_IDENTITY_AUTO_DISCOVERY="false")
    # Rebuild incrementally from the current recipe rather than trust an older runtime ZIP.
    run(sys.executable, "tools/build_desktop_runtime.py", args.inputs.resolve())
    runtime = ROOT / "build/desktop-inputs/local-runtime.zip"
    shutil.make_archive(str(runtime.with_suffix("")), "zip", ROOT / "build/desktop-runtime")
    run(sys.executable, "tools/prepare_desktop_release.py", runtime, args.characters.resolve())
    npm = "npm.cmd" if os.name == "nt" else "npm"
    run(npm, "--prefix", "web", "ci")
    run(npm, "--prefix", "web", "run", "build")
    run(sys.executable, "tools/build_desktop_payload.py")
    run(sys.executable, "-m", "unittest", "discover", "-s", "tests")
    run("node", "--test", "tests/launch_options.test.mjs")
    run(npm, "--prefix", "desktop", "ci")
    run(npm, "--prefix", "desktop", "run", "dist", "--",
        "--config.directories.output=" + str(args.artifacts.resolve()))
    if sys.platform == "darwin":
        folder = "mac-arm64" if platform.machine() == "arm64" else "mac"
        resources = args.artifacts.resolve() / folder / "OpenSmash Melee.app/Contents/Resources"
    else:
        folder = "win-unpacked" if os.name == "nt" else "linux-unpacked"
        resources = args.artifacts.resolve() / folder / "resources"
    run(sys.executable, "tools/verify_desktop_package.py", resources)
    if run("git", "rev-parse", "HEAD", capture=True).stdout.strip() != commit or run(
        "git", "status", "--porcelain", "--untracked-files=no", capture=True
    ).stdout.strip():
        raise SystemExit("Source changed during the build; rebuild before releasing.")
    run(sys.executable, "tools/desktop_artifact_manifest.py", "--output", args.artifacts.resolve())
    print(f"Verified local release from {commit}: {args.artifacts.resolve()}", flush=True)


if __name__ == "__main__":
    main()
