import { WIDTH, HEIGHT, PALETTE, CANDIDATE_COUNT, mixSeed, generateCandidate, scoreTile } from './generator.js';
export { generateStoneFromSeed } from './generator.js';

const seedInput = document.querySelector('#seedInput');
const randomButton = document.querySelector('#randomButton');
const generateButton = document.querySelector('#generateButton');
const zoomInput = document.querySelector('#zoomInput');
const zoomOutput = document.querySelector('#zoomOutput');
const tileCanvas = document.querySelector('#tileCanvas');
const proofCanvas = document.querySelector('#proofCanvas');
const wallCanvas = document.querySelector('#wallCanvas');
const styleMetric = document.querySelector('#styleMetric');
const seamMetric = document.querySelector('#seamMetric');
const masterMetric = document.querySelector('#masterMetric');
const variantMetric = document.querySelector('#variantMetric');
const repeatLabel = document.querySelector('#repeatLabel');
const pngButton = document.querySelector('#pngButton');
const svgButton = document.querySelector('#svgButton');
const status = document.querySelector('#status');
const paletteElement = document.querySelector('#palette');

let currentTile = null;
let currentVariant = 0;
let generationToken = 0;

if (paletteElement) {
  for (const tone of PALETTE) {
    const swatch = document.createElement('i');
    swatch.style.background = `rgb(${tone} ${tone} ${tone})`;
    swatch.title = `RGB ${tone}`;
    paletteElement.append(swatch);
  }
}

async function generate() {
  const token = ++generationToken;
  const parsed = Number.parseInt(seedInput.value, 10);
  const masterSeed = Number.isFinite(parsed) ? parsed >>> 0 : 64;
  seedInput.value = String(masterSeed);
  status.textContent = `Ranking ${CANDIDATE_COUNT} periodic candidates…`;
  status.dataset.state = 'busy';
  generateButton.disabled = true;
  randomButton.disabled = true;
  await new Promise((resolve) => requestAnimationFrame(resolve));

  let best = null;
  for (let index = 0; index < CANDIDATE_COUNT; index += 1) {
    const variant = mixSeed(masterSeed, index);
    const tile = generateCandidate(variant);
    const score = scoreTile(tile);
    if (!best || score.rank > best.score.rank) best = { tile, score, variant };
    if (index % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
    if (token !== generationToken) return;
  }

  currentTile = best.tile;
  currentVariant = best.variant;
  drawTile();
  drawProof();
  drawWall();
  styleMetric.textContent = `${best.score.style.toFixed(1)}%`;
  seamMetric.textContent = `${best.score.seam.toFixed(0)}%`;
  masterMetric.textContent = String(masterSeed);
  variantMetric.textContent = String(best.variant);
  status.textContent = 'Generated. No source pixels copied.';
  status.dataset.state = 'ready';
  generateButton.disabled = false;
  randomButton.disabled = false;
}

function imageDataForTile(tile) {
  const image = new ImageData(WIDTH, HEIGHT);
  for (let index = 0; index < tile.length; index += 1) {
    const destination = index * 4;
    image.data[destination] = tile[index];
    image.data[destination + 1] = tile[index];
    image.data[destination + 2] = tile[index];
    image.data[destination + 3] = 255;
  }
  return image;
}

export function stoneTileDataUrl(tile) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.putImageData(imageDataForTile(tile), 0, 0);
  return canvas.toDataURL('image/png');
}

function drawTile() {
  if (!currentTile) return;
  const context = tileCanvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.putImageData(imageDataForTile(currentTile), 0, 0);
}

function drawProof() {
  if (!currentTile) return;
  const context = proofCanvas.getContext('2d');
  const image = imageDataForTile(currentTile);
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, proofCanvas.width, proofCanvas.height);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      context.putImageData(image, x * WIDTH, y * HEIGHT);
    }
  }
}

function drawWall() {
  if (!currentTile) return;
  const zoom = Number.parseInt(zoomInput.value, 10);
  zoomOutput.textContent = `${zoom}×`;
  const cssWidth = Math.max(320, Math.round(wallCanvas.getBoundingClientRect().width));
  const cssHeight = Math.max(260, Math.round(wallCanvas.getBoundingClientRect().height));
  wallCanvas.width = cssWidth;
  wallCanvas.height = cssHeight;
  const context = wallCanvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#000';
  context.fillRect(0, 0, cssWidth, cssHeight);

  const native = document.createElement('canvas');
  native.width = WIDTH;
  native.height = HEIGHT;
  native.getContext('2d').putImageData(imageDataForTile(currentTile), 0, 0);
  const tileWidth = WIDTH * zoom;
  const tileHeight = HEIGHT * zoom;
  for (let y = 0; y < cssHeight; y += tileHeight) {
    for (let x = 0; x < cssWidth; x += tileWidth) {
      context.drawImage(native, x, y, tileWidth, tileHeight);
    }
  }
  repeatLabel.textContent = `${Math.ceil(cssWidth / tileWidth)} × ${Math.ceil(cssHeight / tileHeight)} repeats at ${zoom}×`;
}

function svgForTile(tile) {
  const counts = new Map(PALETTE.map((tone) => [tone, 0]));
  for (const tone of tile) counts.set(tone, counts.get(tone) + 1);
  const background = [...counts].sort((left, right) => right[1] - left[1])[0][0];
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" shape-rendering="crispEdges">`,
    '  <!-- Procedural toroidal stone; no source pixels. -->',
    `  <rect width="${WIDTH}" height="${HEIGHT}" fill="#${background.toString(16).padStart(2, '0').repeat(3)}"/>`,
  ];
  for (const tone of PALETTE) {
    if (tone === background) continue;
    const commands = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      let x = 0;
      while (x < WIDTH) {
        if (tile[y * WIDTH + x] !== tone) { x += 1; continue; }
        const start = x;
        while (x < WIDTH && tile[y * WIDTH + x] === tone) x += 1;
        const run = x - start;
        commands.push(`M${start} ${y}h${run}v1h-${run}z`);
      }
    }
    const hex = tone.toString(16).padStart(2, '0');
    lines.push(`  <path fill="#${hex}${hex}${hex}" d="${commands.join('')}"/>`);
  }
  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}

function download(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

if (randomButton && generateButton && seedInput && zoomInput && pngButton && svgButton) {
  randomButton.addEventListener('click', () => {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    seedInput.value = String(values[0]);
    generate();
  });

  generateButton.addEventListener('click', generate);
  seedInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') generate();
  });
  zoomInput.addEventListener('input', drawWall);
  window.addEventListener('resize', drawWall);

  pngButton.addEventListener('click', () => {
    if (!currentTile) return;
    tileCanvas.toBlob((blob) => {
      if (blob) download(blob, `stone-${seedInput.value}-${currentVariant}.png`);
    }, 'image/png');
  });

  svgButton.addEventListener('click', () => {
    if (!currentTile) return;
    download(
      new Blob([svgForTile(currentTile)], { type: 'image/svg+xml' }),
      `stone-${seedInput.value}-${currentVariant}.svg`,
    );
  });

  generate();
}
