import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ADVANCED_OPTIONS,
  FULL_BOOT_INTRO_CARDS,
  createFullBootIntroConfig,
  engineUrl,
  characterSelectionSlots,
  hasAdvancedOverrides,
  normalizeAdvancedOptions,
  selectDirectBattleOpponents,
} from "../src/launch-options.js";

const CHARACTER = {
  slug: "testfighter",
  name: "Test Fighter",
  short: "TEST",
  fkind: 0,
  base: "mario",
  // One OSB6 per character; `variants` lists the skeleton targets built into it.
  bundle: "testfighter.osb6",
  variants: ["fox", "samus", "link", "kirby", "pikachu"],
};

function queryFor(action, options = DEFAULT_ADVANCED_OPTIONS) {
  return new URL(engineUrl(action, options), "https://example.test").searchParams;
}

test("launch URLs do not contain per-launch cache busters", () => {
  assert.equal(queryFor({ type: "start" }).has("cb"), false);
});

test("default launches start a free-for-all", () => {
  const characterQuery = queryFor({ type: "character", character: CHARACTER });
  assert.equal(characterQuery.get("inject"), "bundles/testfighter.osb6");
  assert.equal(characterQuery.get("inject_name"), "Test Fighter");
  assert.equal(characterQuery.get("inject_short"), "TEST");
  assert.equal(characterQuery.get("inject_ui"), null);
  assert.equal(characterQuery.get("inject_voice"), null);
  assert.match(characterQuery.get("SSB64_BOOT_BATTLE"), /^0,\d+,\d+,1,\d+,\d+$/);
  assert.equal(characterQuery.get("SSB64_CPU_LEVEL"), "3");

  const selectQuery = queryFor({ type: "select" });
  assert.match(selectQuery.get("SSB64_BOOT_BATTLE"), /^0,\d+,\d+,1,\d+,\d+$/);

  const startQuery = queryFor({ type: "start" });
  assert.match(startQuery.get("SSB64_BOOT_BATTLE"), /^0,\d+,\d+,1,\d+,\d+$/);
});

test("launches request only character extras that actually exist", () => {
  const query = queryFor({
    type: "character",
    character: { ...CHARACTER, ui: true, voiceUrl: "/character-assets/testfighter/announcer.wav" },
  });
  assert.equal(query.get("inject_ui"), "bundles/testfighter.osbui");
  assert.equal(query.get("inject_voice"), "/character-assets/testfighter/announcer.wav");
});

test("character launches mix one vanilla and two distinct roster fighters; own fighters are not forced in", () => {
  const grid = [
    CHARACTER,
    { ...CHARACTER, slug: "gridfighter", name: "Grid Fighter", short: "GRID", fkind: 5, bundle: "gridfighter-link.osb" },
    { ...CHARACTER, slug: "fallback", name: "Fallback", short: "FALL", fkind: 8, bundle: "fallback-kirby.osb" },
  ];
  const owned = [
    CHARACTER,
    { ...CHARACTER, slug: "myfighter", name: "My Fighter", short: "MINE", fkind: 3, bundleUrl: "/api/fighters/mine/assets/bundle" },
  ];
  const opponents = selectDirectBattleOpponents(CHARACTER, grid, owned, () => 0);
  assert.deepEqual(opponents.map((opponent) => opponent.type), ["vanilla", "character", "character"]);
  assert.equal(opponents[0].fkind, 0);
  assert.equal(opponents[1].character.slug, "gridfighter");
  assert.equal(opponents[2].character.slug, "fallback");
  assert.ok(!opponents.some((opponent) => opponent.character?.slug === "myfighter"));

  const query = queryFor(
    { type: "character", character: CHARACTER, opponents },
    { ...DEFAULT_ADVANCED_OPTIONS, stage: "0" },
  );
  assert.equal(query.get("SSB64_BOOT_BATTLE"), "0,0,0,1,5,8");
  assert.deepEqual(
    query.getAll("inject_player").map((entry) => JSON.parse(entry)),
    [
      {
        player: 2,
        slug: "gridfighter",
        fkind: 5,
        short: "GRID",
        name: "Grid Fighter",
        bundleUrl: "bundles/gridfighter-link.osb",
        uiUrl: null,
        voiceUrl: null,
        portraitUrl: null,
      },
      {
        player: 3,
        slug: "fallback",
        fkind: 8,
        short: "FALL",
        name: "Fallback",
        bundleUrl: "bundles/fallback-kirby.osb",
        uiUrl: null,
        voiceUrl: null,
        portraitUrl: null,
      },
    ],
  );
});

