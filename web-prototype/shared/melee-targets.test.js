import test from "node:test";
import assert from "node:assert/strict";
import { MELEE_TARGETS, meleeTargetFor } from "./melee-targets.js";

test("Melee defaults follow SM64, translating its fighter names", () => {
  for (const [base, target] of [["mario", "mario"], ["donkey", "donkey-kong"], ["captain", "captain-falcon"], ["purin", "jigglypuff"]]) {
    assert.equal(meleeTargetFor({ base }), target);
    assert.equal(meleeTargetFor({ base, meleeTarget: "match-sm64" }), target);
  }
  assert.equal(meleeTargetFor({}), "mario");
});

test("every supported Melee override takes precedence over the SM64 fighter", () => {
  assert.ok(MELEE_TARGETS.some(({ value }) => value === "marth"));
  for (const { value } of MELEE_TARGETS) {
    assert.equal(meleeTargetFor({ base: "luigi", meleeTarget: value }), value);
  }
});
