import {
  controllerPortParams,
  humanPortCount,
  normalizePortChoices,
  planControllerPorts,
} from "../shared/controller-ports.js";

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

export const STAGES = [
  { value: "random", label: "Random" },
  { value: "0", label: "Peach's Castle" },
  { value: "1", label: "Sector Z" },
  { value: "2", label: "Kongo Jungle" },
  { value: "3", label: "Planet Zebes" },
  { value: "4", label: "Hyrule Castle" },
  { value: "5", label: "Yoshi's Island" },
  { value: "6", label: "Dream Land" },
  { value: "7", label: "Saffron City" },
  { value: "8", label: "Mushroom Kingdom" },
];

export const OPPONENT_LEVELS = [
  { value: "1", label: "Level 1 — Very Easy" },
  { value: "2", label: "Level 2" },
  { value: "3", label: "Level 3 — Easy" },
  { value: "4", label: "Level 4" },
  { value: "5", label: "Level 5 — Normal" },
  { value: "6", label: "Level 6" },
  { value: "7", label: "Level 7 — Hard" },
  { value: "8", label: "Level 8" },
  { value: "9", label: "Level 9 — Very Hard" },
];

export const BOOT_MODES = [
  { value: "free-for-all", label: "Free-for-All", description: "Skip menus and start a VS match." },
  { value: "vs-menu", label: "VS Menu", description: "Open the VS mode menu." },
  { value: "vs-character-select", label: "VS Character Select", description: "Open the multiplayer fighter-select screen." },
  { value: "one-player-character-select", label: "1P Character Select", description: "Open the one-player fighter-select screen." },
  { value: "full-boot", label: "Full Boot", description: "Start from the N64 boot sequence." },
];

// Engine frame pacer (BattleShip/port/port.cpp). "display" yields on
// requestAnimationFrame (the engine default; it fixed iPhone frame/audio
// stutter). "timer" is the original setTimeout sleep (SSB64_RAF_PACER=0).
export const FRAME_PACING = [
  { value: "display", label: "Display sync (default)" },
  { value: "timer", label: "Timer (legacy)" },
];

// GL render size of the game canvas (SSB64_RENDER_SIZE). The canvas is CSS
// scaled to fit, so this is pure GPU/fill cost; 1280x960 matches the
// packaged BattleShip.cfg.json and is what the engine uses when unset.
export const RENDER_RESOLUTIONS = [
  { value: "640x480", label: "640 x 480 (2x N64)" },
  { value: "960x720", label: "960 x 720 (3x)" },
  { value: "1280x960", label: "1280 x 960 (4x, default)" },
  { value: "1920x1440", label: "1920 x 1440 (6x)" },
  { value: "2560x1920", label: "2560 x 1920 (8x)" },
];

export const DEFAULT_ADVANCED_OPTIONS = Object.freeze({
  characterMesh: "auto",
  stage: "random",
  opponentLevel: "3",
  bootMode: "free-for-all",
  framePacing: "display",
  renderResolution: "1280x960",
  ports: Object.freeze(["auto", "auto", "auto", "auto"]),
});

const VALID_MESHES = new Set(CHARACTER_MESHES.map(({ value }) => value));
const VALID_STAGES = new Set(STAGES.map(({ value }) => value));
const VALID_OPPONENT_LEVELS = new Set(OPPONENT_LEVELS.map(({ value }) => value));
const VALID_BOOT_MODES = new Set(BOOT_MODES.map(({ value }) => value));
const VALID_FRAME_PACING = new Set(FRAME_PACING.map(({ value }) => value));
const VALID_RENDER_RESOLUTIONS = new Set(RENDER_RESOLUTIONS.map(({ value }) => value));

export function normalizeAdvancedOptions(value) {
  return {
    characterMesh: VALID_MESHES.has(value?.characterMesh)
      ? value.characterMesh
      : DEFAULT_ADVANCED_OPTIONS.characterMesh,
    stage: VALID_STAGES.has(value?.stage) ? value.stage : DEFAULT_ADVANCED_OPTIONS.stage,
    opponentLevel: VALID_OPPONENT_LEVELS.has(value?.opponentLevel)
      ? value.opponentLevel
      : DEFAULT_ADVANCED_OPTIONS.opponentLevel,
    bootMode: VALID_BOOT_MODES.has(value?.bootMode)
      ? value.bootMode
      : DEFAULT_ADVANCED_OPTIONS.bootMode,
    framePacing: VALID_FRAME_PACING.has(value?.framePacing)
      ? value.framePacing
      : DEFAULT_ADVANCED_OPTIONS.framePacing,
    renderResolution: VALID_RENDER_RESOLUTIONS.has(value?.renderResolution)
      ? value.renderResolution
      : DEFAULT_ADVANCED_OPTIONS.renderResolution,
    ports: normalizePortChoices(value?.ports),
  };
}

