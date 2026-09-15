"""Decode every bundled portrait, also runnable through the frozen worker."""

import argparse
import json
import sys
from pathlib import Path
from PIL import Image

if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from opensmash_melee.character_assets import portrait_path


def verify(roster):
    catalog = json.loads((roster / "catalog.json").read_text())
    formats = {}
    for row in catalog:
        path = portrait_path(roster / row["slug"])
        with Image.open(path) as image:
            if image.format not in {"PNG", "WEBP"}:
                raise ValueError("Unsupported portrait format: " + str(path))
            image.load()
            formats[image.format] = formats.get(image.format, 0) + 1
    return {"portraits": len(catalog), "formats": formats}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("roster", type=Path)
    print(json.dumps(verify(parser.parse_args().roster)))
