import { n64Keyboard } from './n64-keyboard.js';

// Tutorial control IDs remain stable while their physical keys are rebindable.
// CODE_CONTROLS documents the legacy defaults; live input resolves via the
// shared N64 keyboard mapping used by both runtimes.
export const CONTROL_KEYS = Object.freeze(['w', 'a', 's', 'd', 'j', 'k', 'l', 'i', 'o']);

// Physical code -> control id. Every entry is a real engine binding.
export const CODE_CONTROLS = Object.freeze({
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
  KeyJ: 'j', KeyK: 'k', KeyL: 'l', KeyI: 'i', KeyO: 'o',
  ArrowUp: 'w', ArrowDown: 's', ArrowLeft: 'a', ArrowRight: 'd',
  ControlLeft: 'j', ControlRight: 'j', AltLeft: 'k', AltRight: 'k',
  ShiftLeft: 'l', ShiftRight: 'l',
});

// What the keycap says on a US QWERTY board; other layouts override via
// the layout map (see keycapLabels()).
export const QWERTY_LABELS = Object.freeze({
  w: 'W', a: 'A', s: 'S', d: 'D', j: 'J', k: 'K', l: 'L', i: 'I', o: 'O',
});

// Short "or ..." hints shown under the tutorial keycaps.
export const CONTROL_ALT_LABELS = Object.freeze({
  stick: 'or arrow keys', j: 'or Ctrl', k: 'or Alt', l: 'or Shift',
});

// event -> control id, or null. Prefers the physical code; a synthetic
// event with only a key falls back to treating the letter as its code.
export function controlForEvent(event) {
  if (!event) return null;
  const code = typeof event.code === 'string' && event.code ? event.code
    : (typeof event.key === 'string' && event.key.length === 1 ? 'Key' + event.key.toUpperCase() : '');
  const action = n64Keyboard.resolve(code);
  return {up:'w', down:'s', left:'a', right:'d', a:'j', b:'k', z:'l', l:'i', r:'o'}[action] ?? null;
}

// A modifier pressed ON ITS OWN is a game button (Ctrl=A, Alt=B, Shift=Z),
// not a shortcut chord; anything with Meta, or a modifier held while a
// different key goes down, is left to the browser.
export function isControlChord(event) {
  if (!event || event.metaKey) return true;
  const code = String(event.code || '');
  if (event.ctrlKey && !code.startsWith('Control')) return true;
  if (event.altKey && !code.startsWith('Alt')) return true;
  return false;
}

// Per-control keycap labels for the viewer's layout: the browser's layout
// map where it exists (Chromium), else QWERTY (Firefox/Safari expose no
// layout information; guessing from presses was rejected as too weird).
export async function keycapLabels(keyboard = globalThis.navigator?.keyboard) {
  const actions = {w:'up', a:'left', s:'down', d:'right', j:'a', k:'b', l:'z', i:'l', o:'r'};
  const bindings = n64Keyboard.load();
  const codes = Object.fromEntries(Object.entries(actions).map(([control, action])=>[control, bindings[action]]));
  const labels = Object.fromEntries(Object.entries(codes).map(([control, code])=>[control, n64Keyboard.label(code)]));
  try {
    const map = keyboard?.getLayoutMap ? await keyboard.getLayoutMap() : null;
    if (map) {
      for (const [control, code] of Object.entries(codes)) {
        const label = map.get(code);
        if (typeof label === 'string' && label.length === 1) labels[control] = label.toUpperCase();
      }
    }
  } catch { /* layout map unavailable: QWERTY */ }
  return labels;
}

export function controlAltLabels() {
  const hints = {};
  if (['up','down','left','right'].every((id,index)=>n64Keyboard.resolve(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'][index])===id)) hints.stick = CONTROL_ALT_LABELS.stick;
  for (const [control, code, action] of [['j','ControlLeft','a'],['k','AltLeft','b'],['l','ShiftLeft','z']]) {
    if (n64Keyboard.resolve(code)===action) hints[control] = CONTROL_ALT_LABELS[control];
  }
  return hints;
}
