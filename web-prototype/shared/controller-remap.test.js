import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/controller-remap.js", import.meta.url), "utf8");

function harness(gamepad) {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  const navigator = { getGamepads: () => [gamepad] };
  const window = {};
  vm.runInNewContext(source, { window, navigator, localStorage, Proxy, Reflect, Object, Array, Number, Boolean, JSON, String, Set });
  return { api: window.openSmashControllerRemap, navigator };
}

function pad() {
  return {
    id: "ModRetro M64 Pro Controller",
    index: 0,
    connected: true,
    axes: [0.25, -0.5],
    buttons: Array.from({ length: 16 }, (_, index) => ({
      pressed: index === 0,
      touched: index === 0,
      value: index === 0 ? 1 : 0,
    })),
  };
}

test("swap profile exchanges browser A and B", () => {
  const { api, navigator } = harness(pad());
  assert.equal(api.saveProfile("ModRetro M64 Pro Controller", {
    mode: "standard",
    buttons: { a: 1, b: 0 },
  }), true);
  const mapped = navigator.getGamepads()[0];
  assert.equal(mapped.buttons[0].pressed, false);
  assert.equal(mapped.buttons[1].pressed, true);
  assert.deepEqual(Array.from(mapped.axes), [0.25, -0.5, 0, 0]);
});

test("M64 controllers receive the known A/B correction automatically", () => {
  const { api, navigator } = harness(pad());
  assert.equal(api.profileSource("ModRetro M64 Pro Controller"), "default");
  assert.equal(api.profileSource("M64_Controller"), "m64");

  const gamepad = api.rawGamepads()[0];
  gamepad.id = "M64_Controller";
  const mapped = navigator.getGamepads()[0];
  assert.equal(mapped.buttons[0].pressed, false);
  assert.equal(mapped.buttons[1].pressed, true);
});

test("browser defaults can explicitly disable a built-in M64 profile", () => {
  const gamepad = pad();
  gamepad.id = "M64_Controller";
  const { api, navigator } = harness(gamepad);
  api.disableProfile(gamepad.id);
  assert.equal(api.profileSource(gamepad.id), "default");
  assert.equal(navigator.getGamepads()[0], gamepad);
});

test("custom profile turns physical C buttons into the virtual C-stick", () => {
  const gamepad = pad();
  gamepad.buttons[0] = { pressed: false, touched: false, value: 0 };
  gamepad.buttons[8] = { pressed: true, touched: true, value: 1 };
  const { api, navigator } = harness(gamepad);
  api.saveProfile(gamepad.id, { mode: "custom", buttons: { cright: 8, a: 3 } });
  const mapped = navigator.getGamepads()[0];
  assert.equal(mapped.axes[2], 1);
  assert.equal(mapped.axes[3], 0);
  assert.equal(mapped.buttons[0].pressed, false);
});

test("custom profile turns an M64 hat axis direction into a D-pad button", () => {
  const gamepad = pad();
  gamepad.buttons[0] = { pressed: false, touched: false, value: 0 };
  gamepad.axes = [0, 0, 0.71];
  const { api, navigator } = harness(gamepad);
  api.saveProfile(gamepad.id, {
    mode: "custom",
    buttons: {},
    axes: { dup: { index: 2, neutral: 1, value: 0.71 } },
  });
  assert.equal(navigator.getGamepads()[0].buttons[12].pressed, true);
  gamepad.axes[2] = 1;
  assert.equal(navigator.getGamepads()[0].buttons[12].pressed, false);
});

test("clearing a profile restores the native gamepad", () => {
  const gamepad = pad();
  const { api, navigator } = harness(gamepad);
  api.saveProfile(gamepad.id, { mode: "standard", buttons: { a: 1, b: 0 } });
  api.clearProfile(gamepad.id);
  assert.equal(navigator.getGamepads()[0], gamepad);
});
