import assert from "node:assert/strict";
import test from "node:test";
import { dispatchGameKey, joystickCodesForVector } from "./mobile-input.js";

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
