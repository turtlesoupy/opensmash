// Responsive extension of the supplied OpenSmash character grid. Portraits
// are native lazy images; captions are native text using small shared fonts.
// Only generated/featured fighters are drawn — the original game's portraits are never bundled or
// served by the site (VANILLA_ROSTER below is metadata only: fkind order and
// labels).

import searchStaticUrl from './assets/action-static-search.png?url';
import createStaticUrl from './assets/action-static-create.png?url';
import { fitCaption } from '../shared/roster-caption.js';
import { loadCaptionFonts } from '../shared/caption-font-loading.js';
import {
  rosterGridDimensions,
} from '../shared/roster-layout.js';
import { formatFighterJobCellError } from '../shared/fighter-job-ui.js';
import { isPageScrollLocked, onPageScrollUnlock } from '../shared/page-scroll-lock.js';

// Reveal the whole roster's names together, without flashing a different font.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('captionFallback')) {
  document.documentElement.dataset.captionFont = 'fallback';
} else {
  document.documentElement.dataset.captionFont = 'loading';
  void loadCaptionFonts(document.fonts).then(state => {
    document.documentElement.dataset.captionFont = state;
  });
}

const ACTION_ICON_ASSETS = import.meta.glob('./assets/ui/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

function actionIconUrl(fileName) {
  return ACTION_ICON_ASSETS[`./assets/ui/${fileName}`] || '';
}

const CELL_W = 45;
const CELL_H = 43;
const RULE = 2;
// Shared menu cells use the same compressed height as the former control strip.
const FLAME_BRIDGE_HEIGHT_SCALE = 47 / 552;
const GRID_COLUMN_BREAKPOINTS = Object.freeze([
  { minWidth: 800, columns: 8 },
  { minWidth: 640, columns: 6 },
  { minWidth: 0, columns: 4 }
]);
const RASTER_SCALE = 2;

// `::search-text:current` (the active find-in-page match) can't live in
// site-shell.css: Lightning CSS refuses the selector and fails the build.
// Insert it through the CSSOM instead, which browsers without the feature
// simply reject.
function installFindCurrentRule() {
  try {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('.replica-find-word::search-text:current { background-color: rgba(255, 128, 44, .7); }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // No ::search-text:current support (or no constructable sheets): the
    // plain ::search-text highlight still applies.
  }
}
installFindCurrentRule();
const RANDOM_NAME_POOL = Object.freeze([
  'ALEX', 'AMIR', 'ANNA', 'ARIA', 'ASH', 'AVA', 'BEAU', 'BEN',
  'BLAKE', 'CARA', 'CHLOE', 'COLE', 'DARA', 'DEV', 'ELI', 'ELLA',
  'EMMA', 'EVAN', 'FINN', 'FREYA', 'GABE', 'GRACE', 'HANA', 'HUGO',
  'IAN', 'IRIS', 'IVAN', 'JADE', 'JAMES', 'JAX', 'JOEL', 'JUNE',
  'KAI', 'KIRA', 'LEAH', 'LEO', 'LIAM', 'LILA', 'LUCA', 'MARA',
  'MAYA', 'MILO', 'MINA', 'NASH', 'NIA', 'NICO', 'NOAH', 'NORA',
  'OMAR', 'OPAL', 'OWEN', 'RAFA', 'REMI', 'RHEA', 'RILEY', 'ROSE',
  'SAM', 'SANA', 'SASHA', 'THEO', 'UMA', 'VERA', 'WILL', 'ZARA'
]);
const VANILLA_ROSTER = Object.freeze([
  { asset: 'mario', portrait: 'mario', label: 'MARIO', name: 'Mario' },
  { asset: 'fox', portrait: 'fox', label: 'FOX', name: 'Fox' },
  { asset: 'dk', portrait: 'dk', label: 'DK', name: 'Donkey Kong' },
  { asset: 'samus', portrait: 'samus', label: 'SAMUS', name: 'Samus' },
  { asset: 'luigi', portrait: 'luigi', label: 'LUIGI', name: 'Luigi' },
  { asset: 'link', portrait: 'link', label: 'LINK', name: 'Link' },
  { asset: 'yoshi', portrait: 'yoshi', label: 'YOSHI', name: 'Yoshi' },
  { asset: 'captain', portrait: 'falcon', label: 'C.FALCON', name: 'Captain Falcon' },
  { asset: 'kirby', portrait: 'kirby', label: 'KIRBY', name: 'Kirby' },
  { asset: 'pikachu', portrait: 'pikachu', label: 'PIKACHU', name: 'Pikachu' },
  { asset: 'purin', portrait: 'jigglypuff', label: 'JIGGLYPUFF', name: 'Jigglypuff' },
  { asset: 'ness', portrait: 'ness', label: 'NESS', name: 'Ness' }
]);
const APP_BRIDGE = window.openSmashReactBridge;
// Older fighter metadata stored captions pre-cut to 7-10 letters ("EINSTEI",
// "SHAKESPEAR"). When such a short is just the start of a word in the full
// name, use the whole word; the caption fitter now picks a cut that holds it.
function expandShortLabel(short, name) {
  const s = String(short || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return name || '';
  const words = String(name || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const word = words.find(w => w.length > s.length && w.startsWith(s));
  return word || short;
}

function liveRosterCharacter(character) {
  return {
    asset: character.slug,
    portrait: `live:${character.slug}`,
    // The server points `portrait` at the 90x86 tile derivative; a job that
    // predates the derivatives still resolves to a usable portrait.
    portraitUrl: character.portraitTile || character.portrait,
    label: expandShortLabel(character.short, character.name) || character.name,
    name: character.name,
    nameFull: character.nameFull || '',
    source: character.generated ? 'generated' : 'live',
    fkind: character.fkind,
    bundle: character.bundle,
    visibility: character.visibility || 'public',
    // The viewer's own fighters (their jobs, or private ones only they can
    // see) sort to the top of the roster.
    mine: Boolean(character.mine || character.visibility === 'private'),
  };
}

// The viewer's own fighters get a small "manage" control (opens the job
// details, where delete lives). It sits on top of the tile and must not
// trigger the tile's own select.
function setCellManageControl(button, slug, mine) {
  let control = button.querySelector('.replica-manage-button');
  if (!mine) {
    control?.remove();
    return;
  }
  if (!control) {
    control = document.createElement('button');
    control.type = 'button';
    control.className = 'replica-manage-button';
    control.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 3-.5 3-2 1-2.8-1-2 3.5L4 11v2l-2.3 1.5 2 3.5 2.8-1 2 1 .5 3h4l.5-3 2-1 2.8 1 2-3.5L18 13v-2l2.3-1.5-2-3.5-2.8 1-2-1L13 3Z"/><circle cx="11" cy="12" r="3"/></svg>';
    control.addEventListener('click', event => {
      event.stopPropagation();
      event.preventDefault();
      APP_BRIDGE?.manageFighter?.(control.dataset.slug);
    });
    button.append(control);
  }
  control.dataset.slug = slug;
  control.title = 'Character settings';
  control.setAttribute('aria-label', `Manage ${button.dataset.displayName || slug}`);
}

// Private fighters (visible only to their uploader) get a small padlock badge
// so the owner can tell them apart from the public roster at a glance.
function setCellVisibility(button, visibility) {
  const isPrivate = visibility === 'private';
  let badge = button.querySelector('.replica-private-badge');
  if (isPrivate && !badge) {
    badge = document.createElement('span');
    badge.className = 'replica-private-badge';
    badge.title = 'Private: only you can see this fighter';
    badge.setAttribute('aria-hidden', 'true');
    button.append(badge);
  } else if (!isPrivate && badge) {
    badge.remove();
  }
  if (isPrivate) button.dataset.visibility = 'private';
  else delete button.dataset.visibility;
}
const LIVE_ROSTER = Object.freeze((APP_BRIDGE?.characters || []).map(liveRosterCharacter));
const INITIAL_FIGHTER_JOBS = APP_BRIDGE?.fighterJobs || [];
// React supplies the manifest-backed roster. If it has not mounted yet the
// grid starts empty and syncCharacters fills it without a second roster source.
const ROSTER = Object.freeze([...new Map(
  LIVE_ROSTER.map(character => [character.asset, character])
).values()]);
const CELL_COUNT = ROSTER.length + 2;
const CELL_IDS = Object.freeze(Array.from(
  { length: CELL_COUNT }, (_, index) => `CELL-${String(index + 1).padStart(3, '0')}`
));

function rosterCharacterForIndex(index) {
  return ROSTER[index];
}
// RGB samples from the supplied screenshot after resolving it to the native
// 96x92 grid. Only the six vertical and six horizontal 2px rule lanes are
// stored; portrait and fire pixels are not present in this border program.
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

function sharedPanelRuleSample(position, extent, segments, internalStart, sourceExtent) {
  if (position < RULE) return position;
  if (position >= extent - RULE) {
    return sourceExtent - RULE + position - (extent - RULE);
  }
  for (let segment = 1; segment < segments; segment++) {
    const laneStart = Math.round(extent * segment / segments) - Math.floor(RULE / 2);
    if (position >= laneStart && position < laneStart + RULE) {
      return internalStart + position - laneStart;
    }
  }
  return null;
}

// The bridge has oversized cells, but its rule is rasterized at the roster's
// native display scale. That keeps the shared video/bridge/roster boundary the
// same visible thickness instead of magnifying a two-pixel rule with each cell.
function renderSharedPanelRules(frameWidth, frameHeight, columns, rows) {
  const sourceWidth = 96;
  const sourceHeight = 92;
  const reference = decodeReferenceRules();
  const dst = new Uint8ClampedArray(frameWidth * frameHeight * 4);
  for (let y = 0; y < frameHeight; y++) for (let x = 0; x < frameWidth; x++) {
    const sourceRuleX = sharedPanelRuleSample(
      x, frameWidth, columns, CELL_W + RULE, sourceWidth
    );
    const sourceRuleY = sharedPanelRuleSample(
      y, frameHeight, rows, CELL_H + RULE, sourceHeight
    );
    if (sourceRuleX == null && sourceRuleY == null) continue;
    const sourceX = sourceRuleX ?? mapRuleSample(x, frameWidth, CELL_W, sourceWidth);
    const sourceY = sourceRuleY ?? mapRuleSample(y, frameHeight, CELL_H, sourceHeight);
    const source = (sourceY * sourceWidth + sourceX) * 4;
    put(
      dst, frameWidth, x, y,
      reference[source], reference[source + 1], reference[source + 2], reference[source + 3]
    );
  }
  return dst;
}

function paintPixels(target, pixels, width, height) {
  // A zero/NaN size (hidden pane, collapsed frame before layout) makes
  // `new ImageData` throw. Skip the paint; the resize observers repaint once
  // the element has a real size.
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return;
  const canvas = target;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
}

function createImageLayer(className) {
  const image = document.createElement('img');
  image.className = className;
  image.alt = '';
  image.decoding = 'async';
  image.draggable = false;
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function setActionIcon(button, fileName, kind) {
  const image = createImageLayer(`replica-action-icon is-${kind}`);
  image.loading = 'eager';
  image.src = actionIconUrl(fileName);
  button.prepend(image);
}

function setActionStatic(button, kind) {
  const clip = document.createElement('span');
  clip.className = 'replica-action-static-layer';
  clip.setAttribute('aria-hidden', 'true');
  const strip = createImageLayer('replica-action-static-strip');
  strip.src = kind === 'search' ? searchStaticUrl : createStaticUrl;
  clip.append(strip);
  button.prepend(clip);
}

function ensureLabel(button) {
  let label = button.querySelector('.replica-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'replica-label';
    label.setAttribute('aria-hidden', 'true');
    button.append(label);
  }
  return label;
}

// Invisible find-in-page text laid over the bitmap caption so the browser's
// own Ctrl/Cmd-F can match a fighter and paint its highlight on the tile.
// Fighters get one span per word of their display and full names (the caption
// may be a truncated short form like "DK"); action tiles keep their caption.
// Layout and the highlight styling live in .replica-label / .replica-find-word.
function setFindableText(button, captionText) {
  const isFighter = button.dataset.kind === 'fighter' || button.dataset.kind === 'job';
  const display = button.dataset.displayName || '';
  const nameFull = button.dataset.nameFull || '';
  // Skip a display name the full name already contains ("Mozart" in
  // "Wolfgang Amadeus Mozart"): shorter text → a wider highlight band per match.
  const redundant = nameFull.toLocaleLowerCase().includes(display.toLocaleLowerCase());
  const full = isFighter
    ? [redundant ? '' : display, nameFull].filter(Boolean).join(' · ') || display
    : '';
  const text = full || captionText;
  const label = ensureLabel(button);
  // One span per distinct word, each squeezed to the tile width (monospace
  // advance ≈ 0.6em at font-size = tile height); see .replica-find-word.
  if (label.dataset.findText === text) return;
  label.dataset.findText = text;
  const words = [...new Set(text.split(/[\s·]+/).filter(Boolean))];
  label.replaceChildren(...words.map(word => {
    const span = document.createElement('span');
    span.className = 'replica-find-word';
    span.textContent = word;
    const sx = Math.min(1, (CELL_W / CELL_H) / (0.6 * word.length));
    span.style.setProperty('--find-sx', sx.toFixed(4));
    return span;
  }));
}

// Captions are normal text in a tiny shared webfont. Set all labels during
// roster reconciliation; there is no per-tile bitmap, font promise, or idle queue.
function setCellLabel(button, value) {
  const caption = fitCaption(value);
  setFindableText(button, caption.text);
  button.dataset.label = caption.text;
  let label = button.querySelector('.replica-caption-layer');
  if (!label) {
    label = document.createElement('span');
    label.className = 'replica-caption-layer';
    label.setAttribute('aria-hidden', 'true');
    button.append(label);
  }
  const signature = `${caption.cut}:${caption.squeeze}:${caption.text}`;
  if (label.dataset.caption !== signature) {
    label.dataset.caption = signature;
    if (caption.squeeze) {
      // Only selectively tightened names need explicit glyph positions.
      // Ordinary names use native text shaping and the font's kerning table.
      label.replaceChildren(...caption.glyphs.map(glyph => {
        const span = document.createElement('span');
        span.textContent = glyph.text;
        span.style.left = `${glyph.x / 10}em`;
        return span;
      }));
    } else label.textContent = caption.text;
  }
  label.classList.toggle('is-tightened', Boolean(caption.squeeze));
  label.dataset.cut = caption.cut;
  label.style.setProperty('--caption-left', `${100 * caption.originX / CELL_W}%`);
  label.style.width = `${caption.width / 10}em`;
  return caption.text;
}

function setNativePortrait(button, character) {
  let image = button.querySelector('.replica-portrait-layer');
  if (!image) {
    image = createImageLayer('replica-portrait-layer');
    // Live demos scroll the whole roster in one glide; fetch every tile up
    // front so nothing pops in on stage.
    image.loading = document.body.classList.contains('is-demo-mode') ? 'eager' : 'lazy';
    image.width = CELL_W * RASTER_SCALE;
    image.height = CELL_H * RASTER_SCALE;
    button.prepend(image);
  }
  const portraitUrl = character.portraitUrl || '';
  if (portraitUrl) {
    if (image.getAttribute('src') !== portraitUrl) image.src = portraitUrl;
  } else {
    image.removeAttribute('src');
  }
  setCellLabel(button, character.label);
}

function clearNativePortrait(button) {
  button.querySelector('.replica-portrait-layer')?.remove();
}

const grid = document.getElementById('replica-grid');
const arenaShell = document.querySelector('.arena-shell');
const arenaSurface = grid.closest('.arena-surface');
const introVideoFrame = document.querySelector('.intro-video-frame');
const introVideoRuleCanvas = document.querySelector('.intro-video-rule-layer');
const siteMenuBridge = document.getElementById('site-menu-bridge');
const siteMenuRuleCanvas = document.querySelector('.site-menu-rule-layer');
const cells = new Map();
const jobCells = new Map();
const jobDetails = new Map();

const advancedFrameCells = [...document.querySelectorAll('.advanced-cell-frame')];
const advancedFrameCanvases = new Map(advancedFrameCells.map(cell => {
  const canvas = document.createElement('canvas');
  canvas.className = 'advanced-cell-rule-layer';
  canvas.setAttribute('aria-hidden', 'true');
  cell.append(canvas);
  return [cell, canvas];
}));

function paintAdvancedFrame(cell) {
  const canvas = advancedFrameCanvases.get(cell);
  const width = Math.round(cell.getBoundingClientRect().width);
  const height = Math.round(cell.getBoundingClientRect().height);
  if (!canvas || width < RULE * 2 + 1 || height < RULE * 2 + 1) return;
  const signature = `${width}x${height}`;
  if (canvas.dataset.signature === signature) return;
  canvas.dataset.signature = signature;
  paintPixels(canvas, renderOuterRules(width, height), width, height);
}

if ('ResizeObserver' in window) {
  const advancedFrameObserver = new ResizeObserver(entries => {
    entries.forEach(entry => paintAdvancedFrame(entry.target));
  });
  advancedFrameCells.forEach(cell => advancedFrameObserver.observe(cell));
} else {
  advancedFrameCells.forEach(paintAdvancedFrame);
  window.addEventListener('resize', () => advancedFrameCells.forEach(paintAdvancedFrame));
}

CELL_IDS.forEach((id, index) => {
  const isSearch = index === 0;
  const isCreate = index === 1;
  const character = isSearch
    ? { asset: 'search', portrait: '', label: 'SEARCH', name: 'Search fighters' }
    : isCreate
      ? { asset: 'create', portrait: '', label: 'CREATE', name: 'Create fighter' }
      : rosterCharacterForIndex(index - 2);
  const fkind = character.fkind ?? VANILLA_ROSTER.indexOf(character);
  const label = character.label;
  const button = document.createElement(isSearch ? 'label' : 'button');
  if (!isSearch) button.type = 'button';
  button.className = `replica-cell${isSearch ? ' is-search' : isCreate ? ' is-create' : ''}`;
  button.dataset.character = id;
  button.dataset.kind = isSearch ? 'search' : isCreate ? 'create' : 'fighter';
  button.dataset.label = label;
  button.dataset.rosterCharacter = character.asset;
  button.dataset.portrait = character.portrait;
  if (character.portraitUrl) button.dataset.portraitUrl = character.portraitUrl;
  button.dataset.displayName = character.name;
  button.dataset.fkind = String(fkind);
  if (character.bundle) button.dataset.bundle = character.bundle;
  button.setAttribute('role', 'gridcell');
  button.setAttribute('aria-label', character.name);
  // Create is a momentary action, not a toggle or selection-holding cell.
  if (!isSearch && !isCreate) button.setAttribute('aria-pressed', 'false');
  if (isSearch) {
    const caret = document.createElement('span');
    caret.className = 'replica-search-caret';
    caret.setAttribute('aria-hidden', 'true');
    button.append(caret);

    const input = document.createElement('input');
    input.id = 'fighter-search';
    input.className = 'replica-search-input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'SEARCH';
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('aria-label', 'Search fighters');
    button.append(input);
  }
  if (isSearch || isCreate) {
    setActionStatic(button, isSearch ? 'search' : 'create');
    setActionIcon(button, isSearch ? 'SearchGlass.png' : 'Plus.png', isSearch ? 'search' : 'create');
    setCellLabel(button, label);
  }
  else if (!isSearch) {
    setNativePortrait(button, character);
  }
  // Search and Create contain the live input/navigation controls, so keep
  // those two cells mounted. Fighter cells are attached only near the
  // viewport once their logical rows have been calculated below.
  if (isSearch || isCreate) grid.append(button);
  cells.set(id, button);
});

const actionCells = [...cells.values()].filter(button =>
  button.dataset.kind === 'search' || button.dataset.kind === 'create'
);
const ruleCanvas = document.createElement('canvas');
ruleCanvas.className = 'replica-rule-layer';
ruleCanvas.setAttribute('aria-hidden', 'true');
grid.append(ruleCanvas);

let currentGridLayout;
let currentVisibleCells = [];
let introVideoRuleSignature = '';
let siteMenuRuleSignature = '';
const mountedCells = new Set(actionCells);
let cellWindowFrame = 0;

function paintIntroVideoRule() {
  if (!currentGridLayout || !introVideoFrame || !introVideoRuleCanvas) return;
  const frameRect = introVideoFrame.getBoundingClientRect();
  const gridWidth = grid.getBoundingClientRect().width || window.innerWidth;
  const rosterScale = gridWidth / currentGridLayout.width;
  // A zero-size viewport (hidden pane, background load) would make these
  // NaN/Infinity and throw out of module evaluation, taking every runtime
  // module that follows this one (including the hand cursor) down with it.
  if (!Number.isFinite(rosterScale) || rosterScale <= 0) return;
  if (!(frameRect.width > 0) || !(frameRect.height > 0)) return;
  const width = Math.max(RULE * 2 + 1, Math.round(frameRect.width / rosterScale));
  const height = Math.max(RULE * 2 + 1, Math.round(frameRect.height / rosterScale));
  const signature = `${width}x${height}`;
  if (signature === introVideoRuleSignature) return;
  introVideoRuleSignature = signature;
  paintPixels(
    introVideoRuleCanvas, renderOuterRules(width, height), width, height
  );
}

function sharedControlStripHeight(width) {
  const logicalWidth = RULE + CELL_W + RULE;
  const logicalHeight = RULE + CELL_H + RULE;
  return Math.max(
    RULE * 2 + 1,
    Math.round(width * logicalHeight / logicalWidth * FLAME_BRIDGE_HEIGHT_SCALE)
  );
}

function paintSiteMenuRule() {
  if (!currentGridLayout || !siteMenuBridge || !siteMenuRuleCanvas) return;
  const columns = 3;
  const rows = 1;
  const logicalWidth = RULE + CELL_W + RULE;
  const logicalHeight = RULE + CELL_H + RULE;
  const width = currentGridLayout.width;
  const height = sharedControlStripHeight(width);
  const signature = `${width}x${height}:${columns}x${rows}`;

  // This is the same physical row height as Search Fighters. With six roster
  // columns each menu cell spans two character units; with three, it spans one.
  siteMenuBridge.style.aspectRatio =
    `${logicalWidth} / ${logicalHeight * FLAME_BRIDGE_HEIGHT_SCALE}`;
  if (signature === siteMenuRuleSignature) return;
  siteMenuRuleSignature = signature;
  paintPixels(
    siteMenuRuleCanvas,
    renderSharedPanelRules(width, height, columns, rows),
    width,
    height
  );
}

function columnsForContainer() {
  // The arena is square and capped by viewport height, so using its rendered
  // width keeps wide laptop windows stuck at six columns. Break the roster by
  // page width instead; the cells still scale to the arena once laid out.
  return GRID_COLUMN_BREAKPOINTS.find(({ minWidth }) => window.innerWidth >= minWidth).columns;
}

function reserveRosterFootprint(layout) {
  // Percentage padding is resolved against the arena shell's width. Expressing
  // the offscreen rows this way lets CSS track live resizes without a JS
  // measurement/write cycle (which otherwise forces layout for every tile).
  const reservePercent = 100 * (layout.reservedHeight - layout.height) / layout.width;
  arenaShell.style.setProperty('--roster-layout-reserve', `${reservePercent}%`);
}

function visibleCellsInDisplayOrder() {
  const visible = [...cells.values()].filter(button => !button.hidden);
  return [
    ...visible.filter(button => button.dataset.kind === 'search'),
    ...visible.filter(button => button.dataset.kind === 'create'),
    ...visible.filter(button => button.dataset.kind === 'job'),
    ...visible.filter(button => button.dataset.kind === 'creation'),
    ...visible.filter(button => button.dataset.kind === 'fighter' && button.dataset.mine),
    ...visible.filter(button => button.dataset.kind === 'fighter' && !button.dataset.mine),
  ];
}

// The rule lattice is a full-board pixel buffer (several MB at 1000
// fighters) and depends only on the board geometry. Typing in the search box
// changes the row count with most keystrokes, so boards are cheap to render
// (rule bands only, see renderRules) and only the last two are kept: the
// unfiltered roster plus the current query.
const RULE_BOARDS = new Map();
function rulesForBoard(width, height, columns, cellCount) {
  const key = `${width}x${height}:${columns}:${cellCount}`;
  let pixels = RULE_BOARDS.get(key);
  if (!pixels) {
    pixels = renderRules(width, height, columns, cellCount);
    RULE_BOARDS.set(key, pixels);
    if (RULE_BOARDS.size > 2) RULE_BOARDS.delete(RULE_BOARDS.keys().next().value);
  }
  return pixels;
}

// Every unfiltered tile is mounted. The grid used to keep only the rows near
// the viewport in the DOM, but that made the browser's find-in-page blind to
// most of the roster; a thousand tiles with lazy portraits lay out fine.
function updateMountedCellWindow() {
  cellWindowFrame = 0;
  // Fixed-body modal scroll locks temporarily move the document through an
  // intermediate scroll position on mobile browsers. Keep the current cells
  // mounted until the saved page position has been restored, otherwise this
  // pass can empty the visible roster for a frame.
  if (isPageScrollLocked()) return;
  if (!currentGridLayout || !currentVisibleCells.length) return;

  const desiredCells = new Set(actionCells);
  currentVisibleCells.forEach(button => desiredCells.add(button));

  for (const button of mountedCells) {
    if (desiredCells.has(button)) continue;
    button.remove();
    mountedCells.delete(button);
  }
  for (const button of desiredCells) {
    if (mountedCells.has(button) || button.hidden) continue;
    grid.append(button);
    mountedCells.add(button);
  }
}

function scheduleMountedCellWindowUpdate() {
  if (cellWindowFrame) return;
  cellWindowFrame = requestAnimationFrame(updateMountedCellWindow);
}

function applyGridLayout(columns = columnsForContainer(), force = false) {
  // Live resize normally stays within the same breakpoint. Do not rebuild a
  // roster-sized array/signature until filtering, reconciliation, or a column
  // breakpoint actually changes the logical layout.
  if (!force && currentGridLayout?.columns === columns &&
      currentGridLayout.reservedCellCount === cells.size) {
    scheduleMountedCellWindowUpdate();
    return currentGridLayout;
  }

  const visibleCells = visibleCellsInDisplayOrder();
  const visibleSignature = visibleCells.map(button => button.dataset.character).join(',');
  // Job cells arrive after the static roster. Keep the unfiltered footprint in
  // the cache key so a job sync cannot leave a filtered layout using a stale
  // reserve merely because none of the new cells match the current query.
  const reservedCellCount = cells.size;
  if (currentGridLayout?.columns === columns &&
      currentGridLayout.visibleSignature === visibleSignature &&
      currentGridLayout.reservedCellCount === reservedCellCount) {
    scheduleMountedCellWindowUpdate();
    return currentGridLayout;
  }

  const { rows, width, height } = rosterGridDimensions(visibleCells.length, columns, {
    cellWidth: CELL_W,
    cellHeight: CELL_H,
    rule: RULE,
  });
  const reservedLayout = rosterGridDimensions(reservedCellCount, columns, {
    cellWidth: CELL_W,
    cellHeight: CELL_H,
    rule: RULE,
  });
  const reservedRows = reservedLayout.rows;
  const reservedHeight = reservedLayout.height;
  currentGridLayout = Object.freeze({
    columns, rows, width, height,
    reservedCellCount, reservedRows, reservedHeight,
    visibleCount: visibleCells.length,
    visibleSignature
  });
  currentVisibleCells = visibleCells;

  arenaShell.style.setProperty(
    '--shared-rule-overlap', `${100 * RULE / width}%`
  );
  // Filtering compacts the visible tiles, but keep the roster's original page
  // footprint so a focused search field does not trigger scroll anchoring.
  // Apply the percentage reserve before contracting the surface so sparse
  // searches never briefly become shorter than the viewport and clamp scrollY.
  reserveRosterFootprint(currentGridLayout);
  arenaSurface.style.aspectRatio = `${width} / ${height}`;
  grid.setAttribute('aria-colcount', String(columns));
  grid.setAttribute('aria-rowcount', String(rows));

  visibleCells.forEach((button, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    button.dataset.column = String(col + 1);
    button.dataset.row = String(row + 1);
    button.style.setProperty('--cell-left', `${100 * (RULE + col * (CELL_W + RULE)) / width}%`);
    button.style.setProperty('--cell-top', `${100 * (RULE + row * (CELL_H + RULE)) / height}%`);
    button.style.setProperty('--cell-width', `${100 * CELL_W / width}%`);
    button.style.setProperty('--cell-height', `${100 * CELL_H / height}%`);
    button.setAttribute(
      'aria-label',
      `${button.dataset.displayName}, row ${row + 1}, column ${col + 1}`
    );
  });

  paintPixels(
    ruleCanvas,
    rulesForBoard(width, height, columns, visibleCells.length),
    width,
    height
  );
  paintIntroVideoRule();
  paintSiteMenuRule();

  const metrics = document.getElementById('replica-metrics');
  metrics.textContent =
    `${visibleCells.length}/${cells.size} targetable cells · ${columns}×${rows} · ${width}×${height} native`;

  updateMountedCellWindow();
  return currentGridLayout;
}

applyGridLayout();
// A grid change that lands while a scroll-locking overlay is open (job
// completion, roster poll, resize) bails out above; re-run it once the lock lifts.
onPageScrollUnlock(scheduleMountedCellWindowUpdate);

let resizeSettleTimer = 0;
function syncLayoutToVideoWidth() {
  applyGridLayout(columnsForContainer());
  scheduleMountedCellWindowUpdate();
  // Keep the existing border stretched during live resize, then regenerate
  // its exact native sampling once the resize gesture settles.
  window.clearTimeout(resizeSettleTimer);
  resizeSettleTimer = window.setTimeout(paintIntroVideoRule, 120);
}

if (introVideoFrame && 'ResizeObserver' in window) {
  const videoWidthObserver = new ResizeObserver(syncLayoutToVideoWidth);
  videoWidthObserver.observe(introVideoFrame);
}
window.addEventListener('resize', syncLayoutToVideoWidth);

const fighterSearch = document.getElementById('fighter-search');
const fighterEmptyState = document.getElementById('fighter-empty-state');
const searchCell = [...cells.values()].find(button => button.dataset.kind === 'search');
let pendingSearchSelection = null;

function selectableRosterCell(target) {
  const cell = target?.closest?.('.replica-cell');
  return cell?.hasAttribute('aria-pressed') && !cell.hidden ? cell : null;
}

function updateSearchTile(query = '') {
  if (!searchCell) return;
  const value = String(query).toUpperCase();
  const active = document.activeElement === fighterSearch;
  const caption = fitCaption(value || 'SEARCH');
  const caretX = value ? Math.min(CELL_W - 2, caption.originX + caption.width + 1) : 3;
  searchCell.classList.toggle('is-searching', active);
  searchCell.classList.toggle('is-search-placeholder', active && !value);
  searchCell.style.setProperty('--search-caret-left', `${100 * caretX / CELL_W}%`);
  if (fighterSearch && fighterSearch.value !== value) fighterSearch.value = value;
  const searchIcon = searchCell.querySelector('.replica-action-icon');
  if (searchIcon) searchIcon.hidden = active || Boolean(value);
  setCellLabel(searchCell, value || 'SEARCH');
}

function filterRoster(query = '') {
  const normalized = String(query).trim().toLocaleLowerCase();
  let visibleCount = 0;

  cells.forEach(button => {
    if (button.dataset.kind === 'search') {
      button.hidden = false;
      return;
    }
    if (button.dataset.kind === 'create') {
      button.hidden = Boolean(normalized);
      return;
    }
    const matches = !normalized || [
      button.dataset.displayName,
      button.dataset.nameFull,
      button.dataset.label,
      button.dataset.rosterCharacter,
      button.dataset.portrait
    ].filter(Boolean).some(value => value.toLocaleLowerCase().includes(normalized));
    button.hidden = !matches;
    if (matches) visibleCount++;
  });

  updateSearchTile(query);
  applyGridLayout(columnsForContainer(), true);
  if (fighterEmptyState) {
    fighterEmptyState.hidden = visibleCount > 0;
    fighterEmptyState.textContent = visibleCount
      ? ''
      : `No fighters match “${String(query).trim()}”`;
  }
  grid.setAttribute('aria-label', normalized
    ? `${visibleCount} fighters matching ${String(query).trim()}`
    : 'Search, create, and character roster');
  return visibleCount;
}

fighterSearch?.addEventListener('input', event => filterRoster(event.currentTarget.value));
grid.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  pendingSearchSelection = document.activeElement === fighterSearch
    ? selectableRosterCell(event.target)
    : null;
}, { capture: true });
fighterSearch?.addEventListener('focus', event => filterRoster(event.currentTarget.value));
fighterSearch?.addEventListener('blur', event => {
  // Pointer-down blurs the input before click selects the fighter. Keep the
  // filtered layout stable until that click lands, or it can land on empty
  // space after the full roster is restored.
  if (pendingSearchSelection || selectableRosterCell(event.relatedTarget)) return;
  window.setTimeout(() => {
    if (document.activeElement !== fighterSearch) clearFighterSearch();
  }, 0);
});
window.addEventListener('pointerup', event => {
  if (!pendingSearchSelection) return;
  if (selectableRosterCell(event.target) !== pendingSearchSelection) {
    pendingSearchSelection = null;
    if (document.activeElement !== fighterSearch) clearFighterSearch();
  }
});
window.addEventListener('pointercancel', () => {
  pendingSearchSelection = null;
  if (document.activeElement !== fighterSearch) clearFighterSearch();
});
document.addEventListener('click', event => {
  if (searchCell?.contains(event.target)) return;
  pendingSearchSelection = null;
  clearFighterSearch();
});
fighterSearch?.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  clearFighterSearch();
});

function clearFighterSearch() {
  if (!fighterSearch) return;
  const searchTileStillActive = searchCell?.classList.contains('is-searching');
  if (!fighterSearch.value &&
      document.activeElement !== fighterSearch &&
      !searchTileStillActive) return;
  fighterSearch.value = '';
  fighterSearch.blur();
  // Paint after blur so the custom pixel caret and dimmed SEARCH label reflect
  // the input's final focus state instead of preserving the focused frame.
  filterRoster('');
}

function getCell(name) {
  const value = String(name);
  const key = value.toUpperCase();
  // Static cells are keyed CELL-### (upper case); cells added later for
  // generated fighters are keyed ROSTER-<slug> with the slug's own case.
  return cells.get(value) || cells.get(key) || [...cells.values()].find(cell =>
    cell.dataset.label === key || cell.dataset.rosterCharacter === value
  ) || null;
}

function jobCellId(jobId) {
  return `JOB-${jobId}`;
}

function rosterCellId(slug) {
  return `ROSTER-${slug}`;
}

function createRosterCell(character) {
  const id = rosterCellId(character.asset);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'replica-cell';
  button.dataset.character = id;
  button.dataset.kind = 'fighter';
  button.setAttribute('role', 'gridcell');
  button.setAttribute('aria-pressed', 'false');
  setNativePortrait(button, character);
  attachCellActivation(button);
  cells.set(id, button);
  return button;
}

async function syncCharacters(characters = []) {
  const nextRoster = [...new Map(
    characters.map(character => {
      const rosterCharacter = liveRosterCharacter(character);
      return [rosterCharacter.asset, rosterCharacter];
    })
  ).values()];
  const nextSlugs = new Set(nextRoster.map(character => character.asset));
  const staticFighterCells = [...cells.values()].filter(button =>
    !button.classList.contains('fighter-job-cell') &&
    (button.dataset.kind === 'fighter' || button.dataset.kind === 'creation')
  );

  for (const button of staticFighterCells) {
    if (nextSlugs.has(button.dataset.rosterCharacter)) continue;
    cells.delete(button.dataset.character);
    button.remove();
  }

  // One index per sync instead of a cells scan per character: with a
  // 1000-fighter roster the per-character `[...cells.values()].find` was a
  // million array copies and attribute reads on every roster refresh.
  const rosterButtons = new Map();
  for (const button of cells.values()) {
    if (button.classList.contains('fighter-job-cell')) continue;
    const slug = button.dataset.rosterCharacter;
    if (slug && !rosterButtons.has(slug)) rosterButtons.set(slug, button);
  }
  const creationJobSlugs = new Set();
  for (const candidate of jobCells.values()) {
    if (candidate.dataset.kind === 'creation') creationJobSlugs.add(candidate.dataset.rosterCharacter);
  }

  for (const character of nextRoster) {
    let button = rosterButtons.get(character.asset) || null;
    // A completed private fighter may already be represented by its job cell.
    // Keep that richer progress/ready cell instead of drawing a duplicate.
    if (!button && creationJobSlugs.has(character.asset)) continue;
    if (!button) {
      button = createRosterCell(character);
      rosterButtons.set(character.asset, button);
    }

    button.dataset.label = character.label;
    button.dataset.rosterCharacter = character.asset;
    button.dataset.portrait = character.portrait;
    button.dataset.portraitUrl = character.portraitUrl || '';
    button.dataset.displayName = character.name;
    if (character.nameFull && character.nameFull !== character.name) {
      button.dataset.nameFull = character.nameFull;
    } else {
      delete button.dataset.nameFull;
    }
    button.dataset.fkind = String(character.fkind ?? 0);
    if (character.bundle) button.dataset.bundle = character.bundle;
    else delete button.dataset.bundle;
    setCellVisibility(button, character.visibility);
    if (character.mine) button.dataset.mine = 'true';
    else delete button.dataset.mine;
    setCellManageControl(button, character.asset, Boolean(character.mine));
    button.setAttribute('aria-label', character.visibility === 'private'
      ? `${character.name}, private`
      : character.name);

    setNativePortrait(button, character);
  }

  // Cells are updated in place, so a roster whose ORDER changed (the demo's
  // spotlight block, a re-sorted front row) has to move its buttons too.
  // The block keeps the slot of the first roster cell; everything else
  // (search, create, vanilla, job cells) stays where it is.
  const ordered = nextRoster
    .map(character => rosterButtons.get(character.asset))
    .filter(Boolean);
  const orderedSet = new Set(ordered);
  const current = [...grid.querySelectorAll(':scope > [data-roster-character]')]
    .filter(button => orderedSet.has(button));
  if (ordered.some((button, index) => button !== current[index])) {
    let after = current[0]?.previousSibling || null;
    for (const button of ordered) {
      grid.insertBefore(button, after ? after.nextSibling : grid.firstChild);
      after = button;
    }
    // Layout order is the cells map's insertion order (fighters sort after
    // the fixed cells regardless), so re-insert them in the new order too.
    for (const button of ordered) {
      const key = button.dataset.character;
      cells.delete(key);
      cells.set(key, button);
    }
    currentGridLayout = null;
  }

  filterRoster(fighterSearch?.value || '');
  return cells;
}

// Server stage labels that read as sentences get a one-word tile version.
const SHORT_STAGE_LABELS = Object.freeze({
  'generation worker scheduled': 'Scheduled',
  'queued to resume': 'Queued',
  'waiting for the current fighter': 'In line',
  'recovered after server restart': 'Restarting',
  'starting the fighter pipeline': 'Starting',
  'preparing the reference photo': 'Prepping photo',
  'describing the character': 'Describing',
});

// The tile is ~1/9 of the grid wide, so the server's stage label is squeezed
// to a couple of words; the full label lives in the details modal.
function shortStageLabel(job) {
  const label = String(job.stageLabel || '').trim();
  const status = job.status === 'retrying' ? 'Retrying' : job.status === 'queued' ? 'Queued' : 'Working';
  if (!label) return status;
  const known = SHORT_STAGE_LABELS[label.toLowerCase()];
  if (known) return known;
  const short = label
    .replace(/^(Generation worker|Generation|Worker)\s+/i, '')
    .replace(/^(Starting|Preparing|Waiting for|Recovered after)\s+the\s+/i, '$1 ')
    .replace(/\s+the\s+/g, ' ');
  return (short.length > 22 ? `${short.slice(0, 21).trimEnd()}…` : short) || status;
}

function createJobCell(job) {
  const id = jobCellId(job.id);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'replica-cell fighter-job-cell';
  button.dataset.character = id;
  button.dataset.kind = 'job';
  button.dataset.label = fitCaption(job.name).text;
  button.dataset.rosterCharacter = job.slug;
  button.dataset.portrait = '';
  button.dataset.displayName = job.name;
  button.dataset.fkind = '0';
  setCellVisibility(button, job.visibility);
  button.setAttribute('role', 'gridcell');
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-disabled', 'true');

  setCellLabel(button, job.name);

  const spinner = document.createElement('span');
  spinner.className = 'fighter-job-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  button.append(spinner);

  const progress = document.createElement('span');
  progress.className = 'fighter-job-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('i');
  progress.append(fill);
  button.append(progress);

  const status = document.createElement('small');
  status.className = 'fighter-job-status';
  status.hidden = true;
  button.append(status);

  const failure = document.createElement('span');
  failure.className = 'fighter-job-error';
  failure.hidden = true;
  const failureMessage = document.createElement('strong');
  const failureHint = document.createElement('small');
  failureHint.textContent = 'Tap for details';
  failure.append(failureMessage, failureHint);
  button.append(failure);

  button.addEventListener('click', () => {
    const currentJob = jobDetails.get(job.id);
    if (currentJob && currentJob.status !== 'complete') {
      // Generating and failed tiles open the job details modal (stage,
      // elapsed time, pipeline log, retry) instead of selecting a fighter.
      if (APP_BRIDGE?.showGenerationDetails) APP_BRIDGE.showGenerationDetails(currentJob);
      else if (currentJob.status === 'failed') APP_BRIDGE?.reportGenerationError?.(currentJob);
      return;
    }
    if (button.dataset.kind === 'fighter' || button.dataset.kind === 'creation') {
      requestSelection(button.dataset.rosterCharacter);
    }
  });
  cells.set(id, button);
  jobCells.set(job.id, button);
  return button;
}

async function updateJobCell(job) {
  if (!job?.id) return null;
  const button = jobCells.get(job.id) || createJobCell(job);
  jobDetails.set(job.id, job);
  const revision = Number(button.dataset.revision || -1);
  if (revision >= (job.revision || 0)) return button;

  const active = ['queued', 'running', 'retrying'].includes(job.status);
  const complete = job.status === 'complete' && job.character;
  const failed = job.status === 'failed';
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  button.dataset.revision = String(job.revision || 0);
  button.dataset.status = job.status;
  button.dataset.displayName = job.character?.name || job.name;
  button.dataset.label = fitCaption(expandShortLabel(job.character?.short, job.character?.name) || job.name).text;
  button.dataset.rosterCharacter = job.character?.slug || job.slug;
  button.classList.toggle('is-generating', active);
  button.classList.toggle('is-failed', failed);
  button.querySelector('.fighter-job-spinner').hidden = !active;
  const progressElement = button.querySelector('.fighter-job-progress');
  progressElement.hidden = complete || failed;
  progressElement.setAttribute('aria-valuenow', String(progress));
  progressElement.setAttribute('aria-label', `${job.name} generation ${progress}% complete`);
  progressElement.querySelector('i').style.width = `${progress}%`;
  const statusElement = button.querySelector('.fighter-job-status');
  statusElement.hidden = !active;
  statusElement.textContent = active ? shortStageLabel(job) : '';
  const failureElement = button.querySelector('.fighter-job-error');
  failureElement.hidden = !failed;
  failureElement.querySelector('strong').textContent = failed
    ? formatFighterJobCellError(job)
    : '';
  setCellVisibility(button, job.visibility);
  setCellManageControl(button, job.character?.slug || job.slug, complete || failed);
  button.setAttribute('aria-label', complete
    ? `${job.character.name}, ready to fight${job.visibility === 'private' ? ', private' : ''}`
    : failed
      ? `${job.name}, ${formatFighterJobCellError(job)}. Open error details.`
      : `${job.name}, ${job.stageLabel || job.status}, ${progress}% complete. Open generation details.`);
  button.setAttribute('aria-disabled', 'false');

  if (complete) {
    const character = liveRosterCharacter(job.character);
    button.dataset.kind = 'creation';
    button.dataset.character = job.character.slug;
    button.dataset.portrait = character.portrait;
    button.dataset.portraitUrl = character.portraitUrl || '';
    button.dataset.fkind = String(job.character.fkind || 0);
    if (job.character.bundle) button.dataset.bundle = job.character.bundle;
    setNativePortrait(button, character);
  } else {
    button.dataset.kind = 'job';
    clearNativePortrait(button);
    setCellLabel(button, expandShortLabel(job.character?.short, job.character?.name) || job.character?.name || job.name);
  }
  return button;
}

async function syncJobs(jobs = []) {
  const staticCells = [...cells.values()].filter(
    button => !button.classList.contains('fighter-job-cell')
  );
  staticCells.forEach(button => {
    if (button.dataset.kind === 'creation') button.dataset.kind = 'fighter';
  });

  const renderedJobs = jobs.filter(job => {
    if (job.status !== 'complete' || !job.character) return true;
    const existing = staticCells.find(
      button => button.dataset.rosterCharacter === job.character.slug
    );
    if (!existing) return true;
    existing.dataset.kind = 'creation';
    return false;
  });

  const nextIds = new Set(renderedJobs.map(job => job.id));
  for (const [jobId, button] of jobCells) {
    if (nextIds.has(jobId)) continue;
    cells.delete(jobCellId(jobId));
    jobCells.delete(jobId);
    jobDetails.delete(jobId);
    button.remove();
  }
  await Promise.all(renderedJobs.map(updateJobCell));
  filterRoster(fighterSearch?.value || '');
  return jobCells;
}

function setLabel(character, label) {
  const cell = getCell(character);
  if (!cell) return null;
  const fitted = fitCaption(label).text;
  setCellLabel(cell, fitted);
  cell.setAttribute('aria-label', fitted || cell.dataset.character);
  return cell;
}

function randomize() {
  [...cells.values()].filter(cell =>
    cell.dataset.kind === 'fighter' || cell.dataset.kind === 'creation'
  ).forEach(cell => {
    const name = RANDOM_NAME_POOL[Math.floor(Math.random() * RANDOM_NAME_POOL.length)];
    setLabel(cell.dataset.character, name);
  });
  return cells;
}

function clearHighlights() {
  cells.forEach(cell => cell.classList.remove('is-highlighted'));
}

function highlight(name, active = true) {
  const cell = getCell(name);
  if (cell) cell.classList.toggle('is-highlighted', Boolean(active));
  return cell;
}

function select(name) {
  const candidate = name == null ? null : getCell(name);
  const selected = candidate?.hasAttribute('aria-pressed') ? candidate : null;
  cells.forEach(cell => {
    if (cell.hasAttribute('aria-pressed')) {
      cell.setAttribute('aria-pressed', String(cell === selected));
    }
  });
  return selected;
}

// Double select: stamp "1P"/"2P" on picked tiles while more players choose.
function markPick(name, tag) {
  const cell = name == null ? null : getCell(name);
  if (!cell) return null;
  if (tag) cell.dataset.pick = tag;
  else delete cell.dataset.pick;
  return cell;
}

function clearPicks() {
  cells.forEach(cell => { delete cell.dataset.pick; });
}

function requestSelection(name) {
  const selected = name == null ? null : getCell(name);
  if (selected) {
    pendingSearchSelection = null;
    clearFighterSearch();
    grid.dispatchEvent(new CustomEvent('characterselect', {
      bubbles: true,
      detail: {
        name: selected.dataset.character,
        label: selected.dataset.label,
        displayName: selected.dataset.displayName,
        slug: selected.dataset.rosterCharacter,
        fkind: Number(selected.dataset.fkind),
        bundle: selected.dataset.bundle || null,
        cell: selected
      }
    }));
  }
  return selected;
}

function attachCellActivation(cell) {
  cell.addEventListener('click', () => {
    if (cell.dataset.kind === 'search') {
      fighterSearch?.focus({ preventScroll: true });
      return;
    }
    if (cell.dataset.kind === 'create') {
      if (APP_BRIDGE?.navigate) APP_BRIDGE.navigate('/create');
      else window.location.assign('/create');
      return;
    }
    requestSelection(cell.dataset.character);
  });
}

cells.forEach(attachCellActivation);

// Public, DOM-first hooks for future game/UI work. Example:
// characterGrid.setLabel('CELL-001', 'CUSTOM'); characterGrid.highlight('CELL-042');
window.characterGrid = Object.freeze({
  element: grid,
  cells,
  get columnCount() { return currentGridLayout.columns; },
  get rowCount() { return currentGridLayout.rows; },
  getCell,
  setLabel,
  highlight,
  clearHighlights,
  select,
  markPick,
  clearPicks,
  syncCharacters,
  syncJobs,
  filter: filterRoster,
  randomize
});

// Job reconciliation is additive; it must never hold the initial roster paint.
syncJobs(INITIAL_FIGHTER_JOBS).catch(error => {
  console.warn('Could not reconcile fighter jobs:', error);
});

// Debug hook: inspect the chosen font face and horizontal fit.
window.__replicaCaption = Object.freeze({ fitCaption });

window.__replicaMetrics = Object.freeze({
  get nativeGrid() { return currentGridLayout.width + 'x' + currentGridLayout.height; },
  get columns() { return currentGridLayout.columns; },
  get rows() { return currentGridLayout.rows; },
  cellInterior: CELL_W + 'x' + CELL_H,
  get cellElements() { return cells.size; },
  get mountedCellElements() { return mountedCells.size; },
  sharedRule: RULE + 'px',
  captionRendering: 'native text with shared WOFF2 fonts',
  runtimeFontAssetRequests: 3,
  get renderedCaptions() {
    return [...cells.values()].filter(cell =>
      cell.querySelector('.replica-caption-layer')
    ).length;
  },
  get characterPortraits() {
    return [...cells.values()].filter(cell =>
      cell.querySelector('.replica-portrait-layer')
    ).length;
  },
  get runtimePortraitAssetRequests() {
    return [...cells.values()].filter(cell =>
      cell.querySelector('.replica-portrait-layer[src]')
    ).length;
  },
  portraitSource: 'native HTML image elements',
  portraitPreprocessing: false,
  portraitsGraded: false
});

document.documentElement.dataset.replicaReady = 'true';
