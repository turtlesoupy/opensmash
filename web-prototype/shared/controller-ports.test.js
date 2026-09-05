import assert from "node:assert/strict";
import test from "node:test";
import {
  choiceForEntry,
  controllerPortParams,
  humanPortCount,
  normalizePortChoices,
  padDisplayName,
  padLabel,
  planControllerPorts,
  portOptions,
} from "./controller-ports.js";

const XBOX = { index: 0, id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)" };
const PS5 = { index: 1, id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)" };
const PS5_TWIN = { index: 2, id: PS5.id };

test("no controllers: the keyboard is player one", () => {
  const plan = planControllerPorts({ gamepads: [] });
  assert.deepEqual(plan, [{ kind: "keyboard" }, null, null, null]);
  assert.equal(humanPortCount(plan), 1);
});

test("controllers take ports in index order and the keyboard stays out", () => {
  assert.deepEqual(planControllerPorts({ gamepads: [XBOX] }), [
    { kind: "gamepad", id: XBOX.id, index: 0 }, null, null, null,
  ]);
  const two = planControllerPorts({ gamepads: [PS5, XBOX] });
  assert.equal(two[0].id, XBOX.id);
  assert.equal(two[1].id, PS5.id);
  assert.equal(two[2], null);
});

test("overrides take their device and never reshuffle the defaults", () => {
  const gamepads = [XBOX, PS5];
  // Keyboard on P2 displaces the second controller; it does not reflow to P3.
  assert.deepEqual(planControllerPorts({ gamepads, ports: ["auto", "keyboard", "auto", "auto"] }), [
    { kind: "gamepad", id: XBOX.id, index: 0 }, { kind: "keyboard" }, null, null,
  ]);
  // A controller pulled onto P3 leaves its default port empty.
  const pulled = planControllerPorts({ gamepads, ports: ["auto", "auto", "gamepad:1", "auto"] });
  assert.equal(pulled[0].id, XBOX.id);
  assert.equal(pulled[1], null);
  assert.equal(pulled[2].id, PS5.id);
  // A duplicate keyboard choice is ignored.
  const twice = planControllerPorts({ gamepads, ports: ["keyboard", "auto", "keyboard", "auto"] });
  assert.deepEqual(twice[0], { kind: "keyboard" });
  assert.equal(twice[2], null);
});

test("none closes a port and a missing controller leaves it empty", () => {
  const plan = planControllerPorts({ gamepads: [XBOX], ports: ["none", "gamepad:7", "auto", "auto"] });
  assert.deepEqual(plan, [{ kind: "none" }, null, null, null]);
  assert.equal(humanPortCount(plan), 0);
});

test("the keyboard default only applies with no controllers at all", () => {
  assert.deepEqual(planControllerPorts({ gamepads: [XBOX], ports: ["none", "auto", "auto", "auto"] }), [
    { kind: "none" }, null, null, null,
  ]);
  assert.deepEqual(planControllerPorts({ gamepads: [], ports: ["none", "auto", "auto", "auto"] }), [
    { kind: "none" }, null, null, null,
  ]);
  assert.deepEqual(planControllerPorts({ gamepads: [], ports: ["auto", "keyboard", "auto", "auto"] }), [
    null, { kind: "keyboard" }, null, null,
  ]);
});

test("port options offer only unused devices", () => {
  const gamepads = [XBOX, PS5];
  const plan = planControllerPorts({ gamepads });
  assert.deepEqual(portOptions(plan, gamepads, 0).map((o) => o.value), ["keyboard", "gamepad:0"]);
  assert.deepEqual(portOptions(plan, gamepads, 2).map((o) => o.value), ["keyboard"]);
  const keyboardOn3 = planControllerPorts({ gamepads, ports: ["auto", "auto", "keyboard", "auto"] });
  assert.deepEqual(portOptions(keyboardOn3, gamepads, 3), []);
});

test("labels drop vendor noise and number identical controllers", () => {
  assert.equal(padDisplayName(XBOX.id), "Xbox Wireless Controller");
  assert.equal(padDisplayName("DualSense Wireless Controller (STANDARD GAMEPAD)"), "DualSense Wireless Controller");
  assert.equal(padDisplayName(""), "Controller");
  const gamepads = [XBOX, PS5, PS5_TWIN];
  assert.equal(padLabel(XBOX, gamepads), "Xbox Wireless Controller");
  assert.equal(padLabel(PS5, gamepads), "DualSense Wireless Controller 1");
  assert.equal(padLabel(PS5_TWIN, gamepads), "DualSense Wireless Controller 2");
});

test("choices round-trip and unknown values normalize to automatic", () => {
  assert.deepEqual(normalizePortChoices(["keyboard", "gamepad:3", "bogus", undefined]), ["keyboard", "gamepad:3", "auto", "auto"]);
  assert.equal(choiceForEntry({ kind: "gamepad", id: XBOX.id, index: 0 }), "gamepad:0");
  assert.equal(choiceForEntry(null), "auto");
  const plan = planControllerPorts({ gamepads: [XBOX] });
  assert.deepEqual(controllerPortParams(plan), { ports: JSON.stringify(plan) });
});

test("CPU and Off are distinct roles and never claim an input device", () => {
  const plan = planControllerPorts({ gamepads: [XBOX], ports: ["auto", "cpu", "none", "auto"] });
  assert.equal(plan[0].kind, "gamepad");
  assert.deepEqual(plan.slice(1), [{ kind: "cpu" }, { kind: "none" }, null]);
  assert.equal(humanPortCount(plan), 1);
  assert.equal(choiceForEntry(plan[1]), "cpu");
  assert.equal(choiceForEntry(plan[2]), "none");
  assert.deepEqual(JSON.parse(controllerPortParams(plan).ports).slice(1), [{ kind: "none" }, { kind: "none" }, null]);
});

test("automatic CPU slots accept connected controllers while explicit choices stay put", () => {
  const choices = ["auto", "auto", "none", "cpu"];
  assert.deepEqual(planControllerPorts({ ports: choices }), [{ kind: "keyboard" }, null, { kind: "none" }, { kind: "cpu" }]);
  const plan = planControllerPorts({ ports: choices, gamepads: [XBOX, PS5, PS5_TWIN] });
  assert.deepEqual(plan.map(entry => entry?.kind), ["gamepad", "gamepad", "none", "cpu"]);
});
