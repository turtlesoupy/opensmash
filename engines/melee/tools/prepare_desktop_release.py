"""Assemble immutable runtime/roster inputs for a fast launcher-only build."""

import argparse, hashlib, json, os, shutil, tarfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def prepare(runtime, characters):
    target = ROOT / "build/desktop-runtime"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    with zipfile.ZipFile(runtime) as archive:
        for info in archive.infolist():
            path = (target / info.filename).resolve()
            if not path.is_relative_to(target.resolve()):
                raise ValueError("Invalid archive path")
            archive.extract(info, target)
            if not info.is_dir() and os.name != "nt":
                path.chmod((info.external_attr >> 16) & 0o777 or 0o644)
    manifest = json.loads((target / "runtime.json").read_text())
    if manifest["protocol"] != 1:
        raise ValueError("Unsupported runtime protocol")
    for name, digest in manifest["sha256"].items():
        path = (target / name).resolve()
        if (
            not path.is_relative_to(target.resolve())
            or hashlib.sha256(path.read_bytes()).hexdigest() != digest
        ):
            raise ValueError("Runtime checksum mismatch: " + name)
    if os.name != "nt":
        for name in [manifest["runner"], manifest["controllers"], "dolrecomp"]:
            (target / name).chmod(0o755)
    roster = ROOT / "build/desktop-characters"
    if roster.exists():
        shutil.rmtree(roster)
    roster.mkdir()
    with tarfile.open(characters) as archive:
        archive.extractall(roster, filter="data")
    if __package__:
        from .compact_desktop_glb import compact_roster
        from .compact_desktop_portraits import compact_portraits
    else:
        from compact_desktop_glb import compact_roster
        from compact_desktop_portraits import compact_portraits

    print("Desktop model compaction:", json.dumps(compact_roster(roster)))
    print("Desktop portrait compaction:", json.dumps(compact_portraits(roster)))
    # One catalog for UI and conversion service; missing sources never appear playable.
    print(
        "Prepared runtime protocol 1 and",
        len(json.loads((roster / "catalog.json").read_text())),
        "characters",
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("runtime", type=Path)
    p.add_argument("characters", type=Path)
    a = p.parse_args()
    prepare(a.runtime, a.characters)
