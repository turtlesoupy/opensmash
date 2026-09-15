"""Hand-drawn 6 and 4 for the caption webfonts, in native coverage pixels.

All cuts share the letters' seven-row cap height. Hex values encode coverage:
f is solid, dots are empty, intermediate values soften curves and diagonals.
Regular uses broad stems; condensed/narrow follow their matching letter cuts.
"""
import math

DIGITS = {
    'regular': {
        '6': ['.8ffc.', '8f5...', 'f5....', 'f5ff8.', 'f5..5f', '8f..8f', '.8ff8.'],
        '4': ['...8f.', '..8ff.', '.8f5f.', '8f.5f.', 'ffffff', '...5f.', '...5f.'],
    },
    'condensed': {
        '6': ['4ff4', 'f73.', 'f3..', 'fff4', 'f33f', 'f76f', '4ff4'],
        '4': ['..cf', '.9ff', '9c.f', 'f..f', 'ffff', '...f', '...f'],
    },
    'narrow': {
        '6': ['.ff', 'f..', 'f..', 'ff.', 'f.f', 'f.f', '.f.'],
        '4': ['..f', '.ff', 'f.f', 'f.f', 'fff', '..f', '..f'],
    },
}


def digit_glyphs(cut):
    # Same outline model as build2.py / emit2.make_glyph: a 0.6 px Gaussian
    # at 2.5 gain, with two columns of spill and one row above/below the face.
    # Keep the webfont-only build independent of the sprite extraction stack.
    kernel = [math.exp(-.5 * (offset / .6) ** 2) for offset in range(-2, 3)]
    total = sum(kernel)
    kernel = [value / total for value in kernel]
    glyphs = {}
    for char, rows in DIGITS[cut].items():
        face_width = len(rows[0])
        width, height = face_width + 4, 9
        coverage = [0.] * (width * height)
        for y, row in enumerate(rows):
            assert len(row) == face_width
            for x, value in enumerate(row):
                coverage[(y + 1) * width + x + 2] = int(value, 16) / 15 if value != '.' else 0.
        shadow = []
        for y in range(height):
            for x in range(width):
                blurred = sum(
                    coverage[sy * width + sx] * kernel[dy + 2] * kernel[dx + 2]
                    for dy in range(-2, 3) for dx in range(-2, 3)
                    if 0 <= (sy := y + dy) < height and 0 <= (sx := x + dx) < width
                )
                shadow.append(round(min(1., blurred * 2.5), 5))
        columns = [max(coverage[y * width + x] for y in range(height)) for x in range(width)]
        inked = [x for x, value in enumerate(columns) if value > .15]
        left, right = inked[0], inked[-1]
        glyphs[char] = dict(
            w=width, h=height, ox=-2, faceW=face_width,
            c=[round(value, 5) for value in coverage], s=shadow,
            inkL=round(left - 2 + 1 - columns[left], 3),
            inkR=round(right - 2 + columns[right], 3),
        )
    return glyphs
