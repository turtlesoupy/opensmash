// Extracted unchanged from OpenSmash visual/grid-replica.js. See README.md.
const CELL_W = 45, CELL_H = 43, RULE = 2;
const SCREENSHOT_BORDER_RGB = 'Ni4oOS8nOS0mNiojNSojLyMdKh8YKh8YKx8YKx8YLCAZLiMcMCUeNiskOy8oQTUuQjUuQjUuQjUuQjQuPjErOy4nNyskNiojOi0mOi4nOCskOCokNighNCcgLiIbMiYfNiojNiojNiojNiojNiojNiojNiojNiojNiojNyskOS0nOS0mNSkjMiYfMSYeLCAZMCQcLSEaKh8YKx8YMCUeNCkiNiojNiojNiojNiojNSojNSojNiojNiojNyskPTAqQjUuQjUuQDMsOi0mNyojNiojNiojNikiLB8ZLB8YLR8YLR8YLB8YLyIbLyMcMyghOCwmPjMsQTUuQTUuQTUuQTUuPzMtOzApOCwlNSojNyskOS0nOCwlNSojNyskNyskPC8mUj8yPS4kIBkUHxgTHhcTHxcTIxkUKBkWKRsXKRoXJhkUJhkUJxkWKhsVLxwXNxwZORsbPx0bPhsbPxsbPhwaOxsZNxwZNBsYNh0ZPx8bSiIfSiIeQyAcOR0YLx0XKBoXKBoVJxkXKRkXLBkXLxkXLRoXKxkWKBkWKBoWJxkUKBkXJhkWIhoTIhkSPS0iVkEzMSUdHxgTHxgTHhcTIBgTJBkVKBoVKRoXKBoWJhkTJhkUKBkWKhsVMhwZOBwZPBwbQR0cQRscQxscQxsbQRsaPBsaOhwZQBwaRxscSxwdSx0dSBwbPxwZMBsXJxkWJxkVJxkXKhkXLRkXLhoXLBoXKhkWKBkXKBoVJxkVKBkXJRkWIhoSJRsURzQpUDwwOS0lTDovNSceSDcsQTAmOSwkOi0mTDouNSceRjYrQTAmOCsjOS0lTDouNSceRjYrQTAmOCsjOi0lTDouNSceRjYrQTAmOCsjOS0lTDouNSceRjYrQTAmOCsjOi4lTDouNSceRjYrQTAmOCsjOS0lTDouNSceRjYrQTAmOCsjOSwkTDouNSceRjYrQTAmOCsjNysjTDouNSYeRjYrQTAmOCojOCsjTDouNSYeRjYrQTAmOCsjOS0lTDouNSceRjYrQTAmOCsjOSwlTDouNSceRjYrQTAmOCsjOSwlTDouNSceRjYrQTAmOCsjOSwkTDouNSceRjYrQTAmOCsjOS0mTDouNSceRjYrQTAmOiwjPDAnTDouNiceRzYrQTAmOy0kPTAoTDouNiceRzYrQTAmOy0kPi8oTDouNygfSDcsQTAmPS4lQTEqTTovOCggTzwwQjAmRTUrQy8qTjovPSwjV0AzQjAnbFlNRi8qUDovPCohXEI1RDAmc19RSC8oUDowQSsiXUM0RTEnaVVGTC8pUTowQyshXEI0RTEnY09AUC4rUTowQishXEM0RTEnX0s8Uy8rUjowQyohXEM0RjEnSzgtUy4qUzowQCohXUM0RzEnQzAoVC4pUzowPSkhXUM1RzAnQy8nVzArUzowPSkhXUM0RzEnRC8nVi8rUzowQCwkXUM0RzEnRS8nVS4qUzowRTEoXUM0RzEnRi8nVy8rUzowQCsjXkM1RzEnRi8nWTAsVDowPykhYEQ1RzEnRi8nWzErVDswQSkhYEQ1SDEnRy4nXTMrVTswRCohXkM1SDEnRy4nYTcsVjwwRywiXkM1STInSS8nYzsrVzwwSC0hX0Q1STMnSi8nZj0sWD0xSi4hX0M1SjMnSzAoaUEtWT4xSzAiXkM1SzQnSjEoa0MsWj4xTDAhXUQ1SzQnSjEoakMrWz8wTDEhXUQ2SzUnRzEnbEUqW0AwTTIgXUQ2SzUnRDIobEUrW0AwTDIhXkQ2SzUnQjEna0YtW0AwTDQmXUM1TDgqQTIoY0UuWkIxVDgsVzorWTwsXEAsXEMtV0Q8UUJCVD47YkAzakIwa0Iwa0EwaUIzZ0s8aFNEaVRGZ1FDYEs+WUQ3VkE1WUQ3WEM2VUA0VD8yUz4xUz0yUT0xTjoxSjczSjcwUTksUjgrUDYrTTMrTTQrTjMrTzQrTjQrTDMrSjQrSzMqTjQrUzUqVjkrVzwuUz4xWkM1YkQ2Y0U3ZEU4ZkY4ZkY4ZUY3ZUY3ZEU3Y0U3X0M2Vj8zXkA1Z0U5akg7akk8aUo9aUs9a00+a00+aks8aEc6ZkU5Z0g7alBCbFZIalFCaE4/Zkw+Y0o+YUo9Zkw+ak0/bE9Aa04/aks9ZUg6UTcuTTQrSzMrSjMqSzQqUDQrVDYrVjkrVT0vVD8yUD0wRjYqU0AyTjouPy4kPS0kPS0kPS0kPy4kQS4lQS8lQS4lQC4kQC4kQS4kQS8lQy4lRi8mRy4nSS8nSi4nSi8nSi8nSi4mSC8mRy4lSC8mSy8mTi4nTS4nTC8nSi4lRS8lQC4lQC4kQC4lQS4lQi4lQy4lQi4lQS4lQS4lQS4lQC4kQC4lQC4lPy4kPi4jSTUqVkE0SDYqPS0kPS0kPS0kPS0kQC4kQS8kQS4lQS4lQC4kQC4kQS4lQS8kRC4lRy8mRy4nSi8nSi4nSi8nSi4nSi4mRy4mRy8lSC4mTC4nTi4nTS8nTC8nSC4lRC4lQC4lQC4kQC4lQS4lQi4lQy4lQi4lQS4lQC4lQC4kQC4kQC4lQC4kPi4jPy4kTTktVUAyOy4mTz0wNygfTjsvQzInQzMpOi0mTDouNSceRjYrQTAmOCsjOy4mTDouNSceRjYrQTAmOCsjOi0lTDouNSceRjYrQTAmOCsjOS0kTDouNSceRjYrQTAmOCsjOi4lTDouNSceRjYrQTAmOCsjOy4nTDouNSceRjYrQTAmOCsjOi4lTDouNSceRjYrQTAmOCsjOS0lTDouNSceRjYrQTAmOCsjOi0mTDouNSYeRjYrQTAmOCsjOi0mTDouNSceRjYrQTAmOCsjOS0lTDouNSceRjYrQTAmOCsjOi4mTDouNSceRjYrQTAmOCsjOy8nTDouNSceRjYrQTAmOCsjOi0mTDouNSYeRjYrQTAmOCsjOS0lTDouNSYeRjYrQTAmOSsjOy4lTDouNScdRzYrQTAlOSsiOy4mTDouNSceRzYrQTAmOisjPi4oTTouNycfSDYsQjAmPSwkQS4oTTovOCcfUDwyQjAmQC0lQy4pTjovOScfXkdAQzAmQiwmRy4pUDovOycfYEhBRDAmQywmSzAqUDowPiggYUlCRTEnQy0mTi8qUTowPyghYUpCRTEnQy0lUS8qUjowQCggYUpCRjEnQy0mVDAsUjowQSghYUpCRjEnQy0mVTArUzowQighYEhBRjEnRC0nVi8pUzowQicgYUhCRzAnRS0mVi8rUzowQighYUlCRzEnRy0mVTAsUzowQighYElCRzEnSC0mVzAsUzowQighYEhBRzEnSS0mWC8rUzowQyghX0ZARzEnSi0nWjErVDowRCkhXkU/RzEnSy0nXTMrVTswRSkhXUQ+SDEnTC0oYDYtVjswRyshXEM9STInTi0nYTksVjwwRywiW0I8STInUC0oZDsrVzwwSS0hWkE7STMnUS4oaT8tWD4xSy8iWUA6SjQnUzAoakEsWj4xSzAhWD85SzQnVDIpa0MsWj8wTDAhVz85SzUnVTMobUYrWz8wTDEhVz44SzUnVjMobUUrW0AwTDIhVj44SzUnVjQobUYrW0AwTDIiVj43SzUoVjMoaEYuW0AwVzAkYjIhajsjdEcke1IlflsogGEtgWMvgWIvfl8qelcldVEjcU0ibUghZUIgYkEiZEkycWBTenBpe3Jrd25pc2tlbWVhZ2BcYFpVXFdSXFVRWVNPU05KTUdDR0E9Pjk1RTYxYzcufToufTouVyskQSEePSEeOiAePCEcRiEeUyUfXS8hXjYlTzotVj43VzA5WykjYSkiZyokbCwlbi0lcC0lci0mcy4mcy4mcy4mcS0mbiwlaCojYikgc0JIhFZrhlhuhlhuhlhuhVhuhFdtg1ZsgVVrf1NpfVFne09keExhdUpecUdbbURXakFTZT1OVzRAQiUkQSEeQyEeQyEePSAfOiAdPiEcSiIfVicgXjAiWjgnUDwwVDYrPi4jOCwkNSokNiokNiskNyskNywkNywkNywlNy0lMiggLCEaLiIbLCEZMyghOC4mPjQtOi8oNywmOC0oOC4pOC4pOC4oNy0oOzEsOC4pOjArNy4oNiwnNiwnNiwnNSwmNSsmNSsmNSslNyslOCslOCslNSolNSkkMygjLiMeKB0YKh4aNSkkOS4oNislNSslNismNiomNiolNyolNyolNyolNyolNyolNyolNyolNyolNyolNyolNyolNyolNiolOCwoOS0pOS0pOS0pOS0pOS0pOS0pOC0pOC0pOCwoOCwoOCwoNysnLiIeLiIeKyAcMSUhNiomPDEsOjAqNismNSkkNCkkNCkkNCkkNCkkNismOS0nNysmOS8oNSslNiol';

