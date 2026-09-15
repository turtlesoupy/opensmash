"""Drop original body texture and display-list payloads replaced by customs."""
from bisect import bisect_right
from .archive import Archive
from .target_presentation import ATTACHMENTS
from .costume_forms import form_joints

VERSION = 3
BLOCKS = {0:(8,8,32), 1:(8,4,32), 2:(8,4,32), 3:(4,4,32),
          4:(4,4,32), 5:(4,4,32), 6:(4,4,64), 8:(8,8,32),
          9:(8,4,32), 10:(4,4,32), 14:(8,8,32)}


def compact_body_textures(raw, skeleton, profile):
    a = Archive(raw)
    # External reference chains need their own relocation pass. Keep such
    # archives intact rather than guessing at unrelocated chain fields.
    if a.external:
        return raw, 0
    keep = set(profile.get('preserve_attachment_joints', ATTACHMENTS.get(profile.get('base_fighter'), [])))
    keep.update(form_joints(profile))
    images, retained, displays, retained_displays = {}, set(), {}, set()
    for joint in skeleton:
        dobj = joint['dobj']
        while dobj is not None:
            polygon = a.ptr(dobj + 12)
            while polygon is not None:
                display = a.ptr(polygon + 16)
                if display is not None:
                    displays.setdefault(display, set()).add(polygon)
                    if joint['index'] in keep:
                        retained_displays.add(display)
                polygon = a.ptr(polygon + 4)
            material = a.ptr(dobj + 8)
            texture = a.ptr(material + 8) if material is not None else None
            while texture is not None:
                image = a.ptr(texture + 76)
                if image is not None:
                    pixels = a.ptr(image)
                    images.setdefault(pixels, set()).add(image)
                    if joint['index'] in keep:
                        retained.add(pixels)
                texture = a.ptr(texture + 4)
            dobj = a.ptr(dobj + 4)
    references = {}
    for field in a.relocs:
        references.setdefault(a.ptr(field), set()).add(field)
    protected = sorted(set(a.relocs) | set(references) | {p for p, _ in a.public})
    ranges = []
    for pixels, descriptors in sorted(images.items(), key=lambda item: -1 if item[0] is None else item[0]):
        if pixels is None or pixels in retained or references[pixels] - descriptors:
            continue
        layouts = {a.unpack('HHII', image + 4) for image in descriptors}
        if len(layouts) != 1:
            continue
        width, height, fmt, mipmaps = layouts.pop()
        if not width or not height or fmt not in BLOCKS or mipmaps:
            continue
        bw, bh, block = BLOCKS[fmt]
        size = ((width+bw-1)//bw) * ((height+bh-1)//bh) * block
        end = pixels + size
        if end > len(a.data) or (ranges and pixels < ranges[-1][1]):
            continue
        # Reject any interior pointer, relocation field or exported symbol.
        # Only the image-descriptor references at the start may be replaced.
        index = bisect_right(protected, pixels)
        if pixels in a.relocs or any(p == pixels for p, _ in a.public) or (index < len(protected) and protected[index] < end):
            continue
        ranges.append((pixels, end, ('image', descriptors)))
    for display, polygons in displays.items():
        fields = {polygon + 16 for polygon in polygons}
        lengths = {a.unpack('H', polygon + 14)[0] * 32 for polygon in polygons}
        if display in retained_displays or references[display] - fields or len(lengths) != 1:
            continue
        length = lengths.pop()
        if not length or display + length > len(a.data):
            continue
        index = bisect_right(protected, display)
        if display in a.relocs or any(p == display for p, _ in a.public) or (index < len(protected) and protected[index] < display + length):
            continue
        ranges.append((display, display + length, ('display', polygons)))
    ranges.sort(key=lambda row: row[0])
    if any(left[1] > right[0] for left, right in zip(ranges, ranges[1:])):
        return raw, 0
    if not ranges:
        return raw, 0
    # Preserve material/animation descriptor slots; only hidden image payloads
    # become a tiny valid texture. Visible attachments retain their own images.
    placeholder = a.append(bytes([255]) * 64, 32)
    empty_display = a.append(bytes(32), 32)
    for _, _, (kind, descriptors) in ranges:
        for image in descriptors:
            if kind == 'image':
                a.pointer(image, placeholder)
                a.pack('HHIIff', image + 4, 4, 4, 6, 0, 0., 0.)
            else:
                a.pointer(image + 16, empty_display)
                a.pack('H', image + 14, 1)
    ends = [end for _, end, _ in ranges]
    removed = [0]
    for start, end, _ in ranges:
        removed.append(removed[-1] + end - start)
    def relocate(offset):
        return offset - removed[bisect_right(ends, offset)]
    pointers = [(relocate(field), relocate(a.ptr(field))) for field in a.relocs]
    data, cursor = bytearray(), 0
    for start, end, _ in ranges:
        data.extend(a.data[cursor:start])
        cursor = end
    data.extend(a.data[cursor:])
    a.data = data
    a.relocs = set()
    for field, target in pointers:
        a.pointer(field, target)
    a.public = [(relocate(offset), name) for offset, name in a.public]
    compacted = a.serialize()
    return (compacted, len(raw) - len(compacted)) if len(compacted) < len(raw) else (raw, 0)