test("opponent slots are filled from distinct grid fighters", () => {
  const grid = [
    CHARACTER,
    { ...CHARACTER, slug: "second", fkind: 1, bundle: "second-fox.osb" },
    { ...CHARACTER, slug: "third", fkind: 2, bundle: "third-donkey.osb" },
  ];
  const opponents = selectDirectBattleOpponents(CHARACTER, grid, [CHARACTER], () => 0);
  assert.deepEqual(
    opponents.slice(1).map((opponent) => opponent.character.slug),
    ["second", "third"],
  );
});

test("duplicate roster records never cause duplicate fighters when unique choices exist", () => {
  const second = { ...CHARACTER, slug: "second", fkind: 1, bundle: "second-fox.osb" };
  const third = { ...CHARACTER, slug: "third", fkind: 2, bundle: "third-donkey.osb" };
  const opponents = selectDirectBattleOpponents(
    CHARACTER,
    [CHARACTER, second, { ...second }, third],
    [CHARACTER, second, { ...second }],
    () => 0,
  );
  const customSlugs = opponents
    .filter((opponent) => opponent.type === "character")
    .map((opponent) => opponent.character.slug);
  assert.deepEqual(customSlugs, ["second", "third"]);
  assert.equal(new Set([CHARACTER.slug, ...customSlugs]).size, 3);
});

test("full-boot launch config injects every opening card except Donkey Kong and Yoshi", () => {
  const candidates = [
    { ...CHARACTER, slug: "mario-base", fkind: 0 },
    { ...CHARACTER, slug: "fox-base", fkind: 1 },
    { ...CHARACTER, slug: "samus-base", fkind: 3 },
    { ...CHARACTER, slug: "link-base", fkind: 5 },
    { ...CHARACTER, slug: "kirby-base", fkind: 8 },
    { ...CHARACTER, slug: "pikachu-base", fkind: 9 },
  ];
  const introConfig = createFullBootIntroConfig(candidates, () => 0);

  assert.deepEqual(introConfig.map(({ fkind }) => fkind), FULL_BOOT_INTRO_CARDS.map(({ fkind }) => fkind));
  assert.deepEqual(
    introConfig.filter(({ type }) => type === "vanilla").map(({ fkind }) => fkind),
    [2, 6],
  );
  assert.equal(new Set(
    introConfig.filter(({ type }) => type === "character").map(({ character }) => character.slug),
  ).size, 6);

  const query = queryFor(
    { type: "start", introConfig },
    { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "full-boot" },
  );
  const injections = query.getAll("intro_character").map((entry) => JSON.parse(entry));
  assert.deepEqual(injections.map(({ fkind }) => fkind), [0, 3, 1, 5, 9, 8]);
  assert.equal(query.has("inject_player"), false);
  assert.equal(query.has("SSB64_START_SCENE"), false);
  assert.equal(query.has("SSB64_BOOT_BATTLE"), false);
});

test("full-boot transport preserves future Donkey Kong and Yoshi injections", () => {
  const introConfig = [
    {
      fkind: 2,
      mesh: "donkey",
      mode: "inject",
      type: "character",
      character: { ...CHARACTER, slug: "future-dk", fkind: 2, bundle: "future-dk-donkey.osb" },
    },
    {
      fkind: 6,
      mesh: "yoshi",
      mode: "inject",
      type: "character",
      character: { ...CHARACTER, slug: "future-yoshi", fkind: 6, bundle: "future-yoshi-yoshi.osb" },
    },
  ];
  const injections = queryFor(
    { type: "start", introConfig },
    { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "full-boot" },
  ).getAll("intro_character").map((entry) => JSON.parse(entry));

  assert.deepEqual(injections.map(({ fkind }) => fkind), [2, 6]);
  assert.deepEqual(
    injections.map(({ bundleUrl }) => bundleUrl),
    ["bundles/future-dk-donkey.osb", "bundles/future-yoshi-yoshi.osb"],
  );
});

