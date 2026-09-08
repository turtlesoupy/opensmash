import { CHARACTER_MESHES, FULL_BOOT_INTRO_CARDS } from "./launch-options.js";
import trailerConfig from "../config/trailer.js";
import demoConfig from "../config/demo.js";

export const TRAILER_CONFIG = trailerConfig;
export const TRAILER_INTRO_SLUGS = trailerConfig.introFighters;
export const TRAILER_INTRO_MESHES = trailerConfig.introMeshes;
export const TRAILER_INTRO_ROOM_PICKS = trailerConfig.introRoomPicks;
export const TRAILER_OPPONENT_SLUGS = trailerConfig.match.opponents;
export const TRAILER_STAGE = trailerConfig.match.stage;
export const TRAILER_CPU_LEVEL = trailerConfig.match.cpuLevel;

function characterBySlug(characters, slug) {
  return characters.find((character) => character.slug === slug) || null;
}

export function supportsTrailerMesh(character, meshName) {
  const mesh = CHARACTER_MESHES.find(({ value }) => value === meshName);
  if (!mesh || !character) return false;
  const variants = Array.isArray(character.variants)
    ? character.variants : character.variants ? Object.keys(character.variants) : null;
  return meshName === "mario" || mesh.fkind === character.fkind || !variants || variants.includes(meshName);
}

export function createTrailerIntroConfig(characters, config = TRAILER_CONFIG) {
  const slotCount = FULL_BOOT_INTRO_CARDS.filter((card) => card.mode !== "vanilla").length;
  if (config.introFighters.length !== slotCount || new Set(config.introFighters).size !== slotCount) {
    throw new Error(`Choose ${slotCount} different intro fighters.`);
  }
  if (config.introMeshes.length !== config.introFighters.length) {
    throw new Error("Trailer config needs one render mesh for every intro fighter.");
  }
  let injectedIndex = 0;
  return FULL_BOOT_INTRO_CARDS.map((card) => {
    if (card.mode === "vanilla") return { ...card, type: "vanilla" };

    const introIndex = injectedIndex++;
    const slug = config.introFighters[introIndex];
    const meshName = config.introMeshes[introIndex];
    const mesh = CHARACTER_MESHES.find((candidate) => candidate.value === meshName);
    if (!mesh || !Number.isInteger(mesh.fkind)) {
      throw new Error(`Trailer render mesh is unavailable: ${meshName}`);
    }
    const character = characterBySlug(characters, slug);
    if (!character) {
      if (config !== TRAILER_CONFIG) throw new Error(`Choose an available fighter for intro slot ${introIndex + 1}.`);
      return { ...card, type: "vanilla" };
    }
    if (!supportsTrailerMesh(character, meshName)) {
      throw new Error(`${character.name} does not have a ${mesh.label} mesh variant.`);
    }

    // The capture cast uses OSB6 bundles with every production-ready target.
    // Pinning fkind/base makes the opening-card assignment deterministic.
    return {
      ...card,
      type: "character",
      character: { ...character, fkind: mesh.fkind, base: mesh.value },
    };
  });
}

export function createTrailerIntroAction(action, characters, config = TRAILER_CONFIG) {
  const introConfig = createTrailerIntroConfig(characters, config);
  const availableSlugs = new Set(
    introConfig
      .filter((card) => card.type === "character")
      .map((card) => card.character.slug),
  );
  const missingSlug = config.introRoomPicks.find((slug) => !availableSlugs.has(slug));
  if (missingSlug) {
    throw new Error(`Trailer opening-room fighter is unavailable: ${missingSlug}`);
  }
  if (config.introRoomPicks.length !== 2 || new Set(config.introRoomPicks).size !== 2) {
    throw new Error("Trailer config needs two different opening-room fighters.");
  }

  return {
    ...action,
    introConfig,
    introRoomPicks: [...config.introRoomPicks],
  };
}

export function createTrailerMatchAction(action, characters, opponentSlugs = TRAILER_OPPONENT_SLUGS) {
  const selectedSlugs = new Set([
    action.character?.slug,
    ...(action.picks || []).map((pick) => pick?.slug),
  ].filter(Boolean));
  const opponentCount = Math.max(0, 4 - selectedSlugs.size);
  const configuredSlugs = opponentSlugs
    .filter((slug) => !selectedSlugs.has(slug))
    .slice(0, opponentCount);
  const opponents = configuredSlugs.map((slug) => characterBySlug(characters, slug));
  const missingIndex = opponents.findIndex((opponent) => !opponent);
  if (missingIndex >= 0) {
    throw new Error(`Trailer opponent is unavailable: ${configuredSlugs[missingIndex]}`);
  }
  if (opponents.length !== opponentCount) {
    throw new Error(`Trailer config needs ${opponentCount} available opponents outside the current picks.`);
  }

  return {
    ...action,
    opponents: opponents.map((opponent) => ({ type: "character", character: opponent })),
  };
}

