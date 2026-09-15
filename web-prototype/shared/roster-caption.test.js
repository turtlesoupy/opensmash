import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCaption, layoutCaption, normalizeCaption } from './roster-caption.js';
import { layoutText, glyphSet } from '../src/fonts/ssb-name-font.js';

test('short captions keep the regular font and natural size', () => {
  const caption = fitCaption('Trump');
  assert.equal(caption.text, 'TRUMP');
  assert.equal(caption.cut, 'regular');
  assert.equal(caption.scale, 1);
});

test('Smash 64 fits with matching digits at the original cap height', () => {
  const caption = fitCaption('Smash 64');
  assert.equal(caption.text, 'SMASH 64');
  assert.equal(caption.cut, 'condensed');
  assert.equal(caption.scale, 1);
  assert.equal(caption.squeeze, 0);
  assert.deepEqual(caption.glyphs.slice(-2).map(glyph => glyph.text), ['6', '4']);
  assert.ok(caption.originX + caption.width <= 43);
  for (const cut of ['regular', 'condensed', 'narrow']) {
    const digits = layoutCaption('64', cut);
    assert.equal(digits.glyphs.length, 2);
    assert.ok(Number.isFinite(digits.width) && digits.width > 0);
  }
});

test('long captions fit the tile without reducing their cap height', () => {
  for (const name of ['EINSTEIN', 'JIGGLYPUFF', 'SCHWARZENEGGER', 'THE WINGED VICTORY OF SAMOTHRACE', 'WWWWWWWWWWWWWWWWWWWWWW']) {
    const caption = fitCaption(name);
    assert.ok(caption.text.length > 0);
    assert.ok(caption.scale >= 0.78 && caption.scale <= 1);
    assert.ok(caption.originX + caption.width <= 43);
    assert.ok(name.startsWith(caption.text));
  }
});

test('labels normalize consistently and handle empty input', () => {
  assert.equal(normalizeCaption(' Mr. T! '), 'MR. T');
  assert.equal(fitCaption(null).text, '');
  assert.equal(fitCaption('').width, 0);
  assert.ok(Number.isFinite(fitCaption('').scale));
});

test('fitting is synchronous, stable, and respects an alternate right edge', () => {
  const caption = fitCaption('EINSTEIN', 30);
  assert.equal(caption, fitCaption('einstein', 30));
  assert.ok(caption.originX + caption.width <= 30);
  assert.ok(Object.isFrozen(caption));
});

// These are the original renderer's fitted labels, not the first outline
// webfont's widened advances or horizontally scaled approximations.
test('original caption cuts, widths, and selective spacing are preserved', () => {
  for (const [input, text, cut, squeeze, width] of [
    ['TRUMP', 'TRUMP', 'regular', 0, 31],
    ['OBAMA', 'OBAMA', 'regular', 0, 34],
    ['SEARCH', 'SEARCH', 'regular', 0, 34],
    ['MARILYN', 'MARILYN', 'regular', 0, 39],
    ['SNOOPDOGG', 'SNOOPDOGG', 'narrow', 0, 36],
    ['EINSTEIN', 'EINSTEIN', 'condensed', 0, 30],
    ['SHAKESPEARE', 'SHAKESPEARE', 'narrow', 3, 40],
    ['SCHWARZENEGGER', 'SCHWARZENEGG', 'narrow', 13, 39],
  ]) {
    const actual = fitCaption(input);
    assert.deepEqual([actual.text, actual.cut, actual.squeeze, actual.width], [text, cut, squeeze, width]);
  }
});

test('lightweight metrics reproduce the original glyph layout', () => {
  for (const cut of ['regular', 'condensed', 'narrow']) {
    for (const text of ['TRUMP', 'MARILYN', 'SNOOPDOGG', 'SHAKESPEARE', 'MR. T', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
      for (const squeeze of [0, 1, 2, 5]) {
        const original = layoutText(text, { exact: false, cut, squeeze });
        const actual = layoutCaption(text, cut, squeeze);
        assert.deepEqual(actual.glyphs, original.glyphs.map(({ id, x }) => ({ text: id, x })));
        const table = glyphSet(cut);
        assert.equal(actual.width, Math.max(...original.glyphs.map(({ id, x }) => x + table[id].ox + table[id].w)) - 2);
      }
    }
  }
});