test("clicked grid fighter is the featured first pickup on its native target", () => {
  const selected = {
    ...CHARACTER,
    slug: "selected-samus",
    fkind: 3,
    bundle: "selected-samus-samus.osb",
  };
  const introConfig = createFullBootIntroConfig(
    [CHARACTER, selected],
    () => 0,
    selected,
  );
  const featured = introConfig.find((card) => card.featured);

  assert.equal(featured.fkind, 3);
  assert.equal(featured.character.slug, "selected-samus");
  assert.equal(
    introConfig.filter((card) => card.character?.slug === "selected-samus").length,
    1,
  );
  assert.equal(queryFor(
    { type: "character", character: selected, introConfig },
    { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "full-boot" },
  ).get("SSB64_OPENING_FIRST_FKIND"), "3");
});

test("explicit clicked mesh targets the matching opening card", () => {
  const introConfig = createFullBootIntroConfig(
    [CHARACTER],
    () => 0,
    CHARACTER,
    "link",
  );
  const featured = introConfig.find((card) => card.featured);

  assert.equal(featured.fkind, 5);
  // The mesh override changes the spawned fighter, never the file.
  assert.equal(featured.character.bundle, "testfighter.osb6");
  assert.equal(featured.character.base, "link");
});

test("missing intro variants fall back to vanilla per card", () => {
  const limited = {
    ...CHARACTER,
    slug: "limited",
    bundleUrl: "https://objects.test/limited.osb6",
    variants: ["fox"],
  };
  const introConfig = createFullBootIntroConfig([limited], () => 0);
  assert.deepEqual(
    introConfig.filter(({ type }) => type === "character").map(({ fkind }) => fkind),
    [0],
  );
  assert.deepEqual(
    introConfig.filter(({ type }) => type === "vanilla").map(({ fkind }) => fkind),
    [2, 3, 1, 5, 6, 9, 8],
  );
});

test("intro launch config is exclusive to the Full Boot destination", () => {
  const introConfig = createFullBootIntroConfig([
    { ...CHARACTER, slug: "intro", fkind: 0 },
  ], () => 0);
  assert.equal(queryFor({ type: "start", introConfig }).has("intro_character"), false);
  assert.equal(queryFor(
    { type: "select", introConfig },
    { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "full-boot" },
  ).getAll("intro_character").length, 1);
  assert.equal(queryFor(
    { type: "character", character: CHARACTER, introConfig },
    { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "full-boot" },
  ).getAll("intro_character").length, 1);
});

test("mesh and stage overrides select the matching injection variant", () => {
  const query = queryFor(
    { type: "character", character: CHARACTER },
    { characterMesh: "link", stage: "4", opponentLevel: "9", bootMode: "free-for-all" },
  );
  assert.equal(query.get("inject"), "bundles/testfighter.osb6");
  assert.equal(query.get("fkind"), "5");
  assert.equal(query.get("base"), "testfighter:link");
  assert.match(query.get("SSB64_BOOT_BATTLE"), /^5,\d+,4,1,\d+,\d+$/);
  assert.equal(query.get("SSB64_CPU_LEVEL"), "9");
});

test("boot overrides address the distinct engine scenes", () => {
  const vsMenu = queryFor(
    { type: "character", character: CHARACTER },
    { characterMesh: "auto", stage: "6", bootMode: "vs-menu" },
  );
  assert.equal(vsMenu.get("SSB64_START_SCENE"), "9");
  assert.equal(vsMenu.get("SSB64_BOOT_BATTLE"), "0,8,6");

  const vsSelect = queryFor(
    { type: "select" },
    { characterMesh: "auto", stage: "3", bootMode: "vs-character-select" },
  );
  assert.equal(vsSelect.get("SSB64_START_SCENE"), "16");
  assert.equal(vsSelect.get("SSB64_BOOT_BATTLE"), "-1,8,3");

  const onePlayerSelect = queryFor(
    { type: "select" },
    { characterMesh: "auto", stage: "3", bootMode: "one-player-character-select" },
  );
  assert.equal(onePlayerSelect.get("SSB64_START_SCENE"), "17");
  assert.equal(onePlayerSelect.get("SSB64_BOOT_BATTLE"), null);
});

