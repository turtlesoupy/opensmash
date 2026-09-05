// Bake eight frames per tile; clients only animate a transform.
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { scalePixels2x } from '../shared/pixel-scale.js';
const CELL_W = 45, CELL_H = 43;
const STONE_BACKGROUND_SEED = 3075641479;
const STATIC_BLEND = 0x30 / 255;
function put(dst, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width || y >= dst.length / 4 / width) return;
  const i = (y * width + x) * 4;
  if (a === 255) { dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = 255; return; }
  if (a === 0) return;
  const sourceAlpha = a / 255;
  const destinationAlpha = dst[i + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  const destinationWeight = destinationAlpha * (1 - sourceAlpha);
  dst[i] = Math.round((r * sourceAlpha + dst[i] * destinationWeight) / outputAlpha);
  dst[i + 1] = Math.round((g * sourceAlpha + dst[i + 1] * destinationWeight) / outputAlpha);
  dst[i + 2] = Math.round((b * sourceAlpha + dst[i + 2] * destinationWeight) / outputAlpha);
  dst[i + 3] = Math.round(outputAlpha * 255);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function renderActionCellBackground(seed) {
  const random = seededRandom(seed);
  const pixels = new Uint8ClampedArray(CELL_W * CELL_H * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    const grain = random();
    const tone = grain < 0.08
      ? 3 + Math.floor(random() * 2)
      : grain > 0.92
        ? 14 + Math.floor(random() * 10)
        : 6 + Math.floor(random() * 5);
    pixels[index] = tone;
    pixels[index + 1] = Math.max(0, tone - 1);
    pixels[index + 2] = Math.max(0, tone - 2);
    pixels[index + 3] = 255;
  }
  return pixels;
}

const ACTION_CELL_BACKGROUND_PIXELS = Object.freeze({
  search: renderActionCellBackground(STONE_BACKGROUND_SEED),
  create: renderActionCellBackground(STONE_BACKGROUND_SEED ^ 0x9E3779B9),
});

function drawActionStatic(pixels, random) {
  const baseTone = 22;
  const baseAlpha = 0.48;
  for (let y = 1; y < CELL_H - 1; y++) for (let x = 1; x < CELL_W - 1; x++) {
    const noise = random() * 255;
    const tone = Math.round(baseTone + (noise - baseTone) * STATIC_BLEND * 1.6);
    const alpha = Math.round(255 * (baseAlpha + (baseAlpha - noise / 255) * STATIC_BLEND));
    put(pixels, CELL_W, x, y, tone, tone, tone, Math.max(0, Math.min(255, alpha)));
  }
}

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

for (const kind of ['search', 'create']) {
  const width = CELL_W * 2 * 8, height = CELL_H * 2;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  const random = seededRandom(kind === 'search' ? 1234567 : 7654321);
  for (let index = 0; index < 8; index++) {
    const native = new Uint8ClampedArray(ACTION_CELL_BACKGROUND_PIXELS[kind]);
    drawActionStatic(native, random);
    const frame = scalePixels2x(native, CELL_W, CELL_H, false);
    for (let y = 0; y < height; y++) {
      scanlines.set(frame.pixels.subarray(y * frame.width * 4, (y + 1) * frame.width * 4),
        y * (width * 4 + 1) + 1 + index * frame.width * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(new URL(`../visual/assets/action-static-${kind}.png`, import.meta.url), png);
  console.log(`${kind}: ${png.length} bytes`);
}
