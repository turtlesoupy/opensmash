export const CHARACTER_MESHES = [
  { value: "auto", label: "Automatic" },
  { value: "mario", label: "Mario", fkind: 0 },
  { value: "fox", label: "Fox", fkind: 1 },
  { value: "donkey", label: "Donkey Kong", fkind: 2 },
  { value: "samus", label: "Samus", fkind: 3 },
  { value: "luigi", label: "Luigi", fkind: 4 },
  { value: "link", label: "Link", fkind: 5 },
  { value: "yoshi", label: "Yoshi", fkind: 6 },
  { value: "captain", label: "Captain Falcon", fkind: 7 },
  { value: "kirby", label: "Kirby", fkind: 8 },
  { value: "pikachu", label: "Pikachu", fkind: 9 },
  { value: "purin", label: "Jigglypuff", fkind: 10 },
  { value: "ness", label: "Ness", fkind: 11 },
];

export function availableFighterTargets(artifacts = {}) {
  const built = artifacts.targets || Object.keys(artifacts.variants || {});
  return CHARACTER_MESHES.filter(({ value }) => value === "mario" || (value !== "auto" && built.includes(value)));
}