export function hasAdvancedOverrides(options) {
  return Object.keys(DEFAULT_ADVANCED_OPTIONS).some(
    (key) => JSON.stringify(options[key]) !== JSON.stringify(DEFAULT_ADVANCED_OPTIONS[key]),
  );
}

// Which device drives each N64 port for a launch, from the controllers the
// page can currently see plus the player's Settings choices.
export function controllerPlan(options, gamepads = []) {
  return planControllerPorts({ gamepads, ports: normalizeAdvancedOptions(options).ports });
}

function resolvedCharacter(character, meshName) {
  if (!character || meshName === "auto") return character;

  const mesh = CHARACTER_MESHES.find(({ value }) => value === meshName);
  if (!mesh || mesh.fkind === character.fkind) return character;

  // One OSB6 per character carries every built target, so an override only
  // changes which fighter the engine spawns; the file stays the same. The
  // server lists the built targets in `variants` (array); an object form is
  // a legacy per-target-file job and its keys mean the same thing.
  const built = Array.isArray(character.variants)
    ? character.variants
    : character.variants ? Object.keys(character.variants) : null;
  if (meshName !== "mario" && built && !built.includes(meshName)) {
    throw new Error(`${character.name} does not have a ${mesh.label} mesh variant.`);
  }

  return {
    ...character,
    fkind: mesh.fkind,
    base: meshName,
  };
}

function randomItem(items, random) {
  return items.length ? items[Math.floor(random() * items.length)] : null;
}

function uniqueCharacters(characters) {
  const seen = new Set();
  return characters.filter((character) => {
    if (!character?.slug || seen.has(character.slug)) return false;
    seen.add(character.slug);
    return true;
  });
}

// Opening-card order in the original movie. Donkey Kong and Yoshi are
// intentional vanilla beats for the current trailer because those retarget
// profiles are not production-ready. This is launch policy only: switching
// either mode to "inject" uses the same generic staging/spawn path as every
// other native skeleton.
export const FULL_BOOT_INTRO_CARDS = Object.freeze([
  Object.freeze({ fkind: 0, mesh: "mario", mode: "inject" }),
  Object.freeze({ fkind: 2, mesh: "donkey", mode: "vanilla" }),
  Object.freeze({ fkind: 3, mesh: "samus", mode: "inject" }),
  Object.freeze({ fkind: 1, mesh: "fox", mode: "inject" }),
  Object.freeze({ fkind: 5, mesh: "link", mode: "inject" }),
  Object.freeze({ fkind: 6, mesh: "yoshi", mode: "vanilla" }),
  Object.freeze({ fkind: 9, mesh: "pikachu", mode: "inject" }),
  Object.freeze({ fkind: 8, mesh: "kirby", mode: "inject" }),
]);

export function createFullBootIntroConfig(
  characters,
  random = Math.random,
  featuredCharacter = null,
  featuredMesh = "auto",
) {
  const pool = uniqueCharacters(characters);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  const usedSlugs = new Set();
  let featuredCardIndex = -1;
  let featuredResolved = null;

  if (featuredCharacter?.slug) {
    const clickedTarget = resolvedCharacter(featuredCharacter, featuredMesh);
    const injectable = FULL_BOOT_INTRO_CARDS
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => card.mode === "inject");
    const exact = injectable.find(({ card }) => card.fkind === clickedTarget.fkind);
    const attempts = exact
      ? [exact, ...injectable.filter(({ index }) => index !== exact.index)]
      : injectable;

    for (const { card, index } of attempts) {
      try {
        featuredResolved = card.fkind === clickedTarget.fkind
          ? clickedTarget
          : resolvedCharacter(featuredCharacter, card.mesh);
        featuredCardIndex = index;
        usedSlugs.add(featuredCharacter.slug);
        break;
      } catch {
        // The clicked fighter may not have this skeleton variant. Prefer its
        // native target, then use the first compatible opening card.
      }
    }
  }

  return FULL_BOOT_INTRO_CARDS.map((card, cardIndex) => {
    if (cardIndex === featuredCardIndex) {
      return { ...card, type: "character", character: featuredResolved, featured: true };
    }
    if (card.mode === "vanilla") return { ...card, type: "vanilla" };

    for (const candidate of pool) {
      if (usedSlugs.has(candidate.slug)) continue;
      try {
        const character = resolvedCharacter(candidate, card.mesh);
        usedSlugs.add(candidate.slug);
        return { ...card, type: "character", character };
      } catch {
        // A generated fighter may not have every skeleton variant. Keep
        // searching; if none work, this card safely falls back to vanilla.
      }
    }
    return { ...card, type: "vanilla" };
  });
}

