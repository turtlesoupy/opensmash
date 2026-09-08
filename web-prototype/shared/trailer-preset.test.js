import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_ADVANCED_OPTIONS, engineUrl } from "../src/launch-options.js";
import {
  TRAILER_CPU_LEVEL,
  TRAILER_INTRO_MESHES,
  TRAILER_INTRO_ROOM_PICKS,
  TRAILER_INTRO_SLUGS,
  TRAILER_OPPONENT_SLUGS,
  TRAILER_STAGE,
  createTrailerIntroAction,
  createTrailerMatchAction,
} from "../src/trailer-preset.js";

function fighter(slug, fkind) {
  return {
    slug,
    name: slug,
    short: slug,
    fkind,
    bundle: `${slug}.osb6`,
    bundleUrl: `/bundles/${slug}.osb6`,
  };
}

test("trailer intro assigns the fixed cast to every injectable opening card", () => {
  const characters = TRAILER_INTRO_SLUGS.map((slug, index) => fighter(slug, index));
  const action = createTrailerIntroAction({
    type: "start",
    trailerIntro: true,
    trailerRecording: true,
  }, characters);
  const config = action.introConfig;

  assert.deepEqual(
    config.filter((card) => card.type === "character").map((card) => card.character.slug),
    TRAILER_INTRO_SLUGS,
  );
  assert.deepEqual(
    config.filter((card) => card.type === "character").map((card) => card.character.base),
    TRAILER_INTRO_MESHES,
  );
  assert.deepEqual(
    config.filter((card) => card.type === "vanilla").map((card) => card.mesh),
    ["donkey", "yoshi"],
  );

  const url = new URL(engineUrl(
    action,
    { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "full-boot" },
  ), "https://opensmash.test");
  assert.equal(url.searchParams.get("SSB64_TRAILER_HOLD"), "1");
  assert.equal(url.searchParams.get("SSB64_TRAILER_RECORD"), "1");
  const introEntries = url.searchParams.getAll("intro_character").map((row) => JSON.parse(row));
  assert.deepEqual(
    introEntries.map((entry) => entry.base),
    config.filter((card) => card.type === "character").map((card) => card.character.fkind),
  );
  const roomFkinds = TRAILER_INTRO_ROOM_PICKS.map((slug) =>
    config.find((card) => card.type === "character" && card.character.slug === slug).fkind,
  );
  assert.equal(url.searchParams.get("SSB64_OPENING_FIRST_FKIND"), String(roomFkinds[0]));
  assert.equal(url.searchParams.get("SSB64_OPENING_SECOND_FKIND"), String(roomFkinds[1]));
});

test("trailer hero launches the exact fixed opponents and capture settings", () => {
  const hero = fighter("nicolascage", 7);
  const opponents = TRAILER_OPPONENT_SLUGS.map((slug, index) => fighter(slug, index + 1));
  const action = createTrailerMatchAction({ type: "character", character: hero }, [hero, ...opponents]);
  const url = new URL(engineUrl(action, {
    ...DEFAULT_ADVANCED_OPTIONS,
    bootMode: "free-for-all",
    stage: TRAILER_STAGE,
    opponentLevel: TRAILER_CPU_LEVEL,
  }), "https://opensmash.test");

  assert.deepEqual(
    action.opponents.map((opponent) => opponent.character.slug),
    TRAILER_OPPONENT_SLUGS.slice(0, 3),
  );
  assert.equal(url.searchParams.get("SSB64_BOOT_BATTLE"), "7,1,7,1,2,3");
  assert.equal(url.searchParams.get("SSB64_CPU_LEVEL"), TRAILER_CPU_LEVEL);
  assert.deepEqual(
    url.searchParams.getAll("inject_player").map((row) => JSON.parse(row).slug),
    TRAILER_OPPONENT_SLUGS.slice(0, 3),
  );
});

test("selecting a configured opponent deterministically advances through the pool", () => {
  const roster = TRAILER_OPPONENT_SLUGS.map((slug, index) => fighter(slug, index + 1));
  const selected = roster[0];
  const action = createTrailerMatchAction({ type: "character", character: selected }, roster);

  assert.deepEqual(
    action.opponents.map((opponent) => opponent.character.slug),
    TRAILER_OPPONENT_SLUGS.slice(1, 4),
  );
});

test("custom trailer cast and room order reach the engine URL", () => {
  const characters = TRAILER_INTRO_SLUGS.map((_, i) => fighter(`custom${i}`, 0));
  const config = {
    introFighters: characters.map(({ slug }) => slug),
    introMeshes: [...TRAILER_INTRO_MESHES],
    introRoomPicks: ["custom4", "custom2"],
  };
  const action = createTrailerIntroAction({ type: "start", trailerIntro: true }, characters, config);
  const url = new URL(engineUrl(action, { ...DEFAULT_ADVANCED_OPTIONS, bootMode: "full-boot" }), "https://opensmash.test");
  assert.deepEqual(action.introRoomPicks, config.introRoomPicks);
  assert.deepEqual(action.introConfig.filter((card) => card.type === "character").map((card) => card.character.slug), config.introFighters);
  assert.equal(url.searchParams.get("SSB64_OPENING_FIRST_FKIND"), "9");
  assert.equal(url.searchParams.get("SSB64_OPENING_SECOND_FKIND"), "1");
  assert.equal(url.searchParams.getAll("intro_character").length, 6);
});

test("custom trailer rejects invalid casts and unavailable mesh variants", () => {
  const characters = TRAILER_INTRO_SLUGS.map((slug) => fighter(slug, 0));
  const config = { introFighters: [...TRAILER_INTRO_SLUGS], introMeshes: [...TRAILER_INTRO_MESHES], introRoomPicks: [...TRAILER_INTRO_ROOM_PICKS] };
  assert.throws(() => createTrailerIntroAction({}, characters.slice(0, 5), config), /available fighter/);
  assert.throws(() => createTrailerIntroAction({}, characters, { ...config, introFighters: Array(6).fill(characters[0].slug) }), /different intro fighters/);
  assert.throws(() => createTrailerIntroAction({}, characters, { ...config, introRoomPicks: [characters[0].slug, characters[0].slug] }), /two different/);
  characters[1].variants = ["mario"];
  assert.throws(() => createTrailerIntroAction({}, characters, config), /mesh variant/);
});
