import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transformWithOxc } from "vite";
import { dispatchGameKey, dispatchGameStick, joystickAxesForVector, joystickCodesForVector } from "./mobile-input.js";

// Run the component's real handlers with a minimal hook/element host. Focus
// synchronously blurs the parent, matching the iframe transition at issue.
const source = await readFile(new URL("../src/MobileControls.jsx", import.meta.url), "utf8");
const { code } = await transformWithOxc(source, "MobileControls.jsx", { jsx: { runtime: "classic" } });
function mountControls({ analog = false } = {}) {
  const stickSamples = [];
  const frameListeners = new Map();
  const listeners = new Map();
  const effects = [];
  const engineHeld = new Set();
  const events = [];
  const frames = new Map();
  let nextFrame = 0, stateUpdates = 0, rectReads = 0;
  const window = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener() {},
    clearTimeout() {},
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const document = { visibilityState: "visible", addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener() {} };
  const canvas = {
    focus() { listeners.get("blur")?.(); },
    dispatchEvent(event) {
      events.push(`${event.type}:${event.code}`);
      if (event.type === "keydown") engineHeld.add(event.code);
      else engineHeld.delete(event.code);
    },
  };
  const frame = {
    contentWindow: { KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } } },
    contentDocument: { getElementById: () => canvas },
    addEventListener(name, fn) { frameListeners.set(name, fn); }, removeEventListener() {},
  };
  if (analog) frame.contentWindow.controllerPorts = {
    setVirtualStick: axes => stickSamples.push(axes ? { ...axes } : null),
  };
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useCallback: (fn) => fn,
    useRef: (current) => ({ current }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => { stateUpdates++; }],
    useEffect: (fn) => effects.push(fn),
    dispatchGameKey, dispatchGameStick, joystickAxesForVector, joystickCodesForVector, window, document,
  });
  vm.runInContext(code.replace(/^import .*;\n/gm, "").replace("export default function", "function"), context);
  const tree = context.MobileControls({ active: true, frameRef: { current: frame } });
  const joystick = tree.children.find((child) => child?.props?.className === "mobile-joystick");
  joystick.props.ref.current = { getBoundingClientRect: () => {
    rectReads++;
    return { left: 0, top: 0, width: 100, height: 100 };
  } };
  const knob = { style: {} };
  joystick.children.find(child => child?.props?.className === "mobile-joystick-knob").props.ref.current = knob;
  effects.forEach((effect) => effect());
  const pointer = (pointerId) => ({ pointerId, pointerType: "touch", clientX: 90, clientY: 50,
    preventDefault() {}, currentTarget: { setPointerCapture() {} } });
  return { stickSamples, frameListeners, joystick: joystick.props, engineHeld, events, listeners, document, pointer, knob, frames,
    get stateUpdates() { return stateUpdates; }, get rectReads() { return rectReads; },
    paint() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); } };
}

test("drag coordinates update only the knob once per display frame, without rerendering controls", () => {
  const h = mountControls();
  h.joystick.onPointerDown(h.pointer(1));
  const updates = h.stateUpdates;
  assert.equal(h.engineHeld.has("KeyD"), true);
  for (let x = 70; x < 90; x++) h.joystick.onPointerMove({ ...h.pointer(1), clientX: x });
  assert.equal(h.stateUpdates, updates);
  assert.equal(h.rectReads, 1);
  assert.equal(h.frames.size, 1);
  h.paint();
  assert.equal(h.knob.style.transform, "translate(34px, 0px)");
  assert.deepEqual(h.events, ["keydown:KeyD"]);
});

test("a release before the queued paint centers the knob and releases input immediately", () => {
  const h = mountControls();
  h.joystick.onPointerDown(h.pointer(1));
  h.joystick.onPointerUp(h.pointer(1));
  assert.equal(h.engineHeld.size, 0);
  h.paint();
  assert.equal(h.knob.style.transform, "translate(0px, 0px)");
});

test("layout changes invalidate the gesture geometry and direction changes remain immediate", () => {
  const h = mountControls();
  h.joystick.onPointerDown(h.pointer(1));
  h.listeners.get("resize")();
  h.joystick.onPointerMove({ ...h.pointer(1), clientX: 10 });
  assert.equal(h.rectReads, 2);
  assert.deepEqual([...h.engineHeld], ["KeyA"]);
  assert.deepEqual(h.events, ["keydown:KeyD", "keyup:KeyD", "keydown:KeyA"]);
});