// `?demo=1`: same deterministic-match path as the trailer, own opponent pool.
export const DEMO_CONFIG = demoConfig;
export const DEMO_STAGE = demoConfig.match.stage;
export const DEMO_CPU_LEVEL = demoConfig.match.cpuLevel;
export const DEMO_TRAILER_HOTKEY = demoConfig.trailerHotkey;
export const DEMO_MUSIC_HOTKEY = demoConfig.musicHotkey;
export const DEMO_START_HOTKEY = demoConfig.startHotkey;
export const DEMO_SCROLL_HOTKEY = demoConfig.scrollHotkey;
export const DEMO_PRESENTER = demoConfig.presenter;
export const DEMO_SCROLL_TARGET = demoConfig.scrollTarget;
export const DEMO_SCROLL_DURATION_MS = demoConfig.scrollDurationMs ?? 2500;
export const DEMO_PIN_ON_PLAY = Boolean(demoConfig.pinOnPlay);
export const DEMO_MUSIC_ON_SCROLL = Boolean(demoConfig.musicOnScroll);
export function demoStageFor(slug) {
  return demoConfig.match.stageFor?.[slug] ?? demoConfig.match.stage;
}

// Demo bodies: `bases` pins which built target a fighter spawns as. Mario is
// in every OSB6; anything else has to be in the server's `variants` list.
function withDemoBase(character) {
  const meshName = demoConfig.match.bases?.[character?.slug];
  if (!meshName) return character;
  const mesh = CHARACTER_MESHES.find(({ value }) => value === meshName);
  if (!mesh) throw new Error(`Demo base "${meshName}" is not a known fighter body.`);
  if (mesh.fkind === character.fkind) return character;
  const built = Array.isArray(character.variants) ? character.variants : null;
  if (meshName !== "mario" && built && !built.includes(meshName)) {
    throw new Error(`${character.name} has no ${mesh.label} body for the demo.`);
  }
  return { ...character, fkind: mesh.fkind, base: meshName };
}

// Demo grid order: the spotlight fighters leave their usual spots and line up,
// in config order, right before the presenter's tile at the bottom.
export function demoGridOrder(characters) {
  const wanted = demoConfig.spotlight || [];
  if (!wanted.length) return characters;
  const bySlug = new Map(characters.map((character) => [character.slug, character]));
  const anchor = demoConfig.spotlightBefore;
  if (!bySlug.has(anchor)) return characters;
  const spotlight = wanted.filter((slug) => bySlug.has(slug) && slug !== anchor);
  const moved = new Set(spotlight);
  const ordered = [];
  for (const character of characters) {
    if (moved.has(character.slug)) continue;
    if (character.slug === anchor) ordered.push(...spotlight.map((slug) => bySlug.get(slug)));
    ordered.push(character);
  }
  return ordered;
}

export function createDemoMatchAction(action, characters) {
  const selectedSlugs = new Set([
    action.character?.slug,
    ...(action.picks || []).map((pick) => pick?.slug),
  ].filter(Boolean));
  const opponentCount = Math.max(0, 4 - selectedSlugs.size);
  const pool = demoConfig.match.opponentsFor?.[action.character?.slug] || demoConfig.match.opponents;
  const opponents = pool
    .filter((entry) => typeof entry !== "string" || !selectedSlugs.has(entry))
    .slice(0, opponentCount)
    .map((entry) => {
      if (typeof entry !== "string") return { type: "vanilla", fkind: entry.vanilla };
      const character = characterBySlug(characters, entry);
      if (!character) throw new Error(`Demo opponent is unavailable: ${entry}`);
      return { type: "character", character: withDemoBase(character) };
    });
  if (opponents.length !== opponentCount) {
    throw new Error(`Demo config needs ${opponentCount} available opponents outside the current picks.`);
  }
  return {
    ...action,
    character: withDemoBase(action.character),
    picks: (action.picks || []).map(withDemoBase),
    opponents,
  };
}