test("stored settings are allow-listed and report active overrides", () => {
  assert.deepEqual(normalizeAdvancedOptions({ characterMesh: "bad", stage: "4", opponentLevel: "99", bootMode: "bad" }), {
    characterMesh: "auto",
    selectionMode: "playing-characters",
    stage: "4",
    opponentLevel: "3",
    bootMode: "free-for-all",
    framePacing: "display",
    renderResolution: "1280x960",
    ports: ["auto", "auto", "auto", "auto"],
  });
  assert.equal(hasAdvancedOverrides(DEFAULT_ADVANCED_OPTIONS), false);
  assert.equal(hasAdvancedOverrides({ ...DEFAULT_ADVANCED_OPTIONS, stage: "4" }), true);
});

test("a missing forced mesh variant produces a useful error", () => {
  assert.throws(
    () => queryFor(
      {
        type: "character",
        character: { ...CHARACTER, bundleUrl: "https://objects.test/testfighter.osb6", variants: ["link"] },
      },
      { characterMesh: "fox", stage: "random", bootMode: "free-for-all" },
    ),
    /does not have a Fox mesh variant/,
  );
});

const XBOX_PAD = { index: 0, id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)" };
const PS5_PAD = { index: 1, id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)" };

function queryWithPads(action, gamepads, options = DEFAULT_ADVANCED_OPTIONS) {
  return new URL(engineUrl(action, options, gamepads), "https://example.test").searchParams;
}

test("launches always tell the engine which device drives each port", () => {
  const keyboardOnly = queryWithPads({ type: "character", character: CHARACTER }, []);
  assert.deepEqual(JSON.parse(keyboardOnly.get("ports")), [{ kind: "keyboard" }, null, null, null]);
  assert.equal(keyboardOnly.has("SSB64_BOOT_HUMANS"), false);
  assert.match(keyboardOnly.get("SSB64_BOOT_BATTLE"), /^0,\d+,\d+,1,\d+,\d+$/);

  const onePad = queryWithPads({ type: "character", character: CHARACTER }, [XBOX_PAD]);
  assert.equal(JSON.parse(onePad.get("ports"))[0].kind, "gamepad");
  assert.equal(JSON.parse(onePad.get("ports"))[1], null);
  assert.match(onePad.get("SSB64_BOOT_BATTLE"), /^0,\d+,\d+,1,\d+,\d+$/);
});

const SECOND = { slug: "secondfighter", name: "Second Fighter", fkind: 5, base: "link", bundle: "secondfighter-link.osb", ui: true };

test("double select boots a direct battle with two human ports", () => {
  const query = queryWithPads(
    { type: "character", character: CHARACTER, picks: [SECOND], opponents: [
      { type: "vanilla", fkind: 8 },
      { type: "character", character: SECOND },
      { type: "character", character: { slug: "third", name: "Third", fkind: 2, bundle: "third-donkey.osb" } },
    ] },
    [XBOX_PAD, PS5_PAD],
  );
  assert.equal(query.has("SSB64_START_SCENE"), false);
  assert.equal(query.get("SSB64_BOOT_HUMANS"), "2");
  assert.match(query.get("SSB64_BOOT_BATTLE"), /^0,5,\d+,0,8,2$/);
  const rows = query.getAll("inject_player").map((row) => JSON.parse(row));
  assert.deepEqual(rows.map((row) => [row.player, row.slug]), [[1, "secondfighter"], [3, "third"]]);
  assert.equal(rows[0].bundleUrl, "bundles/secondfighter-link.osb");
  assert.equal(rows[0].uiUrl, "bundles/secondfighter.osbui");
});

test("two human ports without picks open the character select", () => {
  const query = queryWithPads({ type: "character", character: CHARACTER }, [XBOX_PAD, PS5_PAD]);
  assert.equal(query.get("SSB64_START_SCENE"), "16");
  assert.equal(query.get("roster"), "1");
  assert.equal(query.get("SSB64_BOOT_HUMANS"), "2");
  assert.match(query.get("SSB64_BOOT_BATTLE"), /^0,-1,\d+,0,\d+,\d+$/);
  assert.equal(query.get("SSB64_BOOT_SLOTS"), "hhcc");
  assert.equal(query.has("inject_player"), false);
  assert.equal(query.get("inject"), "bundles/testfighter.osb6");
});

