import assert from "node:assert/strict";
import test from "node:test";
import { dispatchGameKey, dispatchGameStick, joystickAxesForVector, joystickCodesForVector } from "./mobile-input.js";

test("virtual joystick applies a dead zone and supports diagonals", () => {
  assert.deepEqual([...joystickCodesForVector(5, 5, 100)], []);
  assert.deepEqual([...joystickCodesForVector(80, 0, 100)], ["KeyD"]);
  assert.deepEqual(
    [...joystickCodesForVector(-70, -70, 100)].sort(),
    ["KeyA", "KeyW"],
  );
});

test("mobile buttons dispatch matching keydown and keyup events to the engine canvas", () => {
  const events = [];
  let focusOptions = null;
  class FakeKeyboardEvent {
    constructor(type, options) {
      this.type = type;
      this.options = options;
    }
  }
  const canvas = {
    dispatchEvent(event) { events.push(event); },
    focus(options) { focusOptions = options; },
  };
  const frame = {
    contentDocument: { getElementById: (id) => id === "canvas" ? canvas : null },
    contentWindow: { KeyboardEvent: FakeKeyboardEvent },
  };

  assert.equal(dispatchGameKey(frame, "KeyJ", true), true);
  assert.equal(dispatchGameKey(frame, "KeyJ", false), true);
  assert.equal(focusOptions, null, "touch input must not steal focus from the touch deck");
  assert.deepEqual(events.map(({ type }) => type), ["keydown", "keyup"]);
  assert.deepEqual(events.map(({ options }) => options.code), ["KeyJ", "KeyJ"]);
  assert.deepEqual(events.map(({ options }) => options.key), ["j", "j"]);
  assert.ok(events.every(({ options }) => options.bubbles && options.cancelable));
});

test("mobile input fails safely until the engine canvas is ready", () => {
  assert.equal(dispatchGameKey(null, "KeyJ", true), false);
  assert.equal(dispatchGameKey({ contentDocument: null, contentWindow: {} }, "KeyJ", true), false);
});


test("analog travel is proportional, symmetric, centered and radially bounded", () => {
  assert.deepEqual(joystickAxesForVector(28, 0, 100), { x: 0, y: 0 });
  assert.deepEqual(joystickAxesForVector(50, 0, 100), { x: 24, y: 0 });
  assert.deepEqual(joystickAxesForVector(-50, 0, 100), { x: -24, y: 0 });
  assert.deepEqual(joystickAxesForVector(0, -100, 100), { x: 0, y: 80 });
  assert.deepEqual(joystickAxesForVector(200, 0, 100), { x: 80, y: 0 });
  assert.deepEqual(joystickAxesForVector(NaN, 0, 100), { x: 0, y: 0 });
  let previous = 81;
  for (let x = 100; x >= -100; x--) {
    const axes = joystickAxesForVector(x, 0, 100);
    assert.ok(axes.x <= previous);
    assert.ok(axes.x === 0 || Math.sign(axes.x) === Math.sign(x));
    previous = axes.x;
  }
  const diagonal = joystickAxesForVector(100, 100, 100);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 80) < 1);
});

test("analog bridge handles unavailable engines and explicitly releases its override", () => {
  assert.equal(dispatchGameStick(null, { x: 20, y: 0 }), false);
  assert.equal(dispatchGameStick({ contentWindow: {} }, { x: 20, y: 0 }), false);
  const sent = [];
  const frame = { contentWindow: { controllerPorts: { setVirtualStick: axes => sent.push(axes) } } };
  assert.equal(dispatchGameStick(frame, { x: -20, y: 10 }), true);
  assert.equal(dispatchGameStick(frame, null), true);
  assert.deepEqual(sent, [{ x: -20, y: 10 }, null]);
});
