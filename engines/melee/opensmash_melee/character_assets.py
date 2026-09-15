"""Resolve compact desktop art alongside original generation/import assets."""

from pathlib import Path


def portrait_path(character):
    character = Path(character)
    webp = character / "portrait_raw.webp"
    return webp if webp.is_file() else character / "portrait_raw.png"
