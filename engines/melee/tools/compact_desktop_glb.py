"""Remove material maps the Melee converter never reads, without recompressing art.

This is a desktop staging transform, not a general glTF optimizer. Geometry,
rigging, base-color pixels and source exports remain unchanged. Unknown glTF
extensions are left alone because they can contain additional resource references.
"""

import json
import struct
from pathlib import Path


def compact_glb(raw):
    if len(raw) < 20 or struct.unpack_from('<III', raw) != (0x46546C67, 2, len(raw)):
        raise ValueError('Invalid GLB header')
    chunks = {}
    pos = 12
    while pos < len(raw):
        if pos + 8 > len(raw):
            raise ValueError('Truncated GLB chunk')
        size, kind = struct.unpack_from('<II', raw, pos)
        pos += 8
        if size % 4 or pos + size > len(raw) or kind in chunks:
            raise ValueError('Invalid GLB chunk')
        chunks[kind] = raw[pos:pos + size]
        pos += size
    if set(chunks) != {0x4E4F534A, 0x004E4942}:
        return raw
    doc = json.loads(chunks[0x4E4F534A])

    def extended(value):
        if isinstance(value, dict):
            return bool(value.get('extensions')) or any(extended(v) for v in value.values())
        return isinstance(value, list) and any(extended(v) for v in value)

    if extended(doc) or doc.get('extensionsRequired') or len(doc.get('buffers', [])) != 1 or 'uri' in doc['buffers'][0]:
        return raw
    removed_textures = set()
    for material in doc.get('materials', []):
        for key in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            if key in material:
                removed_textures.add(material.pop(key)['index'])
        pbr = material.get('pbrMetallicRoughness', {})
        if 'metallicRoughnessTexture' in pbr:
            removed_textures.add(pbr.pop('metallicRoughnessTexture')['index'])
    if not removed_textures:
        return raw
    # A map may share its texture/image/view with base color or an accessor.
    retained_textures = {m['pbrMetallicRoughness']['baseColorTexture']['index']
                         for m in doc.get('materials', [])
                         if 'baseColorTexture' in m.get('pbrMetallicRoughness', {})}
    removed_textures -= retained_textures
    textures = doc.get('textures', [])
    texture_map = {old: new for new, old in enumerate(i for i in range(len(textures)) if i not in removed_textures)}
    removed_images = {textures[i]['source'] for i in removed_textures}
    removed_images -= {textures[i]['source'] for i in texture_map}
    images = doc.get('images', [])
    image_map = {old: new for new, old in enumerate(i for i in range(len(images)) if i not in removed_images)}
    removed_views = {images[i]['bufferView'] for i in removed_images if 'bufferView' in images[i]}

    def referenced_views(value):
        if isinstance(value, dict):
            if 'bufferView' in value:
                yield value['bufferView']
            for child in value.values():
                yield from referenced_views(child)
        elif isinstance(value, list):
            for child in value:
                yield from referenced_views(child)

    doc['images'] = [images[i] for i in image_map]
    removed_views -= set(referenced_views(doc))
    views = doc['bufferViews']
    view_map = {old: new for new, old in enumerate(i for i in range(len(views)) if i not in removed_views)}
    binary = bytearray()
    for i in view_map:
        view = views[i]
        start, size = view.get('byteOffset', 0), view['byteLength']
        if view.get('buffer', 0) != 0 or start < 0 or size < 0 or start + size > len(chunks[0x004E4942]):
            raise ValueError('Invalid GLB buffer view')
        binary.extend(b'\0' * (-len(binary) % 4))
        view['byteOffset'] = len(binary)
        binary.extend(chunks[0x004E4942][start:start + size])
    doc['bufferViews'] = [views[i] for i in view_map]

    def remap_views(value):
        if isinstance(value, dict):
            if 'bufferView' in value:
                value['bufferView'] = view_map[value['bufferView']]
            for child in value.values():
                remap_views(child)
        elif isinstance(value, list):
            for child in value:
                remap_views(child)

    remap_views(doc)
    doc['textures'] = [dict(textures[i], source=image_map[textures[i]['source']]) for i in texture_map]
    for material in doc.get('materials', []):
        texture = material.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if texture is not None:
            texture['index'] = texture_map[texture['index']]
    doc['buffers'][0]['byteLength'] = len(binary)
    binary.extend(b'\0' * (-len(binary) % 4))
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    result = (struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(binary))
              + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
              + struct.pack('<II', len(binary), 0x004E4942) + binary)
    return bytes(result) if len(result) < len(raw) else raw


def compact_roster(roster):
    before = after = 0
    count = 0
    for path in sorted(Path(roster).glob('*/rigged.glb')):
        raw = path.read_bytes()
        compact = compact_glb(raw)
        before += len(raw)
        after += len(compact)
        if compact != raw:
            path.write_bytes(compact)
            count += 1
    return {'changedModels': count, 'beforeBytes': before, 'afterBytes': after,
            'savedBytes': before - after}
