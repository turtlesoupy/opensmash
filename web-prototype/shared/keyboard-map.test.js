import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTROL_KEYS, CODE_CONTROLS, controlForEvent, isControlChord, keycapLabels,
} from "./keyboard-map.js";

test("binding is by physical code: Dvorak 'c' on KeyJ is still A", () => {
  assert.equal(controlForEvent({ code: "KeyJ", key: "c" }), "j");
  assert.equal(controlForEvent({ code: "KeyJ", key: "j" }), "j");
  assert.equal(controlForEvent({ code: "KeyC", key: "j" }), null);
});

test("engine fallbacks resolve to the tutorial control ids", () => {
  assert.equal(controlForEvent({ code: "ArrowUp", key: "ArrowUp" }), "w");
  assert.equal(controlForEvent({ code: "ControlLeft", key: "Control" }), "j");
  assert.equal(controlForEvent({ code: "AltRight", key: "Alt" }), "k");
  assert.equal(controlForEvent({ code: "ShiftLeft", key: "Shift" }), "l");
  for (const v of Object.values(CODE_CONTROLS)) assert.ok(CONTROL_KEYS.includes(v));
});

test("synthetic events with only a key fall back to the letter's code", () => {
  assert.equal(controlForEvent({ key: "J" }), "j");
  assert.equal(controlForEvent({ key: "x" }), null);
  assert.equal(controlForEvent(undefined), null);
});

test("a bare modifier is a button, a chord is not", () => {
  assert.equal(isControlChord({ code: "ControlLeft", ctrlKey: true }), false);
  assert.equal(isControlChord({ code: "AltLeft", altKey: true }), false);
  assert.equal(isControlChord({ code: "ShiftLeft", shiftKey: true }), false);
  assert.equal(isControlChord({ code: "KeyJ", ctrlKey: true }), true);
  assert.equal(isControlChord({ code: "ControlLeft", metaKey: true, ctrlKey: true }), true);
});

test("keycapLabels: layout map wins, QWERTY otherwise", async () => {
  const dvorak = new Map([["KeyJ", "c"], ["KeyK", "v"], ["KeyL", "p"], ["KeyI", "g"], ["KeyO", "s"],
    ["KeyW", ","], ["KeyA", "a"], ["KeyS", "o"], ["KeyD", "e"]]);
  const labels = await keycapLabels({ getLayoutMap: async () => dvorak });
  assert.deepEqual(labels, { w: ",", a: "A", s: "O", d: "E", j: "C", k: "V", l: "P", i: "G", o: "S" });
  const none = await keycapLabels(undefined);
  assert.equal(none.j, "J");
  const broken = await keycapLabels({ getLayoutMap: async () => { throw new Error("nope"); } });
  assert.equal(broken.j, "J");
});

test('tutorial input, labels and alternate hints follow saved N64 bindings', async () => {
  const { n64Keyboard } = await import('./n64-keyboard.js');
  const { controlAltLabels } = await import('./keyboard-map.js');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{setItem(){},getItem(){return null;}} });
  try {
    n64Keyboard.save(n64Keyboard.rebind(n64Keyboard.defaults(), 'a', 'KeyP'));
    assert.equal(controlForEvent({code:'KeyP'}), 'j');
    assert.equal(controlForEvent({code:'KeyJ'}), null);
    assert.equal(controlForEvent({code:'ControlLeft'}), null);
    assert.equal((await keycapLabels()).j, 'P');
    assert.equal(controlAltLabels().j, undefined);
    assert.equal((await keycapLabels({getLayoutMap:async()=>new Map([['KeyP','r']])})).j, 'R');
    n64Keyboard.save(n64Keyboard.defaults());
  } finally {
    if(originalStorage) Object.defineProperty(globalThis,'localStorage',originalStorage);
    else delete globalThis.localStorage;
  }
});
