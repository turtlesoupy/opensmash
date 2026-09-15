"""Build a browser-only draw layout from an already validated costume profile."""

import argparse, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from opensmash_melee.glb import GLB
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.retarget import conform

ROOT = Path(__file__).resolve().parents[1]


def build(ident, compact=False, prepared=None):
    out = ROOT / "build/characters" / ident
    profile = json.loads((out / "profile.json").read_text())
    original = next(out.glob("Pl*Nr.dat"))
    filename = original.name
    if prepared is None:
        archive = Archive.read(ROOT / "assets/game/files" / filename)
        skel = joints(archive, profile["symbol"])
        mesh = GLB(ROOT / "assets/characters" / ident / "rigged.glb").mesh()
        fitted = conform(mesh, skel, profile)
        from opensmash_melee.presentation import panel
        fitted["presentation"] = panel(ROOT / "assets/characters" / ident)
        original_bytes = archive.serialize()
    else:
        original_bytes, skel, fitted = prepared
    from opensmash_melee.browser_skin import build_costume

    raw, stats = build_costume(
        original_bytes,
        fitted,
        skel,
        dict(profile, texture_size=256, compressed_body_texture=True) if compact else profile,
    )
    target = out / ("browser-compact" if compact else "browser")
    target.mkdir(exist_ok=True)
    (target / filename).write_bytes(raw)
    (target / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(stats)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("id")
    p.add_argument("--compact", action="store_true")
    a = p.parse_args()
    build(a.id, a.compact)
