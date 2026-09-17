// Classic script for the engine iframe; also imported by the launcher bundle.
(function () {
  if (globalThis.openSmashN64Keyboard) return;
  const storageKey = 'opensmash-n64-keyboard-v1';
  const actions = [
    ['up', 'Move up', 'KeyW'], ['down', 'Move down', 'KeyS'],
    ['left', 'Move left', 'KeyA'], ['right', 'Move right', 'KeyD'],
    ['a', 'A · Attack / confirm', 'KeyJ'], ['b', 'B · Special / back', 'KeyK'],
    ['z', 'Z · Grab', 'KeyL'], ['l', 'L', 'KeyI'], ['r', 'R · Shield', 'KeyO'],
    ['start', 'Start / pause', 'Space'], ['cup', 'C-Up · Jump', 'KeyU'],
    ['cdown', 'C-Down', ''], ['cleft', 'C-Left', ''], ['cright', 'C-Right', ''],
    ['dup', 'D-pad up', 'KeyT'], ['ddown', 'D-pad down', 'KeyG'],
    ['dleft', 'D-pad left', 'KeyF'], ['dright', 'D-pad right', 'KeyH'],
  ].map(([id, label, code]) => ({ id, label, code }));
  const aliases = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    a: ['ControlLeft', 'ControlRight'], b: ['AltLeft', 'AltRight'], z: ['ShiftLeft', 'ShiftRight'],
    start: ['Enter', 'NumpadEnter'] };
  const bits = { a:0x8000, b:0x4000, z:0x2000, start:0x1000, l:0x20, r:0x10,
    cup:8, cdown:4, cleft:2, cright:1, dup:0x800, ddown:0x400, dleft:0x200, dright:0x100 };
  const bindable = new Set([...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', c=>'Key'+c),
    ...Array.from('0123456789', c=>'Digit'+c), 'Space', 'Enter', 'NumpadEnter',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight']);
  const defaults = () => Object.fromEntries(actions.map(a => [a.id, a.code]));
  const listeners = new Set();
  let current;
  const storage = () => globalThis.meleeDesktop?.storage || globalThis.localStorage;
  function load() {
    if (current) return current;
    current = defaults();
    try {
      const saved = JSON.parse(storage()?.getItem(storageKey) || '{}');
      for (const {id} of actions) if (saved[id] === '' || bindable.has(saved[id])) current[id] = saved[id];
    } catch {}
    return current;
  }
  function save(value) {
    // Surface persistence failures in the editor instead of claiming it saved.
    storage()?.setItem(storageKey, JSON.stringify(value));
    current = value;
    listeners.forEach(fn => fn());
  }
  function rebind(value, action, code) {
    if (!actions.some(a=>a.id===action) || !bindable.has(code)) return value;
    const next = {...value};
    const other = actions.find(a=>a.id!==action && next[a.id]===code);
    if (other) next[other.id] = next[action];
    next[action] = code;
    return next;
  }
  function resolve(code, value = load()) {
    const primary = actions.find(a=>value[a.id] && value[a.id]===code);
    if (primary) return primary.id;
    // Legacy shortcuts remain only for actions still using their default key.
    return actions.find(a=>value[a.id]===a.code && aliases[a.id]?.includes(code))?.id ?? null;
  }
  function sample(keys, value = load()) {
    const active = new Set([...keys].map(code=>resolve(code, value)));
    let button = 0;
    for (const [id, bit] of Object.entries(bits)) if (active.has(id)) button |= bit;
    return {button, sx:80*(Number(active.has('right'))-Number(active.has('left'))),
      sy:80*(Number(active.has('up'))-Number(active.has('down')))};
  }
  function label(code) {
    return ({Space:'Space', Enter:'Enter', NumpadEnter:'Numpad Enter', ArrowUp:'↑', ArrowDown:'↓',
      ArrowLeft:'←', ArrowRight:'→', ControlLeft:'Left Ctrl', ControlRight:'Right Ctrl',
      AltLeft:'Left Alt', AltRight:'Right Alt', ShiftLeft:'Left Shift', ShiftRight:'Right Shift'})[code]
      || code?.replace(/^(Key|Digit)/, '') || 'Unbound';
  }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  globalThis.addEventListener?.('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    current = undefined;
    listeners.forEach(fn=>fn());
  });
  let installed = false;
  function installEngine() {
    if (installed) return;
    installed = true;
    const held = new Set();
    const pulses = new Set();
    const clear = () => { held.clear(); pulses.clear(); };
    // Install before the engine's handlers. Synthetic touch/automation input
    // retains the engine's default mapping; physical input is sampled below.
    for (const type of ['keydown', 'keyup']) globalThis.addEventListener(type, event => {
      if (!event.isTrusted || event.code==='Escape' || event.code==='F11') return;
      if (event.metaKey) { clear(); return; }
      if (type==='keydown') { held.add(event.code); pulses.add(event.code); }
      else held.delete(event.code);
      if (resolve(event.code)) event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    globalThis.addEventListener('blur', clear);
    globalThis.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', ()=>{if(document.hidden)clear();});
    subscribe(clear);
    document.addEventListener('DOMContentLoaded', () => {
      const ports = globalThis.controllerPorts;
      if (!ports) return;
      const originalRead = ports.readPorts;
      ports.readPorts = function (ptr) {
        originalRead(ptr);
        const heap = globalThis.Module?.HEAP32;
        if (!heap) return;
        // Preserve taps that begin and end between two engine frames.
        const input = sample(new Set([...held, ...pulses]));
        pulses.clear();
        for (let i=0; i<4; i++) {
          const offset=(ptr>>2)+i*4;
          if (heap[offset]!==2) continue;
          heap[offset+1] |= input.button;
          heap[offset+2] = Math.max(-80, Math.min(80, heap[offset+2]+input.sx));
          heap[offset+3] = Math.max(-80, Math.min(80, heap[offset+3]+input.sy));
        }
      };
    }, {once:true});
  }
  globalThis.openSmashN64Keyboard = {actions, defaults, load, save, rebind, resolve, sample, label, subscribe, installEngine};
})();
