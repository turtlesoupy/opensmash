import test from "node:test";
import assert from "node:assert/strict";

import {
  availableBodyModels,
  fighterFrame,
  fighterSlotAtPoint,
  OG_ROSTER_SLOTS,
  resizeHandleAtPoint,
  rosterSlotAtPoint,
  shuffledRoster,
} from "./og-studio.js";

test("the OG randomizer samples fighters without repeats", () => {
  const characters = Array.from({ length: 20 }, (_, index) => ({ slug: `fighter${index}` }));
  const result = shuffledRoster(characters, 11, () => 0.42);

  assert.equal(result.length, 11);
  assert.equal(new Set(result.map(({ slug }) => slug)).size, 11);
  assert.deepEqual(characters.map(({ slug }) => slug), Array.from({ length: 20 }, (_, index) => `fighter${index}`));
});

test("the OG randomizer gracefully handles an empty or short roster", () => {
  assert.deepEqual(shuffledRoster([], 11), []);
  assert.equal(shuffledRoster([{ slug: "one" }, { slug: "two" }], 11).length, 2);
});

test("overlapping fighter hit testing selects the frontmost slot", () => {
  const front = OG_ROSTER_SLOTS.at(-1);
  const x = front.x + front.width / 2;
  const y = front.y + front.height / 2;

  assert.equal(rosterSlotAtPoint(x, y), OG_ROSTER_SLOTS.length - 1);
  assert.equal(rosterSlotAtPoint(-100, -100), -1);
});

test("fighter frames apply zoom and direct-manipulation offsets", () => {
  const slot = { x: 100, y: 50, width: 300, height: 400, zoom: 1 };
  const frame = fighterFrame(slot, { zoom: 1.5, offsetX: 2, offsetY: -1 });

  assert.deepEqual(frame, { x: 121, y: -90, width: 450, height: 600 });
  assert.equal(resizeHandleAtPoint(frame.x + frame.width, frame.y + frame.height, slot, {
    zoom: 1.5,
    offsetX: 2,
    offsetY: -1,
  }), "se");
});

test("transformed fighter hit testing follows the visible selection frame", () => {
  const placements = OG_ROSTER_SLOTS.map((slot) => ({ slug: slot.id, zoom: slot.zoom, offsetX: 20, offsetY: 0 }));
  const frame = fighterFrame(OG_ROSTER_SLOTS.at(-1), placements.at(-1));

  assert.equal(fighterSlotAtPoint(frame.x + frame.width / 2, frame.y + frame.height / 2, placements), placements.length - 1);
  assert.equal(fighterSlotAtPoint(-100, -100, placements), -1);
});

test("empty fighter positions cannot be selected", () => {
  const placements = OG_ROSTER_SLOTS.map((slot) => ({ slug: null, zoom: slot.zoom, offsetX: 0, offsetY: 0 }));
  const frame = fighterFrame(OG_ROSTER_SLOTS.at(-1), placements.at(-1));
  assert.equal(fighterSlotAtPoint(frame.x + frame.width / 2, frame.y + frame.height / 2, placements), -1);
});

test("body choices include Mario and only variants present in the fighter bundle", () => {
  assert.deepEqual(
    availableBodyModels({ base: "link", variants: ["fox", "link", "ness"] }).map(({ value }) => value),
    ["mario", "fox", "link", "ness"],
  );
});
