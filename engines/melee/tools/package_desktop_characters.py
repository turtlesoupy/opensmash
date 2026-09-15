"""Package generated roster sources, excluding prompts, source photos and game data."""

import argparse, hashlib, io, json, tarfile
from pathlib import Path
from PIL import Image

if __package__:
    from .compact_desktop_glb import compact_glb
    from .compact_desktop_portraits import encode_portrait
else:
    from compact_desktop_glb import compact_glb
    from compact_desktop_portraits import encode_portrait

ROOT = Path(__file__).resolve().parents[1]


def package(source, output):
    catalog = json.loads((ROOT / "web/public/catalog.json").read_text())
    included = []
    missing = []
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w:gz") as archive:

        def add(name, raw):
            entry = tarfile.TarInfo(name)
            entry.size = len(raw)
            entry.mode = 0o644
            archive.addfile(entry, io.BytesIO(raw))

        for row in catalog:
            folder = source / row["slug"]
            required = [
                "rigged.glb",
                "portrait_raw.png",
                "stock_raw.png",
                "emblem_raw.png",
                "announcer.wav",
            ]
            absent = [n for n in required if not (folder / n).is_file()]
            if absent:
                missing.append({"slug": row["slug"], "missing": absent})
                continue
            for name in required:
                if name.endswith(".png"):
                    with Image.open(folder / name) as im:
                        im = im.convert("RGBA")
                        im.thumbnail(
                            (512, 512) if name == "portrait_raw.png" else (128, 128)
                        )
                        if name == "portrait_raw.png":
                            raw = encode_portrait(im)
                            name = "portrait_raw.webp"
                        else:
                            out = io.BytesIO()
                            im.save(out, "PNG", optimize=True)
                            raw = out.getvalue()
                else:
                    raw = (folder / name).read_bytes()
                    if name == "rigged.glb":
                        raw = compact_glb(raw)
                add(row["slug"] + "/" + name, raw)
            add(
                row["slug"] + "/character.json",
                json.dumps(
                    {"name": row["name"], "display": row["name"], "short": row["short"]}
                ).encode(),
            )
            included.append(row)
        add("catalog.json", json.dumps(included).encode())
        add(
            "source-report.json",
            json.dumps(
                {"included": len(included), "missing": missing}, indent=2
            ).encode(),
        )
    print(
        json.dumps(
            {
                "archive": str(output),
                "bytes": output.stat().st_size,
                "characters": len(included),
                "missing": missing,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument(
        "--output", type=Path, default=ROOT / "build/desktop-inputs/characters.tar.gz"
    )
    a = p.parse_args()
    package(a.source, a.output)
