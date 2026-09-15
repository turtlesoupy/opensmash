"""Pack the pinned runtime's system resources into one local binary request."""
import json
import struct
from pathlib import Path


def pack(source: Path, target: Path):
    entries = []
    payload = bytearray()
    for path in sorted(source.rglob('*')):
        if not path.is_file():
            continue
        data = path.read_bytes()
        entries.append(dict(name=path.relative_to(source).as_posix(), offset=len(payload), length=len(data)))
        payload.extend(data)
    header = json.dumps(entries, separators=(',', ':')).encode()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(struct.pack('>I', len(header)) + header + payload)
