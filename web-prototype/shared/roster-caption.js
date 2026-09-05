import { CAPTION_METRICS } from '../src/fonts/smash-caption-metrics.js';

export function normalizeCaption(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z. ]/g, '').trim();
}

// The original caption renderer's bearings, pair spacing, and selective
// tightening, using small generated metrics instead of runtime pixel data.
export function layoutCaption(text, cut, squeeze = 0) {
  const metrics = CAPTION_METRICS[cut];
  const chars = [...text];
  const tightened = new Set();
  if (squeeze) {
    const pairs = [];
    for (let i = 0; i + 1 < chars.length; i++) {
      if (!metrics.glyphs[chars[i]] || !metrics.glyphs[chars[i + 1]]) continue;
      pairs.push({ i, collision: metrics.collisions[chars[i] + chars[i + 1]] || 0 });
    }
    pairs.sort((a, b) => a.collision - b.collision || a.i - b.i);
    for (const pair of pairs.slice(0, squeeze)) tightened.add(pair.i);
  }
  const glyphs = [];
  let pen = 0;
  let right = 0;
  chars.forEach((ch, i) => {
    if (ch === ' ') { pen += metrics.space; return; }
    const glyph = metrics.glyphs[ch];
    if (!glyph) return;
    glyphs.push({ text: ch, x: pen });
    right = Math.max(right, pen + glyph.right);
    pen += (metrics.pairs[ch + chars[i + 1]] ?? glyph.advance) - (tightened.has(i) ? 1 : 0);
  });
  return { glyphs, width: right };
}

const fittedCaptions = new Map();
export function fitCaption(value, rightLimit = 43) {
  let text = normalizeCaption(value);
  const key = `${rightLimit}:${text}`;
  if (fittedCaptions.has(key)) return fittedCaptions.get(key);
  const letters = text.replace(/[^A-Z]/g, '').length;
  const done = (cut, squeeze, layout) => {
    const result = Object.freeze({ text, cut, squeeze, glyphs: layout.glyphs,
      originX: cut === 'regular' ? 4 : 3, width: layout.width, scale: 1, condensed: cut !== 'regular' });
    fittedCaptions.set(key, result);
    if (fittedCaptions.size > 2048) fittedCaptions.delete(fittedCaptions.keys().next().value);
    return result;
  };
  const fits = (cut, layout) => (cut === 'regular' ? 4 : 3) + layout.width <= rightLimit;
  const ladder = [['regular', 0], ['condensed', 0], ['condensed', 1], ['condensed', 2], ['narrow', 0]];
  for (const [cut, squeeze] of letters >= 8 ? ladder.slice(1) : ladder) {
    const layout = layoutCaption(text, cut, squeeze);
    if (fits(cut, layout)) return done(cut, squeeze, layout);
  }
  for (let squeeze = 1; squeeze < letters; squeeze++) {
    const layout = layoutCaption(text, 'narrow', squeeze);
    if (fits('narrow', layout)) return done('narrow', squeeze, layout);
  }
  const squeeze = Math.max(0, letters - 1);
  let layout = layoutCaption(text, 'narrow', squeeze);
  while (text && !fits('narrow', layout)) {
    text = text.slice(0, -1).trimEnd();
    layout = layoutCaption(text, 'narrow', squeeze);
  }
  return done('narrow', squeeze, layout);
}
