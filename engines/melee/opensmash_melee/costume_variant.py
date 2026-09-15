"""Rebind archive exports to a real costume slot without changing its mesh."""
import json
from pathlib import Path
from .archive import Archive

SCHEMA = json.loads((Path(__file__).resolve().parents[1] / 'runtime/launch-options.json').read_text())

def costume_variant(raw, fighter, color, target=None):
    from .targets import BY_SLUG
    slots = BY_SLUG[target]['costumes'] if target else SCHEMA['costumes'][str(fighter)]
    if not isinstance(color, int) or not 0 <= color < len(slots):
        raise ValueError('Invalid costume color')
    archive = Archive(raw)
    source, target = slots[0], slots[color]
    mapping = {source[key]: target[key] for key in ('symbol', 'materialSymbol') if source[key] != 'NULL'}
    if source['symbol'] not in archive.roots():
        raise ValueError('Costume belongs to a different fighter')
    for index, (offset, name) in enumerate(archive.public):
        symbol = archive.symbol(name)
        if symbol in mapping:
            archive.public[index] = (offset, len(archive.strings))
            archive.strings += mapping[symbol].encode('ascii') + b'\0'
    return archive.serialize()