function fromBase64(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

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

function decodeReferenceRules() {
  const sourceWidth = 96;
  const sourceHeight = 92;
  const dst = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
  const border = fromBase64(SCREENSHOT_BORDER_RGB);
  let p = 0;
  for (let y = 0; y < sourceHeight; y++) for (let x = 0; x < sourceWidth; x++) {
    const xr = x < 2 || (x >= 47 && x < 49) || x >= 94;
    const yr = y < 2 || (y >= 45 && y < 47) || y >= 90;
    if (!xr && !yr) continue;
    put(dst, sourceWidth, x, y, border[p++], border[p++], border[p++]);
  }
  return dst;
}

function mapRuleSample(position, extent, cellSize, sourceExtent) {
  const stride = cellSize + RULE;
  if (position < RULE) return position;
  if (position >= extent - RULE) {
    return sourceExtent - RULE + position - (extent - RULE);
  }
  const local = position % stride;
  if (local < RULE) return stride + local;
  const tile = Math.floor(position / stride);
  return (tile & 1) ? stride + local : local;
}

// Repeat the calibrated 2x2 rule lattice across the larger board. Every
// boundary remains real code geometry, but its pixels come from the sampled
// frame treatment instead of a flat CSS color.
function renderRules(gridWidth, gridHeight, columns, cellCount) {
  const sourceWidth = 96;
  const sourceHeight = 92;
  const reference = decodeReferenceRules();
  const dst = new Uint8ClampedArray(gridWidth * gridHeight * 4);
  const xStride = CELL_W + RULE;
  const yStride = CELL_H + RULE;

  // The sample position depends on one axis only; resolve each axis once
  // instead of per pixel, and paint only the rule bands of each cell (about
  // a tenth of the board) rather than masking and scanning every pixel.
  const sourceX = new Uint16Array(gridWidth);
  for (let x = 0; x < gridWidth; x++) sourceX[x] = mapRuleSample(x, gridWidth, CELL_W, sourceWidth);
  const sourceY = new Uint16Array(gridHeight);
  for (let y = 0; y < gridHeight; y++) sourceY[y] = mapRuleSample(y, gridHeight, CELL_H, sourceHeight);

  const paintBand = (x0, y0, x1, y1) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(gridWidth, x1); y1 = Math.min(gridHeight, y1);
    for (let y = y0; y < y1; y++) {
      const rowSource = sourceY[y] * sourceWidth;
      for (let x = x0; x < x1; x++) {
        const source = (rowSource + sourceX[x]) * 4;
        put(
          dst, gridWidth, x, y,
          reference[source], reference[source + 1], reference[source + 2], reference[source + 3]
        );
      }
    }
  };

  for (let index = 0; index < cellCount; index++) {
    const left = (index % columns) * xStride;
    const top = Math.floor(index / columns) * yStride;
    const right = left + CELL_W + RULE * 2;
    const bottom = top + CELL_H + RULE * 2;
    paintBand(left, top, right, top + RULE);
    paintBand(left, bottom - RULE, right, bottom);
    paintBand(left, top + RULE, left + RULE, bottom - RULE);
    paintBand(right - RULE, top + RULE, right, bottom - RULE);
  }
  return dst;
}

// Wrap non-grid media in the very same sampled roster rule. The transparent
// center lets the media show through while the two native edge pixels retain
// the game's irregular, texture-derived color instead of becoming a flat CSS
// border.
function renderOuterRules(frameWidth, frameHeight) {
  const sourceWidth = 96;
  const sourceHeight = 92;
  const reference = decodeReferenceRules();
  const dst = new Uint8ClampedArray(frameWidth * frameHeight * 4);
  for (let y = 0; y < frameHeight; y++) for (let x = 0; x < frameWidth; x++) {
    const xr = x < RULE || x >= frameWidth - RULE;
    const yr = y < RULE || y >= frameHeight - RULE;
    if (!xr && !yr) continue;
    const sourceX = mapRuleSample(x, frameWidth, CELL_W, sourceWidth);
    const sourceY = mapRuleSample(y, frameHeight, CELL_H, sourceHeight);
    const source = (sourceY * sourceWidth + sourceX) * 4;
    put(
      dst, frameWidth, x, y,
      reference[source], reference[source + 1], reference[source + 2], reference[source + 3]
    );
  }
  return dst;
}

export { renderRules, renderOuterRules };
