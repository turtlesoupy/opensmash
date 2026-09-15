"""Ensure installers are collected without uploading unpacked helper executables."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class DesktopArtifactsTest(unittest.TestCase):
    def test_downloadable_files_and_checksums(self):
        version = json.loads((ROOT / "desktop/package.json").read_text())["version"]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            names = [f"OpenSmash-Melee-{version}-win-x64-Setup.exe",
                     f"OpenSmash-Melee-{version}-mac-arm64.zip",
                     f"OpenSmash-Melee-{version}-mac-arm64.dmg",
                     f"OpenSmash-Melee-{version}-linux-x64.tar.gz"]
            for name in names:
                (output / name).write_bytes(name.encode())
            (output / "helper.exe").write_bytes(b"not an installer")
            (output / "OpenSmash-Melee-0.0.0-win-x64-Setup.exe").write_bytes(b"stale")
            subprocess.run([sys.executable, str(ROOT / "tools/desktop_artifact_manifest.py"),
                            "--output", directory], check=True,
                           env={**os.environ, "GITHUB_SHA": "a" * 40})
            manifest = json.loads((output / "build-manifest.json").read_text())
            self.assertEqual(set(manifest["files"]), set(names))
            self.assertEqual(manifest["sourceCommit"], "a" * 40)
            for name in names:
                self.assertEqual(manifest["files"][name], {
                    "bytes": len(name.encode()),
                    "sha256": hashlib.sha256(name.encode()).hexdigest()})
                self.assertIn(name, (output / "SHA256SUMS.txt").read_text())
