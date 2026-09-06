import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transformWithOxc } from "vite";

const source = await readFile(new URL("../src/ControllerMapper.jsx", import.meta.url), "utf8");
const { code } = await transformWithOxc(source.replace(/^import .*;\n/gm, ""), "ControllerMapper.jsx", { jsx: { runtime: "classic" } });

// Run the actual component and capture effect with deterministic hooks and frames.
function harness(initialProfile = null) {
  let profile = initialProfile;
  let saves = 0;
  let cursor = 0;
  const slots = [];
  const effects = [];
  const frames = new Map();
  let nextFrame = 0;
  const pad = { id: "Test pad", index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
  const api = {
    getProfile: () => profile,
    profileSource: () => "default",
    rawGamepads: () => [pad],
    saveProfile: (_, value) => { profile = value; saves++; return true; },
  };
  const context = {
    window: { openSmashControllerRemap: api, requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: (id) => frames.delete(id) },
    padDisplayName: (id) => id,
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }) },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  vm.createContext(context);
  vm.runInContext(code.replace("export default function ControllerMapper", "function ControllerMapper") + "\nthis.Component = ControllerMapper;", context);
  let tree;
  const props = { pad, onSaved() {} };
  function render() { cursor = 0; tree = context.Component(props); effects.splice(0).forEach((fn) => fn()); }
  function find(node, predicate) { if (!node || typeof node !== "object") return null; if (predicate(node)) return node; for (const child of node.children || []) { const match = find(child, predicate); if (match) return match; } return null; }
  render();
  return {
    pad,
    get profile() { return JSON.parse(JSON.stringify(profile)); },
    get saves() { return saves; },
    get pending() { return frames.size; },
    click(label) { const button = find(tree, (n) => n.type === "button" && (n.props["aria-label"] === label || n.children.includes(label))); assert.ok(button, label); button.props.onClick(); render(); },
    tick() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn()); render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test("single-button capture saves once and preserves custom buttons and axes", () => {
  const h = harness({ mode: "custom", buttons: { a: 0, b: 1 }, axes: { z: { index: 3, neutral: 0, value: 1 } } });
  h.click("Remap A");
  h.pad.buttons[7].pressed = true;
  h.tick();
  assert.equal(h.saves, 1);
  assert.deepEqual(h.profile, { mode: "custom", buttons: { a: 7, b: 1 }, axes: { z: { index: 3, neutral: 0, value: 1 } } });
  assert.equal(h.pending, 0);
});

test("single-axis capture preserves standard defaults and replaces a button binding", () => {
  const h = harness({ mode: "standard", buttons: { a: 1, b: 0 }, axes: {} });
  h.click("Remap A");
  h.pad.axes[2] = 0.8;
  h.tick();
  assert.deepEqual(h.profile, { mode: "standard", buttons: { b: 0 }, axes: { a: { index: 2, value: 0.8, neutral: 0 } } });
});

test("cancel discards partial full mapping before a single-button edit", () => {
  const h = harness();
  h.click("Map every button");
  h.pad.buttons[5].pressed = true;
  h.tick();
  h.click("Cancel mapping");
  h.pad.buttons[5].pressed = false;
  h.click("Remap B");
  h.pad.buttons[7].pressed = true;
  h.tick();
  assert.deepEqual(h.profile, { mode: "standard", buttons: { b: 7 }, axes: {} });
});

test("unmount on the final mapping step cancels capture without saving during play", () => {
  const h = harness();
  h.click("Map every button");
  for (let i = 0; i < 13; i++) {
    h.pad.buttons[0].pressed = false;
    h.tick();
    h.pad.buttons[0].pressed = true;
    h.tick();
  }
  assert.equal(h.saves, 0);
  assert.equal(h.pending, 1);
  h.unmount();
  assert.equal(h.pending, 0);
  h.pad.buttons[0].pressed = false;
  h.tick();
  h.pad.buttons[1].pressed = true;
  h.tick();
  assert.equal(h.saves, 0);
});

test("Settings unmounts the mapper on external close and at dismissal start", async () => {
  const settings = await readFile(new URL("../src/SettingsModal.jsx", import.meta.url), "utf8");
  const modal = await readFile(new URL("../src/ModalPage.jsx", import.meta.url), "utf8");
  assert.match(settings, /open && page === "mapping" && mappingPad &&/);
  assert.match(settings, /onClosing=\{\(\) => setMappingPad\(null\)\}/);
  assert.match(modal, /closingRef.current = true;\s+onClosingRef.current\?\.\(\);/);
});
