import assert from "node:assert/strict";
import test from "node:test";
import { assignRosterBases, bundleForBase, DEFAULT_ROSTER_BASES } from "./roster.js";

const variants = [
  "fox", "donkey", "samus", "luigi", "link", "yoshi",
  "captain", "kirby", "pikachu", "purin", "ness",
];

test("default assignment is roughly balanced, omits experimental targets, and is order-invariant", () => {
  const characters = Array.from({ length: 1000 }, (_, index) => ({
    slug: `fighter${index}`, base: null, variants,
  }));
  const assigned = assignRosterBases(characters);
  const counts = new Map(DEFAULT_ROSTER_BASES.map((base) => [base, 0]));
  for (const character of assigned) {
    assert.notEqual(character.base, "donkey");
    assert.notEqual(character.base, "yoshi");
    counts.set(character.base, counts.get(character.base) + 1);
  }
  for (const count of counts.values()) assert.ok(count > 60 && count < 140, `unbalanced: ${[...counts]}`);

  const byslug = new Map(assigned.map((c) => [c.slug, c.base]));
  const shuffled = [...characters].reverse().slice(0, 500);
  shuffled.splice(3, 0, { slug: "newcomer", base: "kirby", variants });
  for (const character of assignRosterBases(shuffled)) {
    if (character.slug !== "newcomer") assert.equal(character.base, byslug.get(character.slug));
  }
});

test("preferences constrain balancing and explicit experimental bases win", () => {
  const assigned = assignRosterBases([
    { slug: "preferred", base: null, preferredBases: ["purin", "kirby"], variants },
    { slug: "explicit", base: "dk", variants },
  ]);
  assert.equal(assigned[0].base, "purin");
  assert.equal(assigned[1].base, "donkey");
});

test("one OSB6 bundle serves every resolved base", () => {
  assert.equal(bundleForBase("michelleobama", "mario"), "michelleobama.osb6");
  assert.equal(bundleForBase("michelleobama", "captain"), "michelleobama.osb6");
});
