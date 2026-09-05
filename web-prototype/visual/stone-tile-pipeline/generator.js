const WIDTH = 64;
const HEIGHT = 32;
const CANDIDATE_COUNT = 96;
const PALETTE = [0, 8, 16, 24, 33, 41, 49, 57];
const PROBABILITIES = [
  0.1611328125,
  0.0556640625,
  0.1103515625,
  0.4912109375,
  0.083984375,
  0.04638671875,
  0.0341796875,
  0.01708984375,
];
const TARGET = {
  mean: 21.322265625,
  std: 12.9281235778,
  dx: 4.4890873016,
  dy: 13.3946572581,
  dxNonzero: 0.3640873016,
  dyNonzero: 0.6965725806,
  dxStrong: 0.1438492063,
  dyStrong: 0.4697580645,
  rowRun: 2.6736292428,
  columnRun: 1.4163208852,
};

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6D2B79F5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function mixSeed(master, index) {
  let value = (master ^ Math.imul(index + 1, 0x9E3779B1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85EBCA6B) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xC2B2AE35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function randomBetween(rng, low, high) {
  return low + (high - low) * rng();
}

function randomInteger(rng, low, high) {
  return low + Math.floor(rng() * (high - low + 1));
}

function periodicNoise(rng, profile) {
  const output = new Float64Array(WIDTH * HEIGHT);
  for (let wave = 0; wave < profile.waves; wave += 1) {
    let kx = randomInteger(rng, profile.kx[0], profile.kx[1]);
    let ky = randomInteger(rng, profile.ky[0], profile.ky[1]);
    if (kx === 0 && ky === 0) ky = 1;
    const phase = rng() * Math.PI * 2;
    const amplitude = randomBetween(rng, 0.62, 1.24)
      / (1 + kx * profile.xFalloff + ky * profile.yFalloff);
    for (let y = 0; y < HEIGHT; y += 1) {
      const yPhase = Math.PI * 2 * ky * y / HEIGHT;
      for (let x = 0; x < WIDTH; x += 1) {
        output[y * WIDTH + x] += amplitude * Math.cos(
          Math.PI * 2 * kx * x / WIDTH + yPhase + phase,
        );
      }
    }
  }

  let mean = 0;
  for (const value of output) mean += value;
  mean /= output.length;
  let variance = 0;
  for (const value of output) variance += (value - mean) ** 2;
  const standardDeviation = Math.sqrt(variance / output.length) || 1;
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (output[index] - mean) / standardDeviation;
  }
  return output;
}

function wrapped(array, x, y) {
  return array[((y + HEIGHT) % HEIGHT) * WIDTH + ((x + WIDTH) % WIDTH)];
}

function periodicDelta(value, center, period) {
  return ((value - center + period * 1.5) % period) - period / 2;
}

function chiselField(rng) {
  const output = new Float64Array(WIDTH * HEIGHT);
  const strokeCount = randomInteger(rng, 6, 9);
  for (let stroke = 0; stroke < strokeCount; stroke += 1) {
    const centerX = rng() * WIDTH;
    const centerY = rng() * HEIGHT;
    const radiusX = randomBetween(rng, 5, 12);
    const radiusY = randomBetween(rng, 1.2, 2.8);
    const slope = randomBetween(rng, -.05, .05);
    const depth = randomBetween(rng, .7, 1.45);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const dx = periodicDelta(x, centerX, WIDTH);
        const dy = periodicDelta(y, centerY + slope * dx, HEIGHT);
        const shape = (Math.abs(dx) / radiusX) ** 4 + (dy / radiusY) ** 2;
        if (shape >= 1) continue;
        const core = 1 - shape;
        output[y * WIDTH + x] -= depth * (.58 + .42 * core);
      }
    }
  }
  return output;
}