test("explicit port choices shape the plan and count as overrides", () => {
  const options = { ...DEFAULT_ADVANCED_OPTIONS, ports: ["gamepad:0", "keyboard", "none", "gamepad:1"] };
  const query = queryWithPads({ type: "character", character: CHARACTER }, [XBOX_PAD, PS5_PAD], options);
  const plan = JSON.parse(query.get("ports"));
  assert.equal(plan[0].id, XBOX_PAD.id);
  assert.deepEqual(plan[1], { kind: "keyboard" });
  assert.deepEqual(plan[2], { kind: "none" });
  assert.equal(plan[3].id, PS5_PAD.id);
  assert.equal(query.get("SSB64_BOOT_HUMANS"), "3");
  assert.equal(hasAdvancedOverrides(normalizeAdvancedOptions(options)), true);
  assert.equal(hasAdvancedOverrides(normalizeAdvancedOptions(DEFAULT_ADVANCED_OPTIONS)), false);
});

test("multiplayer also applies to preselected VS launches", () => {
  const options = { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "vs-character-select" };
  const query = queryWithPads({ type: "character", character: CHARACTER }, [XBOX_PAD, PS5_PAD], options);
  assert.equal(query.get("SSB64_START_SCENE"), "16");
  assert.equal(query.get("SSB64_BOOT_HUMANS"), "2");
  assert.match(query.get("SSB64_BOOT_BATTLE"), /^0,-1,\d+,0,-1,-1$/);
});


test("automatic launch uses the character's saved target", () => {
  const character = { ...CHARACTER, base: "luigi", fkind: 4, variants: ["luigi"] };
  const query = queryFor({ type: "character", character });
  assert.match(query.get("SSB64_BOOT_BATTLE"), /^4,/);
  assert.equal(query.get("inject"), "bundles/testfighter.osb6");
});

test("selection mode defaults safely and full roster labels CPU slots", () => {
  assert.equal(normalizeAdvancedOptions({}).selectionMode, "playing-characters");
  assert.equal(normalizeAdvancedOptions({ selectionMode: "invalid" }).selectionMode, "playing-characters");
  assert.deepEqual(characterSelectionSlots(DEFAULT_ADVANCED_OPTIONS), ["1P"]);
  assert.deepEqual(characterSelectionSlots(DEFAULT_ADVANCED_OPTIONS, [XBOX_PAD, PS5_PAD]), ["1P", "2P"]);
  const options = { ...DEFAULT_ADVANCED_OPTIONS, selectionMode: "full-roster" };
  assert.equal(normalizeAdvancedOptions(options).selectionMode, "full-roster");
  assert.equal(hasAdvancedOverrides(options), true);
  assert.deepEqual(characterSelectionSlots(options), ["1P", "CPU2", "CPU3", "CPU4"]);
  assert.deepEqual(characterSelectionSlots(options, [XBOX_PAD, PS5_PAD]), ["1P", "2P", "CPU3", "CPU4"]);
  assert.deepEqual(characterSelectionSlots({ ...options, bootMode: "full-boot" }), ["1P"]);
});

test("full roster preserves every chosen fighter while CPUs remain CPU controlled", () => {
  const third = { ...CHARACTER, slug: "third", fkind: 3, bundle: "third.osb6" };
  const fourth = { ...CHARACTER, slug: "fourth", fkind: 9, bundle: "fourth.osb6" };
  const action = { type: "character", character: CHARACTER, picks: [SECOND, third, fourth] };
  const options = { ...DEFAULT_ADVANCED_OPTIONS, selectionMode: "full-roster", stage: "4", opponentLevel: "7" };
  for (const [pads, humanCount] of [[[], 1], [[XBOX_PAD, PS5_PAD], 2], [[XBOX_PAD, PS5_PAD, { index: 2, id: "Third pad" }], 3], [[XBOX_PAD, PS5_PAD, { index: 2, id: "Third pad" }, { index: 3, id: "Fourth pad" }], 4]]) {
    const query = queryWithPads(action, pads, options);
    assert.equal(query.has("SSB64_START_SCENE"), false);
    assert.equal(query.get("SSB64_BOOT_BATTLE"), `0,5,4,${humanCount >= 2 ? 0 : 1},3,9`);
    assert.equal(query.get("SSB64_BOOT_HUMANS"), humanCount >= 2 ? String(humanCount) : null);
    assert.equal(query.get("SSB64_CPU_LEVEL"), "7");
    assert.deepEqual(query.getAll("inject_player").map(row => {
      const { player, slug } = JSON.parse(row);
      return [player, slug];
    }), [[1, "secondfighter"], [2, "third"], [3, "fourth"]]);
  }
});

