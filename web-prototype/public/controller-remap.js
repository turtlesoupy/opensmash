(function installOpenSmashControllerRemap() {
  "use strict";

  const STORAGE_KEY = "opensmash-controller-mappings-v1";
  const EMPTY_BUTTON = Object.freeze({ pressed: false, touched: false, value: 0 });
  const BUTTON_TARGETS = Object.freeze({
    a: 0,
    b: 1,
    l: 4,
    r: 5,
    z: 6,
    start: 9,
    dup: 12,
    ddown: 13,
    dleft: 14,
    dright: 15,
  });
  const CONTROL_IDS = Object.freeze([
    "a", "b", "z", "start", "l", "r",
    "cup", "cdown", "cleft", "cright",
    "dup", "ddown", "dleft", "dright",
  ]);
  const PRESSED_BUTTON = Object.freeze({ pressed: true, touched: true, value: 1 });
  const BUTTON_ENTRIES = Object.entries(BUTTON_TARGETS);
  const C_DIRECTIONS = [["cleft", 2, -1], ["cright", 2, 1], ["cup", 3, -1], ["cdown", 3, 1]];
  const M64_PROFILE = Object.freeze({ mode: "standard", buttons: Object.freeze({ a: 1, b: 0 }), axes: Object.freeze({}) });
  const M64_ID = /(?:^|\b)M64[_ ]Controller(?:\b|$)/i;

  const nativeGetGamepads = typeof navigator.getGamepads === "function"
    ? navigator.getGamepads.bind(navigator)
    : () => [];
  let cachedJson = null;
  let cachedProfiles = {};
  let profilesLoaded = false;
  const resolvedProfiles = new Map();
  const calibration = new WeakMap();

  function readProfiles() {
    if (profilesLoaded) return cachedProfiles;
    profilesLoaded = true;
    let json = "";
    try { json = localStorage.getItem(STORAGE_KEY) || ""; } catch { return {}; }
    if (json === cachedJson) return cachedProfiles;
    cachedJson = json;
    resolvedProfiles.clear();
    try {
      const parsed = JSON.parse(json);
      cachedProfiles = parsed && parsed.version === 1 && parsed.profiles && typeof parsed.profiles === "object"
        ? parsed.profiles
        : {};
    } catch {
      cachedProfiles = {};
    }
    return cachedProfiles;
  }

  function writeProfiles(profiles) {
    const payload = JSON.stringify({ version: 1, profiles });
    try { localStorage.setItem(STORAGE_KEY, payload); } catch { return false; }
    cachedJson = payload;
    cachedProfiles = profiles;
    profilesLoaded = true;
    resolvedProfiles.clear();
    return true;
  }

  function normalizedProfile(value) {
    if (!value || !["standard", "custom", "disabled"].includes(value.mode)) return null;
    const buttons = {};
    for (const control of CONTROL_IDS) {
      const index = Number(value.buttons?.[control]);
      if (Number.isInteger(index) && index >= 0 && index < 64) buttons[control] = index;
    }
    const axes = {};
    for (const control of CONTROL_IDS) {
      const index = Number(value.axes?.[control]?.index);
      const valueAtPress = Number(value.axes?.[control]?.value);
      const neutral = Number(value.axes?.[control]?.neutral);
      if (Number.isInteger(index) && index >= 0 && index < 64
        && Number.isFinite(valueAtPress) && Number.isFinite(neutral)) {
        axes[control] = { index, value: valueAtPress, neutral };
      }
    }
    return { mode: value.mode, buttons, axes };
  }

  function getProfile(id) {
    const key = String(id || "");
    readProfiles();
    if (!resolvedProfiles.has(key)) {
      const saved = normalizedProfile(cachedProfiles[key]);
      const profile = saved?.mode === "disabled" ? null : saved || (M64_ID.test(key) ? M64_PROFILE : null);
      if (profile) {
        Object.values(profile.axes).forEach(Object.freeze);
        Object.freeze(profile.buttons);
        Object.freeze(profile.axes);
        Object.freeze(profile);
      }
      resolvedProfiles.set(key, profile);
    }
    return resolvedProfiles.get(key);
  }

  function profileSource(id) {
    const key = String(id || "");
    readProfiles();
    const saved = normalizedProfile(cachedProfiles[key]);
    if (saved?.mode === "disabled") return "default";
    if (saved) return "custom";
    return M64_ID.test(key) ? "m64" : "default";
  }

  function saveProfile(id, profile) {
    const normalized = normalizedProfile(profile);
    if (!id || !normalized) return false;
    return writeProfiles({ ...readProfiles(), [id]: normalized });
  }

  function clearProfile(id) {
    if (!id) return false;
    const profiles = { ...readProfiles() };
    delete profiles[id];
    return writeProfiles(profiles);
  }

  function disableProfile(id) {
    if (!id) return false;
    return writeProfiles({ ...readProfiles(), [id]: { mode: "disabled", buttons: {} } });
  }

  function buttonValue(button) {
    if (!button) return EMPTY_BUTTON;
    const value = Number(button.value) || 0;
    const pressed = Boolean(button.pressed || value > 0.5);
    const touched = Boolean(button.touched);
    // Browser GamepadButton objects already carry normalized values.
    if (button.value === value && button.pressed === pressed && button.touched === touched) return button;
    return { pressed, touched, value };
  }

  function hatSpacing(profile, index) {
    // A calibrated eight-way hat has four equally spaced cardinal values
    // on one axis. Infer this from saved profiles so existing setups work too.
    let spacings = calibration.get(profile);
    if (!spacings) { spacings = new Map(); calibration.set(profile, spacings); }
    if (spacings.has(index)) return spacings.get(index);
    const values = [...new Set(Object.values(profile.axes || {})
      .filter((mapping) => mapping.index === index)
      .map((mapping) => mapping.value))].sort((a, b) => a - b);
    if (values.length !== 4) { spacings.set(index, null); return null; }
    const spacing = (values[3] - values[0]) / 3;
    if (spacing < 0.2 || values.some((value, i) =>
      Math.abs(value - (values[0] + i * spacing)) > 0.04)) { spacings.set(index, null); return null; }
    spacings.set(index, spacing);
    return spacing;
  }

  function axisButton(gamepad, mapping, profile) {
    if (!mapping) return EMPTY_BUTTON;
    const current = Number(gamepad.axes?.[mapping.index]);
    if (!Number.isFinite(current)) return EMPTY_BUTTON;
    const delta = mapping.value - mapping.neutral;
    const travel = Math.abs(delta);
    if (travel < 0.2) return EMPTY_BUTTON;
    const spacing = hatSpacing(profile, mapping.index);
    let active;
    if (spacing !== null) {
      // Include adjacent diagonal positions, including the wrap from the last
      // cardinal back to the first. Never interpret the neutral code as input.
      const period = spacing * 4;
      const distance = Math.abs(current - mapping.value) % period;
      active = Math.abs(current - mapping.neutral) > 0.12
        && Math.min(distance, period - distance) <= spacing / 2 + 0.04;
    } else {
      // Capture may happen partway through an analog stroke. Further travel
      // in that direction must keep the mapped button held.
      active = (current - mapping.neutral) * Math.sign(delta)
        >= Math.max(0.2, travel * 0.55);
    }
    return active ? PRESSED_BUTTON : EMPTY_BUTTON;
  }

  function remapGamepad(gamepad) {
    const profile = getProfile(gamepad?.id);
    if (!profile) return gamepad;

    const originalButtons = gamepad.buttons || [];
    const buttons = profile.mode === "custom"
      ? Array.from({ length: Math.max(16, originalButtons.length) }, () => EMPTY_BUTTON)
      : [...originalButtons];
    while (buttons.length < 16) buttons.push(EMPTY_BUTTON);

    for (const [control, target] of BUTTON_ENTRIES) {
      const source = profile.buttons[control];
      if (source !== undefined) buttons[target] = buttonValue(originalButtons[source]);
      else if (profile.axes?.[control]) buttons[target] = axisButton(gamepad, profile.axes[control], profile);
      else if (profile.mode === "custom") buttons[target] = EMPTY_BUTTON;
    }

    const axes = profile.mode === "custom"
      ? [Number(gamepad.axes?.[0]) || 0, Number(gamepad.axes?.[1]) || 0, 0, 0]
      : Array.from(gamepad.axes || [], (value) => Number(value) || 0);
    while (axes.length < 4) axes.push(0);
    // Replace only explicitly mapped C-directions; preserve other native input.
    for (const [control, index, sign] of C_DIRECTIONS) {
      if ((profile.buttons[control] !== undefined || profile.axes[control])
        && axes[index] * sign > 0) axes[index] = 0;
    }
    if (controlPressed(gamepad, originalButtons, profile, "cleft")) axes[2] = -1;
    if (controlPressed(gamepad, originalButtons, profile, "cright")) axes[2] = 1;
    if (controlPressed(gamepad, originalButtons, profile, "cup")) axes[3] = -1;
    if (controlPressed(gamepad, originalButtons, profile, "cdown")) axes[3] = 1;

    return new Proxy(gamepad, {
      get(target, property) {
        if (property === "buttons") return buttons;
        if (property === "axes") return axes;
        return Reflect.get(target, property, target);
      },
    });
  }

  function buttonsPressed(buttons, index) {
    const button = buttons[index];
    return Boolean(button && (button.pressed || button.value > 0.5));
  }

  function controlPressed(gamepad, buttons, profile, control) {
    const index = profile.buttons[control];
    if (index !== undefined) return buttonsPressed(buttons, index);
    return axisButton(gamepad, profile.axes?.[control], profile).pressed;
  }

  function rawGamepads() {
    try { return Array.from(nativeGetGamepads() || []); } catch { return []; }
  }

  function mappedGamepads() {
    try { return Array.from(nativeGetGamepads() || [], (gamepad) => gamepad ? remapGamepad(gamepad) : gamepad); } catch { return []; }
  }

  // Storage events reach other tabs and same-origin frames; local writes
  // invalidate immediately in writeProfiles. Never touch storage while polling.
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      profilesLoaded = false;
      resolvedProfiles.clear();
    }
  });

  const api = Object.freeze({
    clearProfile,
    controls: CONTROL_IDS,
    disableProfile,
    getProfile,
    mappedGamepads,
    profileSource,
    rawGamepads,
    remapGamepad,
    saveProfile,
    storageKey: STORAGE_KEY,
  });
  window.openSmashControllerRemap = api;
  try {
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: mappedGamepads,
    });
  } catch {
    try { navigator.getGamepads = mappedGamepads; } catch { /* Unsupported browser; UI can still use the API. */ }
  }
})();
