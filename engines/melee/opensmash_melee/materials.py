"""Shared Melee material defaults and dependency-free generated-cache migration."""
# Melee Mario's textured, diffuse-lit body material. RENDER_CONSTANT (bit 0)
# must NOT be combined with RENDER_DIFFUSE: HSD_SetupChannelMode switches on
# mode & 7, and 5 falls through to the unlit channel instead of lit case 4.
LIT_TEXTURE_MODE = 0x14
FIGHTER_MATERIAL_COLOR = 0xb3b3b3ff
FIGHTER_TEXTURE_FLAGS = 0x50010  # diffuse texture replaces material RGB, as on Mario


def upgrade_cached_lighting(raw):
    """Migrate our old exported material without touching geometry or animation.

    Only our exact unlit/first-lit exporter signatures are eligible. Current files
    are returned byte-for-byte, so cached native and browser costumes need no
    expensive retarget/rebuild. Call this only for generated costume caches.
    """
    from .archive import Archive
    a = Archive(raw)
    changed = False
    for symbol in a.roots():
        if not symbol.endswith('_joint') or 'matanim' in symbol:
            continue
        pending = [a.roots()[symbol]]
        seen = set()
        while pending:
            joint = pending.pop()
            if joint in seen:
                raise ValueError('Cyclic joint graph in generated costume')
            seen.add(joint)
            pending.extend(p for p in (a.ptr(joint+8), a.ptr(joint+12)) if p is not None)
            flags = a.u32(joint+4)
            d = None if flags & ((1 << 5) | (1 << 14)) else a.ptr(joint+16)
            dobjs = set()
            while d is not None:
                if d in dobjs:
                    raise ValueError('Cyclic DObj list in generated costume')
                dobjs.add(d)
                m = a.ptr(d + 8)
                if a.ptr(d + 12) is not None and m is not None:
                    mat, tex = a.ptr(m + 12), a.ptr(m + 8)
                    if (mat is not None and tex is not None and a.u32(tex + 64) == 0x40010
                            and (a.u32(m + 4), a.unpack('IIIff', mat)) in (
                                (0x15, (0xffffffff, 0xffffffff, 0, 1.0, 0.0)),
                                (0x14, (FIGHTER_MATERIAL_COLOR, FIGHTER_MATERIAL_COLOR, 0, 1.0, 0.0)))):
                        a.pack('I', m + 4, LIT_TEXTURE_MODE)
                        a.pack('II', mat, FIGHTER_MATERIAL_COLOR, FIGHTER_MATERIAL_COLOR)
                        a.pack('I', tex + 64, FIGHTER_TEXTURE_FLAGS)
                        changed = True
                d = a.ptr(d + 4)
    return a.serialize() if changed else raw
