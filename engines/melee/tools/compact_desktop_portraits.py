"""Encode desktop portraits once, at the reviewed WebP quality and resolution."""

import io
from pathlib import Path
from PIL import Image


def encode_portrait(image):
    output = io.BytesIO()
    image.save(output, "WEBP", quality=90, method=4)
    return output.getvalue()


def compact_portraits(roster):
    before = after = count = 0
    for source in sorted(Path(roster).glob("*/portrait_raw.png")):
        with Image.open(source) as image:
            raw = encode_portrait(image)
        destination = source.with_suffix(".webp")
        temporary = destination.with_suffix(".webp.tmp")
        temporary.write_bytes(raw)
        temporary.replace(destination)
        before += source.stat().st_size
        after += len(raw)
        source.unlink()
        count += 1
    return {"changedPortraits": count, "beforeBytes": before, "afterBytes": after,
            "savedBytes": before - after}
