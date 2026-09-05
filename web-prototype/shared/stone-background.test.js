import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { generateStoneFromSeed } from '../visual/stone-tile-pipeline/generator.js';

// Original runtime output for seed 3075641479, ranked over 96 candidates.
const expected = '2061e68ef6d324e9adaad37410ff2ed4639bda8f795674da38ca06f0601fdfa3';
test('baked stone background preserves the runtime-generated pixels', () => {
  const png = readFileSync(new URL('../visual/assets/stone-background.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 32);
  const data = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(64 * 32);
  for (let y = 0; y < 32; y++) {
    assert.equal(rows[y * 65], 0); // The generator writes unfiltered scanlines.
    rows.copy(pixels, y * 64, y * 65 + 1, (y + 1) * 65);
  }
  assert.equal(createHash('sha256').update(pixels).digest('hex'), expected);
  const generated = generateStoneFromSeed(3075641479, 96);
  assert.equal(generated.variant, 2873105901);
  assert.deepEqual(Buffer.from(generated.tile), pixels);
});
