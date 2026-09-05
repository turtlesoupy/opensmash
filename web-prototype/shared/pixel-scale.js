export function scalePixels2x(pixels, width, height, smooth) {
  const scaledWidth = width * 2;
  const scaledHeight = height * 2;
  const scaled = new Uint8ClampedArray(scaledWidth * scaledHeight * 4);
  for (let y = 0; y < scaledHeight; y++) for (let x = 0; x < scaledWidth; x++) {
    const sourceX = x >> 1;
    const sourceY = y >> 1;
    const target = (y * scaledWidth + x) * 4;
    const source = (sourceY * width + sourceX) * 4;
    if (!smooth) {
      for (let channel = 0; channel < 4; channel++) scaled[target + channel] = pixels[source + channel];
      continue;
    }
    const nextX = Math.min(width - 1, sourceX + 1);
    const nextY = Math.min(height - 1, sourceY + 1);
    const fx = (x & 1) * 0.5;
    const fy = (y & 1) * 0.5;
    // No per-pixel arrays, iterators, or typed-array views. Most of a caption
    // tile is transparent; skip those quads before doing any interpolation.
    const right = (sourceY * width + nextX) * 4;
    const below = (nextY * width + sourceX) * 4;
    const diagonal = (nextY * width + nextX) * 4;
    if (!(pixels[source + 3] || pixels[right + 3] || pixels[below + 3] || pixels[diagonal + 3])) continue;
    const a = pixels[source + 3] / 255 * ((1 - fx) * (1 - fy));
    const b = pixels[right + 3] / 255 * (fx * (1 - fy));
    const c = pixels[below + 3] / 255 * ((1 - fx) * fy);
    const d = pixels[diagonal + 3] / 255 * (fx * fy);
    const alpha = a + b + c + d;
    if (alpha > 0) {
      for (let channel = 0; channel < 3; channel++) {
        scaled[target + channel] = Math.round((
          pixels[source + channel] * a + pixels[right + channel] * b +
          pixels[below + channel] * c + pixels[diagonal + channel] * d
        ) / alpha);
      }
      scaled[target + 3] = Math.round(alpha * 255);
    }
  }
  return Object.freeze({ width: scaledWidth, height: scaledHeight, pixels: scaled });
}
