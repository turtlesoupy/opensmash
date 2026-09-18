import schema from "../../engines/melee/runtime/launch-options.json" with { type: "json" };

export const MELEE_TARGETS = schema.targets.map(({ slug, label }) => ({ value: slug, label }));

export function meleeTargetFor(character) {
  if (character.meleeTarget && character.meleeTarget !== "match-sm64") return character.meleeTarget;
  const base = character.base || character.target || "mario";
  return ({ donkey: "donkey-kong", captain: "captain-falcon", purin: "jigglypuff" })[base] || base;
}