function plateField(rng) {
  const output = new Float64Array(WIDTH * HEIGHT);
  const plateCount = randomInteger(rng, 4, 7);
  for (let plate = 0; plate < plateCount; plate += 1) {
    const centerX = rng() * WIDTH;
    const centerY = rng() * HEIGHT;
    const radiusX = randomBetween(rng, 7, 17);
    const radiusY = randomBetween(rng, 2.5, 6);
    const slope = randomBetween(rng, -.045, .045);
    const height = randomBetween(rng, .55, 1.15);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const dx = periodicDelta(x, centerX, WIDTH);
        const dy = periodicDelta(y, centerY + slope * dx, HEIGHT);
        const shape = (Math.abs(dx) / radiusX) ** 4 + (Math.abs(dy) / radiusY) ** 4;
        if (shape >= 1) continue;
        output[y * WIDTH + x] += height * (.46 + .54 * (1 - shape));
      }
    }
  }
  return output;
}

function quantize(field) {
  const order = Array.from({ length: field.length }, (_, index) => index);
  order.sort((left, right) => field[left] - field[right] || left - right);
  const counts = PROBABILITIES.map((probability) => Math.floor(probability * field.length));
  counts[3] += field.length - counts.reduce((sum, count) => sum + count, 0);
  const output = new Uint8Array(field.length);
  let cursor = 0;
  for (let paletteIndex = 0; paletteIndex < counts.length; paletteIndex += 1) {
    for (let index = 0; index < counts[paletteIndex]; index += 1) {
      output[order[cursor]] = PALETTE[paletteIndex];
      cursor += 1;
    }
  }
  return output;
}

function generateCandidate(seed) {
  const rng = mulberry32(seed);
  const broad = periodicNoise(rng, { waves: 8, kx: [0, 2], ky: [1, 2], xFalloff: .55, yFalloff: .34 });
  const strata = periodicNoise(rng, { waves: 10, kx: [0, 3], ky: [2, 7], xFalloff: .42, yFalloff: .11 });
  const detail = periodicNoise(rng, { waves: 8, kx: [1, 6], ky: [2, 8], xFalloff: .18, yFalloff: .08 });
  const warp = periodicNoise(rng, { waves: 8, kx: [0, 2], ky: [1, 4], xFalloff: .56, yFalloff: .22 });
  const chisels = chiselField(rng);
  const plates = plateField(rng);
  const field = new Float64Array(WIDTH * HEIGHT);
  const courseSize = randomBetween(rng, 8, 12);
  const fineCourse = randomBetween(rng, 5.5, 7.5);
  const broadWeight = randomBetween(rng, .06, .12);
  const strataWeight = randomBetween(rng, .12, .22);
  const detailWeight = randomBetween(rng, .12, .20);
  const chiselWeight = randomBetween(rng, .80, 1.10);
  const plateWeight = randomBetween(rng, .65, .90);
  const bandWeight = randomBetween(rng, .03, .08);
  const warpA = randomBetween(rng, .08, .15);
  const warpB = randomBetween(rng, .03, .08);
  const bandB = randomBetween(rng, .18, .32);
  const offset = randomBetween(rng, 0, 2);

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x;
      const band = Math.sin(Math.PI * 2 * (y / courseSize + warpA * warp[index]));
      const fineBand = bandB * Math.sin(
        Math.PI * 2 * (y / fineCourse + warpB * warp[index] + offset),
      );
      field[index] = broadWeight * broad[index]
        + strataWeight * strata[index]
        + detailWeight * detail[index]
        + chiselWeight * chisels[index]
        + plateWeight * plates[index]
        + bandWeight * (band + fineBand);
    }
  }

  const lightY = randomBetween(rng, 4.5, 6.5);
  const lightX = randomBetween(rng, .04, .11);
  const relief = new Float64Array(field.length);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x;
      relief[index] = field[index]
        + lightY * (wrapped(field, x, y - 1) - wrapped(field, x, y + 1))
        + lightX * (wrapped(field, x - 1, y) - wrapped(field, x + 1, y));
    }
  }
  return quantize(relief);
}

function meanRunLength(tile, transpose = false) {
  const lineCount = transpose ? WIDTH : HEIGHT;
  const lineLength = transpose ? HEIGHT : WIDTH;
  let total = 0;
  let runs = 0;
  for (let line = 0; line < lineCount; line += 1) {
    let start = 0;
    for (let index = 1; index <= lineLength; index += 1) {
      const get = (position) => transpose
        ? tile[position * WIDTH + line]
        : tile[line * WIDTH + position];
      if (index === lineLength || get(index) !== get(start)) {
        total += index - start;
        runs += 1;
        start = index;
      }
    }
  }
  return total / runs;
}