test("releasing a rightward touch leaves no movement held across iframe focus handling", () => {
  const { joystick, engineHeld, events, pointer } = mountControls();
  joystick.onPointerDown(pointer(1));
  assert.equal(engineHeld.has("KeyD"), true);
  joystick.onPointerUp(pointer(1));
  assert.equal(engineHeld.size, 0);
  assert.deepEqual(events, ["keydown:KeyD", "keyup:KeyD"]);
});

for (const interruption of ["blur", "visibilitychange", "pagehide"]) {
  test(`joystick accepts a new touch after ${interruption} without an old pointerup`, () => {
    const { joystick, engineHeld, listeners, document, pointer } = mountControls();
    joystick.onPointerDown(pointer(1));
    document.visibilityState = "hidden";
    listeners.get(interruption)();
    assert.equal(engineHeld.size, 0);
    document.visibilityState = "visible";
    joystick.onPointerDown(pointer(2));
    assert.equal(engineHeld.has("KeyD"), true);
    // A late release from the interrupted gesture must not cancel the new one.
    joystick.onLostPointerCapture(pointer(1));
    assert.equal(engineHeld.has("KeyD"), true);
    joystick.onPointerUp(pointer(2));
    assert.equal(engineHeld.size, 0);
  });
}

test("joystick blur releases movement and accepts a fresh finger after a missing pointerup", () => {
  const { joystick, engineHeld, pointer } = mountControls();
  joystick.onPointerDown(pointer(1));
  joystick.onBlur();
  assert.equal(engineHeld.size, 0);
  joystick.onPointerDown(pointer(2));
  assert.equal(engineHeld.has("KeyD"), true);
  joystick.onPointerUp(pointer(1));
  assert.equal(engineHeld.has("KeyD"), true);
  joystick.onPointerUp(pointer(2));
  assert.equal(engineHeld.size, 0);
});

for (const eventType of ["pointerup", "pointercancel"]) {
  test(`window ${eventType} recovers a release outside the joystick`, () => {
    const { joystick, engineHeld, listeners, pointer } = mountControls();
    joystick.onPointerDown(pointer(1));
    listeners.get(eventType)(pointer(2));
    assert.equal(engineHeld.has("KeyD"), true);
    listeners.get(eventType)(pointer(1));
    assert.equal(engineHeld.size, 0);
    joystick.onPointerDown(pointer(3));
    assert.equal(engineHeld.has("KeyD"), true);
    listeners.get(eventType)(pointer(1));
    assert.equal(engineHeld.has("KeyD"), true);
    joystick.onPointerUp(pointer(3));
    assert.equal(engineHeld.size, 0);
  });
}

for (const eventType of ["touchend", "touchcancel"]) {
  test(`${eventType} with no remaining fingers clears a stuck gesture`, () => {
    const { joystick, engineHeld, listeners, pointer } = mountControls();
    joystick.onPointerDown(pointer(1));
    listeners.get(eventType)({ touches: [{ identifier: 1 }] });
    assert.equal(engineHeld.has("KeyD"), true);
    listeners.get(eventType)({ touches: [] });
    assert.equal(engineHeld.size, 0);
    joystick.onPointerDown(pointer(2));
    assert.equal(engineHeld.has("KeyD"), true);
    joystick.onPointerUp(pointer(2));
    assert.equal(engineHeld.size, 0);
  });
}


test("analog stick sends proportional values, neutral at center, and reversed values immediately", () => {
  const h = mountControls({ analog: true });
  h.joystick.onPointerDown({ ...h.pointer(1), clientX: 67 });
  assert.deepEqual(h.stickSamples.at(-1), { x: 24, y: 0 });
  h.joystick.onPointerMove({ ...h.pointer(1), clientX: 50 });
  assert.deepEqual(h.stickSamples.at(-1), { x: 0, y: 0 });
  h.joystick.onPointerMove({ ...h.pointer(1), clientX: 33 });
  assert.deepEqual(h.stickSamples.at(-1), { x: -24, y: 0 });
  h.joystick.onPointerUp(h.pointer(1));
  assert.equal(h.stickSamples.at(-1), null);
  assert.equal(h.engineHeld.size, 0);
});

test("held analog position replays to a replacement engine and blur releases it", () => {
  const h = mountControls({ analog: true });
  h.joystick.onPointerDown({ ...h.pointer(1), clientX: 33 });
  h.stickSamples.length = 0;
  h.frameListeners.get("load")();
  assert.deepEqual(h.stickSamples, [{ x: -24, y: 0 }]);
  h.listeners.get("blur")();
  assert.equal(h.stickSamples.at(-1), null);
  assert.equal(h.engineHeld.size, 0);
});
