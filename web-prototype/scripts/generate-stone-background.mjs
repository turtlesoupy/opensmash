// Rebuild the production background without running texture synthesis on clients.
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { WIDTH, HEIGHT, generateStoneFromSeed } from '../visual/stone-tile-pipeline/generator.js';

const { tile, variant } = generateStoneFromSeed(3075641479, 96);
function chunk(type, bytes) {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(payload.length + 8);
  result.writeUInt32BE(bytes.length);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // 8-bit grayscale, no alpha; every source pixel is opaque.
const scanlines = Buffer.alloc((WIDTH + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y++) scanlines.set(tile.slice(y * WIDTH, (y + 1) * WIDTH), y * (WIDTH + 1) + 1);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0)),
]);
await writeFile(new URL('../visual/assets/stone-background.png', import.meta.url), png);
console.log(`Baked stone variant ${variant}: ${png.length} bytes`);
