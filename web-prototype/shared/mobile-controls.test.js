import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transformWithOxc } from "vite";
import { dispatchGameKey, joystickCodesForVector } from "./mobile-input.js";

// Run the component's real handlers with a minimal hook/element host. Focus
// synchronously blurs the parent, matching the iframe transition at issue.
const source = await readFile(new URL("../src/MobileControls.jsx", import.meta.url), "utf8");
const { code } = await transformWithOxc(source, "MobileControls.jsx", { jsx: { runtime: "classic" } });
function mountControls() {
  const listeners = new Map();
  const effects = [];
  const engineHeld = new Set();
  const events = [];
  const window = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener() {},
    clearTimeout() {},
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
    addEventListener() {}, removeEventListener() {},
  };
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useCallback: (fn) => fn,
    useRef: (current) => ({ current }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: (fn) => effects.push(fn),
    dispatchGameKey, joystickCodesForVector, window, document,
  });
  vm.runInContext(code.replace(/^import .*;\n/gm, "").replace("export default function", "function"), context);
  const tree = context.MobileControls({ active: true, frameRef: { current: frame } });
  const joystick = tree.children.find((child) => child?.props?.className === "mobile-joystick");
  joystick.props.ref.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  effects.forEach((effect) => effect());
  const pointer = (pointerId) => ({ pointerId, pointerType: "touch", clientX: 90, clientY: 50,
    preventDefault() {}, currentTarget: { setPointerCapture() {} } });
  return { joystick: joystick.props, engineHeld, events, listeners, document, pointer };
}

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
