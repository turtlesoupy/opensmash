"""Merge captured Dolphin v8 portable pipeline UIDs into browser warmup data.

Inputs are GALE01.uidcache files captured by validate_local_disc.cjs. This does
not accept shader binaries or game assets. Existing warmup entries are retained.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct

# sizeof(SerializedGXPipelineUid) in the pinned browser Dolphin build.
# Recheck the structure and version together when updating Dolphin.
HEADER = struct.pack('<II', 0x44495550, 8)
RECORD_BYTES = 579


def records(data):
    if data[:8] != HEADER or (len(data) - 8) % RECORD_BYTES:
        raise ValueError('Expected a complete Dolphin version-8 pipeline UID cache')
    return {data[i:i + RECORD_BYTES] for i in range(8, len(data), RECORD_BYTES)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('caches', type=Path, nargs='+')
    parser.add_argument('--base', type=Path, default=Path(__file__).resolve().parents[1] /
                        'runtime/web/shader-warmup.json')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    seed = json.loads(args.base.read_text())
    original = base64.b64decode(seed['data'], validate=True)
    if seed['version'] != 1 or hashlib.sha256(original).hexdigest() != seed['sha256']:
        raise ValueError('Invalid base warmup checksum or version')
    combined = records(original)
    before = len(combined)
    for cache in args.caches:
        combined.update(records(cache.read_bytes()))
    data = HEADER + b''.join(sorted(combined))
    seed.update(uidVersion=8, uidRecordBytes=RECORD_BYTES, pipelines=len(combined),
                sha256=hashlib.sha256(data).hexdigest(), data=base64.b64encode(data).decode())
    args.output.write_text(json.dumps(seed, indent=2) + '\n')
    print(json.dumps({'before': before, 'after': len(combined), 'bytes': len(data),
                      'sha256': seed['sha256']}))


if __name__ == '__main__':
    main()
