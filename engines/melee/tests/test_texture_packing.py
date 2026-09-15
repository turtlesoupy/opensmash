import unittest
import numpy as np
from PIL import Image
from opensmash_melee.gx import rgba8, cmpr


class TexturePackingTests(unittest.TestCase):
    def test_cmpr_decodes_with_correct_tiles_endpoints_and_selectors(self):
        from io import BytesIO
        import struct
        pixels = np.random.default_rng(42).integers(0, 256, (24, 16, 3), dtype=np.uint8)
        source = Image.fromarray(pixels)
        dds = BytesIO()
        source.save(dds, format='DDS', pixel_format='DXT1')
        expected = np.asarray(Image.open(BytesIO(dds.getvalue())).convert('RGB')).astype(int)
        packed = cmpr(source)
        self.assertEqual(len(packed), 16 * 24 // 2)
        decoded = np.zeros_like(expected)
        offset = 0
        for y in range(0, 24, 8):
            for x in range(0, 16, 8):
                for dy, dx in ((0, 0), (0, 4), (4, 0), (4, 4)):
                    c0, c1 = struct.unpack_from('>HH', packed, offset)
                    def rgb(c):
                        r, g, b = c >> 11, (c >> 5) & 63, c & 31
                        return np.array([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)])
                    a, b = rgb(c0), rgb(c1)
                    palette = [a, b, (2*a+b)//3, (a+2*b)//3] if c0 > c1 else [a, b, (a+b)//2, np.zeros(3)]
                    for row in range(4):
                        selectors = packed[offset + 4 + row]
                        for col in range(4):
                            decoded[y+dy+row, x+dx+col] = palette[(selectors >> (6-2*col)) & 3]
                    offset += 8
        np.testing.assert_allclose(decoded, expected, atol=1)

    def test_matches_gx_tile_and_channel_order(self):
        rng = np.random.default_rng(42)
        for width, height in ((4, 4), (8, 12), (64, 56), (160, 192), (512, 512)):
            with self.subTest(size=(width, height)):
                pixels = rng.integers(0, 256, (height, width, 4), dtype=np.uint8)
                expected = bytearray()
                for y in range(0, height, 4):
                    for x in range(0, width, 4):
                        tile = pixels[y:y+4, x:x+4].reshape(16, 4)
                        expected.extend(tile[:, [3, 0]].tobytes())
                        expected.extend(tile[:, [1, 2]].tobytes())
                self.assertEqual(rgba8(Image.fromarray(pixels)), bytes(expected))
