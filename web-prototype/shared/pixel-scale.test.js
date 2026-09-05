import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scalePixels2x } from './pixel-scale.js';

// Golden bytes from the original scaler, including transparent pixels with
// nonzero RGB, translucent edges, and clamped bottom/right boundaries.
const cases = [
  [1, 1, false, 'af7040e9103a996fd9bc7d416b4ed7008483ddcd4e77ded2f26bf694a6232093'],
  [1, 1, true, '374708fff7719dd5979ec875d56cd2286f6d3cf7ec317a3b25632aab28ec37bb'],
  [2, 2, false, 'bd871320c9af862e62aa84b6b31ad161ee9878a7bcd54d9ce8193dbd2b41a1f8'],
  [2, 2, true, 'adde17ac08e1b40415ffcf51f1c27676af0b7b7d15fc7c74784d181e0f187271'],
  [45, 43, false, 'c65c5c23dadcb53171159581f7d0d54f9d43cff66c3b7481a9c7475eda317602'],
  [45, 43, true, '9cb61f741a113211a5eeb527209eb6d4cbc430c93a2902ffb0918dfd09f33b9e'],
];
for (const [width, height, smooth, expected] of cases) {
  test(`scaling preserves ${width}x${height} pixels (smooth=${smooth})`, () => {
    let seed = 7;
    const pixels = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return i % 4 === 3 && i % 3 === 0 ? 0 : seed >>> 24;
    });
    const result = scalePixels2x(pixels, width, height, smooth);
    assert.equal(result.width, width * 2);
    assert.equal(result.height, height * 2);
    assert.equal(createHash('sha256').update(result.pixels).digest('hex'), expected);
  });
}
