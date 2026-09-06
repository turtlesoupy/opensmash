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
  const listeners = {};
  const window = { addEventListener(type, fn) { listeners[type] = fn; } };
  vm.runInNewContext(source, { window, navigator, localStorage, Proxy, Reflect, Object, Array, Number, Boolean, JSON, String, Set });
  return { api: window.openSmashControllerRemap, navigator, localStorage, listeners };
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

test("hat directions do not overlap each other or the neutral position", () => {
  const gamepad = pad();
  const { api, navigator } = harness(gamepad);
  const directions = { dup: -1, ddown: -0.43, dleft: 0.14, dright: 0.71 };
  api.saveProfile(gamepad.id, {
    mode: "custom",
    axes: Object.fromEntries(Object.entries(directions).map(([control, value]) =>
      [control, { index: 2, neutral: 1, value }])),
  });
  for (const [expected, value] of [...Object.entries(directions), [null, 1]]) {
    gamepad.axes = [0, 0, value];
    const buttons = navigator.getGamepads()[0].buttons;
    Object.keys(directions).forEach((control, index) => {
      assert.equal(buttons[12 + index].pressed, control === expected, `${expected}: ${control}`);
    });
  }
});

test("failed storage writes preserve the active profile", () => {
  const gamepad = pad();
  const { api, localStorage } = harness(gamepad);
  assert.equal(api.saveProfile(gamepad.id, { mode: "standard", buttons: { a: 1, b: 0 } }), true);
  localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  assert.equal(api.saveProfile(gamepad.id, { mode: "custom", buttons: { a: 3 } }), false);
  assert.equal(api.disableProfile(gamepad.id), false);
  assert.equal(api.getProfile(gamepad.id).buttons.a, 1);
});

test("analog mappings stay held beyond the captured position and release at rest", () => {
  const gamepad = pad();
  const { api, navigator } = harness(gamepad);
  api.saveProfile(gamepad.id, {
    mode: "custom",
    axes: {
      cright: { index: 2, neutral: 0, value: 0.3 },
      cleft: { index: 2, neutral: 0, value: -0.28 },
      cup: { index: 3, neutral: 0, value: -0.32 },
      cdown: { index: 3, neutral: 0, value: 0.27 },
      z: { index: 4, neutral: -1, value: -0.7 },
    },
  });
  for (const value of [0.32, 0.5, 1]) {
    for (const sign of [-1, 1]) {
      gamepad.axes = [0, 0, sign * value, sign * value, value];
      const mapped = navigator.getGamepads()[0];
      assert.deepEqual(Array.from(mapped.axes), [0, 0, sign, sign]);
      assert.equal(mapped.buttons[6].pressed, true);
    }
  }
  gamepad.axes = [0, 0, 0.1, -0.1, -1];
  const mapped = navigator.getGamepads()[0];
  assert.deepEqual(Array.from(mapped.axes), [0, 0, 0, 0]);
  assert.equal(mapped.buttons[6].pressed, false);
});

test("eight-way hats activate adjacent directions on all four diagonals", () => {
  // Cover cardinal values on either alternating set of the eight positions.
  for (const offset of [0, 1]) {
    const gamepad = pad();
    const { api, navigator } = harness(gamepad);
    const controls = ["dup", "dright", "ddown", "dleft"];
    api.saveProfile(gamepad.id, {
      mode: "custom",
      axes: Object.fromEntries(controls.map((control, i) => [control, {
        index: 2, neutral: 9 / 7, value: -1 + (2 * i + offset) * 2 / 7,
      }])),
    });
    const targets = { dup: 12, dright: 15, ddown: 13, dleft: 14 };
    for (let position = 0; position < 8; position++) {
      gamepad.axes = [0, 0, -1 + position * 2 / 7];
      const mapped = navigator.getGamepads()[0];
      controls.forEach((control, i) => {
        const distance = (position - (2 * i + offset) + 8) % 8;
        assert.equal(mapped.buttons[targets[control]].pressed,
          distance === 0 || distance === 1 || distance === 7,
          `offset ${offset}, position ${position}, ${control}`);
      });
    }
    gamepad.axes[2] = 9 / 7;
    assert.ok(navigator.getGamepads()[0].buttons.every((button) => !button.pressed));
  }
});

test("a single standard override preserves other browser buttons and analog sticks", () => {
  const gamepad = pad();
  gamepad.axes = [0.25, -0.5, 0.6, -0.7];
  const { api, navigator } = harness(gamepad);
  api.saveProfile(gamepad.id, { mode: "standard", buttons: { a: 7 } });
  const mapped = navigator.getGamepads()[0];
  assert.equal(mapped.buttons[0].pressed, false);
  assert.deepEqual(Array.from(mapped.axes), gamepad.axes);
  assert.equal(mapped.buttons[1].pressed, gamepad.buttons[1].pressed);
});

test("a single C-direction override replaces native input only in that direction", () => {
  const gamepad = pad();
  const { api, navigator } = harness(gamepad);
  api.saveProfile(gamepad.id, { mode: "standard", buttons: { cright: 7 } });
  gamepad.axes = [0, 0, 0.8, -0.6];
  assert.deepEqual(Array.from(navigator.getGamepads()[0].axes), [0, 0, 0, -0.6]);
  gamepad.buttons[7].pressed = true;
  assert.equal(navigator.getGamepads()[0].axes[2], 1);
  gamepad.buttons[7].pressed = false;
  gamepad.axes[2] = -0.8;
  assert.equal(navigator.getGamepads()[0].axes[2], -0.8);
});


test("polling caches configuration while storage events update other frames", () => {
  const gamepad = pad();
  const { api, navigator, localStorage, listeners } = harness(gamepad);
  api.saveProfile(gamepad.id, { mode: "standard", buttons: { a: 1, b: 0 } });
  const profile = api.getProfile(gamepad.id);
  let reads = 0;
  const getItem = localStorage.getItem;
  localStorage.getItem = key => { reads++; return getItem(key); };
  for (let i = 0; i < 120; i++) navigator.getGamepads();
  assert.equal(reads, 0);
  assert.equal(api.getProfile(gamepad.id), profile);
  localStorage.setItem(api.storageKey, JSON.stringify({version: 1, profiles: {}}));
  listeners.storage({ key: api.storageKey });
  assert.equal(navigator.getGamepads()[0], gamepad);
  assert.equal(reads, 1);
  localStorage.setItem(api.storageKey, JSON.stringify({version: 1, profiles: { [gamepad.id]: {mode: "custom", buttons: {a: 0}} }}));
  listeners.storage({ key: api.storageKey });
  assert.equal(navigator.getGamepads()[0].buttons[0].pressed, true);
  localStorage.setItem(api.storageKey, "");
  listeners.storage({ key: null });
  assert.equal(navigator.getGamepads()[0], gamepad);
});
