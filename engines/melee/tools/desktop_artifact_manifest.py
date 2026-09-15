"""Identify downloadable builds without tying the app version to the engine cache."""

import argparse, hashlib, json, os
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=root / "build/desktop-artifacts")
out = parser.parse_args().output
version = json.loads((root / "desktop/package.json").read_text())["version"]
artifacts = sorted([*out.glob(f"OpenSmash-Melee-{version}-*.dmg"), *out.glob(f"OpenSmash-Melee-{version}-*.zip"), *out.glob(f"OpenSmash-Melee-{version}-*.tar.gz"), *out.glob(f"OpenSmash-Melee-{version}-*-Setup.exe")])
if not artifacts:
    raise SystemExit("No desktop distributables were built")
manifest = {
    "version": version,
    "sourceCommit": os.environ.get("GITHUB_SHA"),
    "runtimeRelease": os.environ.get("OPENSMASH_RUNTIME_SOURCE", json.loads((root / "infra/gcp/release.json").read_text())["runtime"]),
    "characterRelease": "desktop-characters-v1",
    "files": {},
}
for path in artifacts:
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest["files"][path.name] = {"bytes": path.stat().st_size, "sha256": digest}
(out / "build-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
(out / "SHA256SUMS.txt").write_text(
    "".join(
        info["sha256"] + "  " + name + "\n" for name, info in manifest["files"].items()
    )
)