export function selectDirectBattleOpponents(
  selectedCharacter,
  gridCharacters,
  ownedCharacters = [],
  random = Math.random,
) {
  // The viewer's own (private) fighters get no special treatment: they sit in
  // the pool like any other roster entry. They used to be forced into every
  // battle, which read as "my private fighter shows up even when I didn't
  // pick it".
  const selectedSlug = selectedCharacter?.slug;
  const pool = uniqueCharacters([...gridCharacters, ...ownedCharacters])
    .filter((character) => character.slug !== selectedSlug);
  const first = randomItem(pool, random);
  const second = randomItem(pool.filter((character) => character.slug !== first?.slug), random) || first;

  return [
    { type: "vanilla", fkind: Math.floor(random() * 12) },
    ...(first ? [{ type: "character", character: first }] : []),
    ...(second ? [{ type: "character", character: second }] : []),
  ];
}

function characterAssets(character) {
  return {
    slug: character.slug,
    fkind: character.fkind,
    short: character.short || character.name,
    name: character.name || character.display || null,
    bundleUrl: character.bundleUrl || `bundles/${character.bundle}`,
    uiUrl: character.uiUrl || (character.ui ? `bundles/${character.slug}.osbui` : null),
    voiceUrl: character.voiceUrl || (character.voice ? `bundles/${character.slug}.wav` : null),
    // Opening-movie portrait (the Sector cockpit face): the 256px derivative
    // is plenty for a 320x240 texture and keeps a trailer boot small.
    portraitUrl: character.portraitUrl || character.portraitMedium || character.portraitFull || null,
  };
}

function characterInjection(character, player) {
  return { player, ...characterAssets(character) };
}

// Direct boot into a VS match. Port 1 is the site's pick; `picks` holds the
// fighters of any further human ports (double select); CPUs fill the rest
// from `opponents`. Custom fighters on ports 2-4 ride the per-player
// injection rows, human or CPU alike (the engine binds them by port).
function directBattle(params, character, stage, opponents, picks = []) {
  const humans = 1 + picks.length;
  const slots = [character ?? null, ...picks];
  const cpus = (opponents || []).filter((opponent) => (
    opponent.type !== "character" || !slots.some((slot) => slot?.slug === opponent.character.slug)
  ));
  while (slots.length < 4) {
    const opponent = cpus.shift();
    slots.push(opponent
      ? (opponent.type === "character" ? opponent.character : { fkind: opponent.fkind })
      : { fkind: Math.floor(Math.random() * 12) });
  }
  const kinds = slots.map((slot) => slot?.fkind ?? 0);
  params.set(
    "SSB64_BOOT_BATTLE",
    [kinds[0], kinds[1], stage, humans >= 2 ? 0 : 1, kinds[2], kinds[3]].join(","),
  );
  if (humans >= 2) params.set("SSB64_BOOT_HUMANS", String(humans));
  slots.forEach((slot, index) => {
    if (index > 0 && slot?.slug) {
      params.append("inject_player", JSON.stringify(characterInjection(slot, index)));
    }
  });
}

// Two or more human ports: every player picks live on the VS character
// select (the site's pick pre-places P1's token; other human tokens start
// in hand, unused ports stay closed and can be flipped to CPU there).
function multiplayerSelect(params, character, stage, humans) {
  params.set("SSB64_START_SCENE", "16");
  params.set("roster", "1");
  params.set("SSB64_BOOT_BATTLE", [character?.fkind ?? -1, -1, stage, 0, -1, -1].join(","));
  params.set("SSB64_BOOT_HUMANS", String(humans));
}

