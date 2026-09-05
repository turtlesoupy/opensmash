"""Build COLR webfonts preserving the original caption coverage and outlines.

Requires fonttools[woff]. Run: python tools/cssfont/build_webfont.py
Each colored layer is baked once; browsers cache and render glyphs as text.
"""
import json
import math
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString

ROOT = Path(__file__).resolve().parents[2]
raw = (ROOT / 'src/fonts/ssb-name-font-data.js').read_text().split('export const SSB_NAME_FONT = ', 1)[1]
data, _ = json.JSONDecoder().raw_decode(raw)
UNIT = 100
CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.'
metrics = {}
round_js = lambda x: math.floor(x + .5)


def rgba(c, s):
    # Same quantization as renderIA -> toImageData in ssb-name-font.js.
    alpha = c + min(1, s) * (1 - c)
    intensity = round_js(c / alpha * 255) if alpha else 0
    return tuple(round_js(v * intensity / 255) for v in data['faceColor']) + (round_js(alpha * 255),)


def filtered_pixels(g):
    """Original scalePixels2x + blendPixelFrames, including byte rounding.

    Transparent padding preserves the half-pixel fringe outside each glyph.
    This runs at asset generation time, never on the browser's main thread.
    """
    def sample(x, y):
        if not (0 <= x < g['w'] and 0 <= y < g['h']):
            return (0, 0, 0, 0)
        i = y * g['w'] + x
        return rgba(g['c'][i], g['s'][i])

    def mix(samples):
        alpha = sum(color[3] / 255 * weight for color, weight in samples)
        if not alpha:
            return (0, 0, 0, 0)
        return tuple(round_js(sum(color[ch] * (color[3] / 255 * weight)
                                 for color, weight in samples) / alpha)
                     for ch in range(3)) + (round_js(alpha * 255),)

    for y in range(-2, g['h'] * 2):
        for x in range(-2, g['w'] * 2):
            sx, sy = x // 2, y // 2
            fx, fy = (x % 2) * .5, (y % 2) * .5
            nearest = sample(sx, sy)
            smooth = mix([(sample(sx, sy), (1-fx)*(1-fy)),
                          (sample(sx+1, sy), fx*(1-fy)),
                          (sample(sx, sy+1), (1-fx)*fy),
                          (sample(sx+1, sy+1), fx*fy)])
            color = mix([(nearest, .5), (smooth, .5)])
            if color[3]:
                yield x / 2, y / 2, color


def edge_rows(g, side):
    top = data['faceRow'] - data['boxRow']
    columns = [x for x in range(g['w']) if any(g['c'][(top+y)*g['w']+x] >= .5 for y in range(data['capHeight']))]
    if not columns:
        return set()
    x = columns[0] if side == 'left' else columns[-1]
    return {y for y in range(data['capHeight']) if g['c'][(top+y)*g['w']+x] >= .5}


for cut in ['regular', 'condensed', 'narrow']:
    face = data if cut == 'regular' else data[cut]
    table = face['glyphs']
    fb = FontBuilder(1000, isTTF=True)
    names = {ch: 'period' if ch == '.' else ch for ch in CHARS}
    order = ['.notdef', 'space', *names.values()]
    glyphs = {name: TTGlyphPen(None).glyph() for name in order}
    advances = {'.notdef': (500, 0), 'space': (round_js(face['spaceAdvance'] * UNIT), 0)}
    palette, palette_indices, layers = [], {}, {}
    glyph_metrics, pairs, collisions = {}, {}, {}
    for ch, name in names.items():
        g = table[ch]
        advance = round_js(g['inkR'] + face['defaultGap'])
        advances[name] = (advance * UNIT, 0)
        glyph_metrics[ch] = {'advance': advance, 'right': g['ox'] + g['w'] - 2}
        colors = {}
        for x, y, color in filtered_pixels(g):
            colors.setdefault(color, []).append((x, y))
        layers[name] = []
        for color, pixels in sorted(colors.items()):
            if color not in palette_indices:
                palette_indices[color] = len(palette)
                palette.append(tuple(channel / 255 for channel in color))
            layer_name = f'{name}.color{len(layers[name])}'
            pen = TTGlyphPen(None)
            for x, y in pixels:
                left = round_js((g['ox'] + x) * UNIT)
                bottom = round_js((data['faceRow'] - data['boxRow'] + data['capHeight'] - y - .5) * UNIT)
                pen.moveTo((left, bottom))
                pen.lineTo((left, bottom + UNIT // 2))
                pen.lineTo((left + UNIT // 2, bottom + UNIT // 2))
                pen.lineTo((left + UNIT // 2, bottom))
                pen.closePath()
            glyphs[layer_name] = pen.glyph()
            advances[layer_name] = (advance * UNIT, round_js((g['ox'] + min(x for x, y in pixels)) * UNIT))
            order.append(layer_name)
            layers[name].append((layer_name, palette_indices[color]))
        for next_ch in CHARS:
            k = face['kern'].get(ch + next_ch, data.get('kernSynth', {}).get(ch + next_ch, 0) if cut == 'regular' else 0)
            pairs[ch + next_ch] = round_js(g['inkR'] + face['defaultGap'] + k - table[next_ch]['inkL'])
            collision = len(edge_rows(g, 'right') & edge_rows(table[next_ch], 'left'))
            if collision:
                collisions[ch + next_ch] = collision
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({32: 'space', **{ord(ch): name for ch, name in names.items()}})
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(advances)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': f'Smash Caption {cut.title()}', 'styleName': 'Regular',
        'uniqueFontIdentifier': f'SmashCaption-{cut}-3', 'fullName': f'Smash Caption {cut.title()}',
        'psName': f'SmashCaption-{cut.title()}', 'version': 'Version 3.000'})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, sTypoLineGap=0,
        usWinAscent=800, usWinDescent=200, sCapHeight=700, sxHeight=700)
    fb.setupPost()
    fb.setupMaxp()
    fb.setupCOLR(layers, version=0)
    fb.setupCPAL([palette])
    kerning = []
    for pair, advance in pairs.items():
        delta = advance - glyph_metrics[pair[0]]['advance']
        if delta:
            kerning.append(f'pos {names[pair[0]]} {names[pair[1]]} {delta * UNIT};')
    addOpenTypeFeaturesFromString(fb.font, 'feature kern {\n' + '\n'.join(kerning) + '\n} kern;')
    fb.font['head'].created = fb.font['head'].modified = 3406620153
    fb.font.flavor = 'woff2'
    target = ROOT / f'src/fonts/smash-caption-{cut}.woff2'
    fb.save(target)
    metrics[cut] = {'space': face['spaceAdvance'], 'glyphs': glyph_metrics, 'pairs': pairs, 'collisions': collisions}
    print(f'{target.name}: {target.stat().st_size} bytes')

(ROOT / 'src/fonts/smash-caption-metrics.js').write_text(
    '// Generated by tools/cssfont/build_webfont.py. Original spacing in native pixels.\n'
    'export const CAPTION_METRICS = ' + json.dumps(metrics, separators=(',', ':')) + ';\n')
