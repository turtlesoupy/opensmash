"""Bounds-checked, big-endian HSD DAT editing.

Layout follows melee/src/sysdolphin/baselib/archive.{c,h}. Existing data
offsets, external reference chains, and symbol ordering survive appends.
"""
import struct
from pathlib import Path


class Archive:
    def __init__(self, raw):
        if len(raw) < 32:
            raise ValueError('Truncated HSD header')
        size, data_size, reloc_count, public_count, external_count = struct.unpack_from('>5I', raw)
        tables_end = 32 + data_size + 4 * reloc_count + 8 * (public_count + external_count)
        if size != len(raw) or tables_end > size:
            raise ValueError('Invalid HSD file size or table bounds')
        self.tail_header = raw[20:32]
        self.data = bytearray(raw[32:32 + data_size])
        start = 32 + data_size
        relocs = [struct.unpack_from('>I', raw, start + i * 4)[0] for i in range(reloc_count)]
        if len(set(relocs)) != len(relocs):
            raise ValueError('Duplicate relocation')
        self.relocs = set(relocs)
        start += reloc_count * 4
        self.public = [struct.unpack_from('>II', raw, start + i * 8) for i in range(public_count)]
        start += public_count * 8
        self.external = [struct.unpack_from('>II', raw, start + i * 8) for i in range(external_count)]
        self.strings = raw[tables_end:]
        for field in self.relocs:
            self.check(field, 4)
            if field % 4 or self.u32(field) >= data_size:
                raise ValueError('Invalid HSD relocation')
        for offset, name in self.public:
            self.check(offset, 1)
            self.symbol(name)
        for offset, name in self.external:
            if offset != 0xffffffff:
                self.check(offset, 4)
            self.symbol(name)

    @classmethod
    def read(cls, path):
        return cls(Path(path).read_bytes())

    def check(self, offset, length):
        if offset < 0 or length < 0 or offset + length > len(self.data):
            raise ValueError(f'HSD data out of bounds: {offset:#x} + {length}')

    def unpack(self, fmt, offset):
        self.check(offset, struct.calcsize('>' + fmt))
        return struct.unpack_from('>' + fmt, self.data, offset)

    def u32(self, offset):
        return self.unpack('I', offset)[0]

    def pack(self, fmt, offset, *values):
        self.check(offset, struct.calcsize('>' + fmt))
        struct.pack_into('>' + fmt, self.data, offset, *values)

    def symbol(self, offset):
        if not 0 <= offset < len(self.strings):
            raise ValueError('Invalid HSD symbol offset')
        end = self.strings.find(b'\0', offset)
        if end < 0:
            raise ValueError('Unterminated HSD symbol')
        return self.strings[offset:end].decode('ascii')

    def roots(self):
        return {self.symbol(name): offset for offset, name in self.public}

    def alloc(self, size, align=4):
        if size < 0 or align < 1 or align & (align - 1):
            raise ValueError('Invalid allocation')
        self.data.extend(b'\0' * (-len(self.data) % align))
        offset = len(self.data)
        self.data.extend(b'\0' * size)
        return offset

    def append(self, data, align=4):
        offset = self.alloc(len(data), align)
        self.data[offset:offset + len(data)] = data
        return offset

    def pointer(self, field, target):
        """None is null; offset zero remains a legitimate relocated pointer."""
        if target is None:
            self.pack('I', field, 0)
            self.relocs.discard(field)
        else:
            self.check(target, 1)
            self.pack('I', field, target)
            self.relocs.add(field)

    def ptr(self, field):
        value = self.u32(field)
        if field in self.relocs:
            self.check(value, 1)
            return value
        if value:
            raise ValueError(f'Unrelocated pointer at {field:#x}')
        return None

    def serialize(self):
        relocs = b''.join(struct.pack('>I', x) for x in sorted(self.relocs))
        symbols = b''.join(struct.pack('>II', *x) for x in self.public + self.external)
        body = self.data + relocs + symbols + self.strings
        header = struct.pack('>5I', 32 + len(body), len(self.data), len(self.relocs), len(self.public), len(self.external))
        raw = header + self.tail_header + body
        Archive(raw)  # Reject corrupt output before callers write it.
        return raw