export function engineUrl(action, advancedOptions, gamepads = []) {
  const options = normalizeAdvancedOptions(advancedOptions);
  const character = resolvedCharacter(action.character, options.characterMesh);
  const picks = (action.picks || []).map((pick) => resolvedCharacter(pick, options.characterMesh));
  const stage = options.stage === "random" ? Math.floor(Math.random() * 9) : Number(options.stage);
  const params = new URLSearchParams();
  // Engine diagnostics opt-in from the site URL (e.g. /?SSB64_STALL_WATCH=1):
  // forwarded verbatim so a stall or frame-cost report can be pulled from a
  // match launched through the real shell, not just the bare engine page.
  // The stall report: [...document.querySelectorAll('iframe')]
  //   .find(i => i.src.includes('/engine/')).contentWindow.dumpStalls()
  try {
    const site = new URLSearchParams(window.location.search);
    for (const key of ["SSB64_STALL_WATCH", "SSB64_FRAME_PROFILE", "SSB64_LOG_CONSOLE"]) {
      if (site.get(key) === "1") params.set(key, "1");
    }
  } catch { /* no window (tests) */ }
  const plan = controllerPlan(options, gamepads);
  const humans = humanPortCount(plan);
  const multiplayer = humans >= 2;
  for (const [key, value] of Object.entries(controllerPortParams(plan))) {
    params.set(key, value);
  }

  if (character) {
    params.set("inject", character.bundleUrl || `bundles/${character.bundle}`);
    if (character.uiUrl || character.ui) {
      params.set("inject_ui", character.uiUrl || `bundles/${character.slug}.osbui`);
    }
    if (character.voiceUrl || character.voice) {
      params.set("inject_voice", character.voiceUrl || `bundles/${character.slug}.wav`);
    }
    params.set("fkind", String(character.fkind));
    params.set("player", "0");
    if (character.name) params.set("inject_name", character.name);
    if (character.short) params.set("inject_short", character.short);
    if (options.characterMesh !== "auto") {
      params.set("base", `${character.slug}:${options.characterMesh}`);
    }
  }

  // The Full Boot destination carries an explicit opening-card launch config.
  // Vanilla entries are intentionally omitted from the URL; missing injected
  // assets are also omitted by the shell, making vanilla the per-card fallback.
  if (options.bootMode === "full-boot") {
    if (action.trailerIntro) params.set("SSB64_TRAILER_HOLD", "1");
    if (action.trailerRecording) params.set("SSB64_TRAILER_RECORD", "1");
    action.introConfig?.forEach((card) => {
      if (card.type !== "character") return;
      params.append("intro_character", JSON.stringify({
        ...characterAssets(card.character),
        fkind: card.fkind,
        base: card.character.fkind,
      }));
    });
    const roomCards = (action.introRoomPicks || []).map((slug) =>
      action.introConfig?.find(
        (card) => card.type === "character" && card.character.slug === slug,
      ),
    );
    const featuredCard = action.introConfig?.find(
      (card) => card.type === "character" && card.featured,
    );
    const firstRoomCard = roomCards[0] || featuredCard;
    if (firstRoomCard) {
      params.set("SSB64_OPENING_FIRST_FKIND", String(firstRoomCard.fkind));
    }
    if (roomCards[1]) {
      params.set("SSB64_OPENING_SECOND_FKIND", String(roomCards[1].fkind));
    }
  }

  if (options.bootMode === "default") {
    if (action.type === "character") directBattle(params, character, stage, action.opponents);
    if (action.type === "select") {
      params.set("SSB64_START_SCENE", "16");
      params.set("roster", "1");
    }
  } else if (options.bootMode === "free-for-all") {
    if (multiplayer && picks.length !== humans - 1) {
      // No double select happened (e.g. the "play" action): everyone picks in-game.
      multiplayerSelect(params, character, stage, humans);
    } else {
      directBattle(params, character, stage, action.type === "character" ? action.opponents : null, picks);
    }
  } else if (options.bootMode === "vs-menu") {
    params.set("SSB64_START_SCENE", "9");
    params.set("roster", "1");
  } else if (options.bootMode === "vs-character-select") {
    params.set("SSB64_START_SCENE", "16");
    params.set("roster", "1");
  } else if (options.bootMode === "one-player-character-select") {
    params.set("SSB64_START_SCENE", "17");
    params.set("roster", "1");
  }

  if (
    options.bootMode !== "default" &&
    options.bootMode !== "free-for-all" &&
    options.bootMode !== "full-boot" &&
    options.bootMode !== "one-player-character-select" &&
    (multiplayer || character || options.stage !== "random")
  ) {
    if (multiplayer) {
      params.set("SSB64_BOOT_BATTLE", [character?.fkind ?? -1, -1, stage, 0, -1, -1].join(","));
      params.set("SSB64_BOOT_HUMANS", String(humans));
    } else {
      params.set("SSB64_BOOT_BATTLE", `${character?.fkind ?? -1},8,${stage}`);
    }
  } else if (
    action.type === "select" &&
    options.bootMode === "default" &&
    options.stage !== "random"
  ) {
    params.set("SSB64_BOOT_BATTLE", `-1,8,${stage}`);
  }

  if (params.has("SSB64_BOOT_BATTLE")) {
    params.set("SSB64_CPU_LEVEL", options.opponentLevel);
  }
  if (options.framePacing === "timer") params.set("SSB64_RAF_PACER", "0");
  if (options.renderResolution !== DEFAULT_ADVANCED_OPTIONS.renderResolution) {
    params.set("SSB64_RENDER_SIZE", options.renderResolution);
  }

  return `/engine/?${params}`;
}