test("Off slots are skipped in selection and excluded from a two-fighter battle", () => {
  const options = { ...DEFAULT_ADVANCED_OPTIONS, selectionMode: "full-roster", ports: ["keyboard", "none", "cpu", "none"], stage: "4" };
  assert.deepEqual(characterSelectionSlots(options), ["1P", "CPU3"]);
  const query = queryFor({ type: "character", character: CHARACTER, picks: [SECOND] }, options);
  assert.equal(query.get("SSB64_BOOT_SLOTS"), "hoco");
  assert.equal(query.get("SSB64_BOOT_BATTLE"), "0,-1,4,1,5,-1");
  assert.equal(JSON.parse(query.getAll("inject_player")[0]).player, 2);
});

test("sparse human slots keep controllers and selected fighters on their assigned ports", () => {
  const options = { ...DEFAULT_ADVANCED_OPTIONS, selectionMode: "full-roster", ports: ["cpu", "none", "keyboard", "gamepad:0"], stage: "4" };
  const third = { ...CHARACTER, slug: "third", fkind: 3, bundle: "third.osb6" };
  assert.deepEqual(characterSelectionSlots(options, [XBOX_PAD]), ["3P", "4P", "CPU1"]);
  const query = queryWithPads({ type: "character", character: CHARACTER, picks: [SECOND, third] }, [XBOX_PAD], options);
  assert.equal(query.get("SSB64_BOOT_SLOTS"), "cohh");
  assert.equal(query.get("SSB64_BOOT_BATTLE"), "3,-1,4,0,0,5");
  assert.equal(query.get("player"), "2");
  assert.deepEqual(query.getAll("inject_player").map(row => {
    const { player, slug } = JSON.parse(row);
    return [player, slug];
  }), [[0, "third"], [3, "secondfighter"]]);
  assert.deepEqual(JSON.parse(query.get("ports")).map(entry => entry?.kind), ["none", "none", "keyboard", "gamepad"]);
});

test("Playing only randomizes CPUs without filling Off slots", () => {
  const options = { ...DEFAULT_ADVANCED_OPTIONS, ports: ["keyboard", "cpu", "none", "none"], stage: "4" };
  assert.deepEqual(characterSelectionSlots(options), ["1P"]);
  const query = queryFor({ type: "character", character: CHARACTER, opponents: [{ type: "character", character: SECOND }] }, options);
  assert.equal(query.get("SSB64_BOOT_SLOTS"), "hcoo");
  assert.equal(query.get("SSB64_BOOT_BATTLE"), "0,5,4,1,-1,-1");
  assert.equal(query.getAll("inject_player").length, 1);
});

test("a match needs at least two enabled slots", () => {
  for (const ports of [["keyboard", "none", "none", "none"], ["none", "none", "none", "none"]]) {
    assert.throws(() => queryFor({ type: "character", character: CHARACTER }, { ...DEFAULT_ADVANCED_OPTIONS, ports }), /at least two slots/);
  }
});

test("explicit slot roles seed VS character select as well as direct battles", () => {
  const options = { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "vs-character-select", ports: ["none", "cpu", "keyboard", "none"], stage: "4" };
  const query = queryFor({ type: "character", character: CHARACTER }, options);
  assert.equal(query.get("SSB64_START_SCENE"), "16");
  assert.equal(query.get("SSB64_BOOT_SLOTS"), "ocho");
  assert.match(query.get("SSB64_BOOT_BATTLE"), /^-1,\d+,4,1,0,-1$/);
  assert.equal(query.get("player"), "2");
});
