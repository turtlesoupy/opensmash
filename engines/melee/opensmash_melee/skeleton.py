"""Read costume HSD_Joint descriptors without inventing semantic bone IDs."""
import math
import numpy as np


def trs(rotation, scale, position):
    x, y, z = rotation
    cx, cy, cz = math.cos(x), math.cos(y), math.cos(z)
    sx, sy, sz = math.sin(x), math.sin(y), math.sin(z)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    m = np.eye(4)
    m[:3, :3] = rz @ ry @ rx @ np.diag(scale)
    m[:3, 3] = position
    return m


def joints(archive, symbol):
    try:
        root = archive.roots()[symbol]
    except KeyError:
        raise ValueError(f'Joint symbol {symbol!r} missing; inspect the DAT first') from None
    result, seen = [], set()
    pending = [(root, None)]
    while pending:
        offset, parent = pending.pop()
        if offset in seen:
            raise ValueError('Cyclic or instanced joint graph is unsupported')
        seen.add(offset)
        archive.check(offset, 64)
        flags = archive.u32(offset + 4)
        if flags & ((1 << 12) | (1 << 17) | (1 << 23) | (1 << 24) | (1 << 25)):
            raise ValueError('Instance, quaternion, or independent joint matrices need engine capture')
        rotation = archive.unpack('3f', offset + 20)
        scale = archive.unpack('3f', offset + 32)
        position = archive.unpack('3f', offset + 44)
        local = trs(rotation, scale, position)
        if not np.isfinite(local).all():
            raise ValueError('Non-finite joint transform')
        world = local if parent is None else np.array(result[parent]['world']) @ local
        # The engine's archived inverse bind matrices are authoritative. TRS
        # worlds are provided for inspection only (HSD scale rules can differ).
        inverse_ptr = archive.ptr(offset + 56)
        inverse = None
        if inverse_ptr is not None:
            inverse = np.eye(4)
            inverse[:3] = np.array(archive.unpack('12f', inverse_ptr)).reshape(3, 4)
            if not np.isfinite(inverse).all() or abs(np.linalg.det(inverse)) < 1e-10:
                raise ValueError('Invalid joint inverse bind matrix')
        index = len(result)
        result.append(dict(index=index, offset=offset, parent=parent, flags=flags,
                           rotation=rotation, scale=scale, position=position,
                           world=world.tolist(), inverse_bind=None if inverse is None else inverse.tolist(),
                           dobj=None if flags & ((1 << 5) | (1 << 14)) else archive.ptr(offset + 16)))
        sibling, child = archive.ptr(offset + 12), archive.ptr(offset + 8)
        if sibling is not None:
            pending.append((sibling, parent))
        if child is not None:
            pending.append((child, index))
        if len(result) > 512:
            raise ValueError('Unreasonable costume joint count')
    return result