function metrics(tile) {
  let sum = 0;
  for (const value of tile) sum += value;
  const mean = sum / tile.length;
  let variance = 0;
  for (const value of tile) variance += (value - mean) ** 2;
  let dx = 0;
  let dy = 0;
  let dxNonzero = 0;
  let dyNonzero = 0;
  let dxStrong = 0;
  let dyStrong = 0;
  const xCount = HEIGHT * (WIDTH - 1);
  const yCount = (HEIGHT - 1) * WIDTH;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH - 1; x += 1) {
      const difference = Math.abs(tile[y * WIDTH + x + 1] - tile[y * WIDTH + x]);
      dx += difference;
      dxNonzero += difference > 0 ? 1 : 0;
      dxStrong += difference >= 16 ? 1 : 0;
    }
  }
  for (let y = 0; y < HEIGHT - 1; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const difference = Math.abs(tile[(y + 1) * WIDTH + x] - tile[y * WIDTH + x]);
      dy += difference;
      dyNonzero += difference > 0 ? 1 : 0;
      dyStrong += difference >= 16 ? 1 : 0;
    }
  }
  let wrapX = 0;
  let wrapY = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    wrapX += Math.abs(tile[y * WIDTH] - tile[y * WIDTH + WIDTH - 1]);
  }
  for (let x = 0; x < WIDTH; x += 1) {
    wrapY += Math.abs(tile[x] - tile[(HEIGHT - 1) * WIDTH + x]);
  }
  return {
    mean,
    std: Math.sqrt(variance / tile.length),
    dx: dx / xCount,
    dy: dy / yCount,
    dxNonzero: dxNonzero / xCount,
    dyNonzero: dyNonzero / yCount,
    dxStrong: dxStrong / xCount,
    dyStrong: dyStrong / yCount,
    rowRun: meanRunLength(tile),
    columnRun: meanRunLength(tile, true),
    wrapX: wrapX / HEIGHT,
    wrapY: wrapY / WIDTH,
  };
}

function similarity(value, target, scale) {
  return Math.exp(-Math.abs(value - target) / scale);
}

function scoreTile(tile) {
  const value = metrics(tile);
  const features = [
    ['mean', 1, 3], ['std', 1, 3],
    ['dx', 2, 1.8], ['dy', 2, 3],
    ['dxNonzero', 1.5, .1], ['dyNonzero', 1.5, .1],
    ['dxStrong', 1.5, .07], ['dyStrong', 1.5, .09],
    ['rowRun', 1.5, .75], ['columnRun', 1.5, .4],
  ];
  let weighted = 3; // palette histogram is exact by construction
  let weights = 3;
  for (const [name, weight, scale] of features) {
    weighted += weight * similarity(value[name], TARGET[name], scale);
    weights += weight;
  }
  const style = 100 * weighted / weights;
  const seamX = value.wrapX <= Math.max(value.dx * 1.8, 1);
  const seamY = value.wrapY <= Math.max(value.dy * 1.8, 1);
  const seam = seamX && seamY ? 100 : 90;
  return { style, seam, metrics: value, rank: style * .92 + seam * .08 };
}

export function generateStoneFromSeed(seed, candidateCount = CANDIDATE_COUNT) {
  const parsed = Number.parseInt(seed, 10);
  const masterSeed = Number.isFinite(parsed) ? parsed >>> 0 : 64;
  const count = Math.max(1, Math.floor(candidateCount));
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const variant = mixSeed(masterSeed, index);
    const tile = generateCandidate(variant);
    const score = scoreTile(tile);
    if (!best || score.rank > best.score.rank) best = { tile, score, variant };
  }
  return { ...best, masterSeed };
}


export { WIDTH, HEIGHT, PALETTE, CANDIDATE_COUNT, mixSeed, generateCandidate, scoreTile };
