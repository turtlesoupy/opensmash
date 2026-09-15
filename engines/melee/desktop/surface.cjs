const { sharedTexture } = require("electron");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

// Physical DOM key codes map to the existing Quartz keyboard bindings.
const keyCodes = {
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit6: 22,
  Digit5: 23,
  Equal: 24,
  Digit9: 25,
  Digit7: 26,
  Minus: 27,
  Digit8: 28,
  Digit0: 29,
  BracketRight: 30,
  KeyO: 31,
  KeyU: 32,
  BracketLeft: 33,
  KeyI: 34,
  KeyP: 35,
  Enter: 36,
  KeyL: 37,
  KeyJ: 38,
  Quote: 39,
  KeyK: 40,
  Semicolon: 41,
  Backslash: 42,
  Comma: 43,
  Slash: 44,
  KeyN: 45,
  KeyM: 46,
  Period: 47,
  Tab: 48,
  Space: 49,
  Backquote: 50,
  Backspace: 51,
  Escape: 53,
  ArrowLeft: 123,
  ArrowRight: 124,
  ArrowDown: 125,
  ArrowUp: 126,
};

module.exports = function createSurfaceBridge(directory, portable = false) {
  if (portable || process.platform !== "darwin" || process.env.OPENSMASH_FRAME_TRANSPORT === "memory")
    return require("./frame.cjs")(directory, keyCodes);
  const native = require("./native/build/Release/surface.node");
  const service = "fun.smash.surface." + randomUUID();
  const inputFile = path.join(directory, "input-" + randomUUID());
  native.start(service, inputFile);
  let ready = false,
    window,
    sending = false;
  const timer = setInterval(async () => {
    if (sending) return;
    const frame = native.poll();
    if (!frame) return;
    if (!ready || !window || window.isDestroyed() || window.isMinimized()) {
      native.release(frame.id);
      return;
    }
    sending = true;
    let imported;
    try {
      imported = sharedTexture.importSharedTexture({
        textureInfo: {
          handle: { ioSurface: frame.ioSurface },
          pixelFormat: "bgra",
          codedSize: { width: frame.width, height: frame.height },
        },
        allReferencesReleased: () => native.release(frame.id),
      });
      await sharedTexture.sendSharedTexture({
        frame: window.webContents.mainFrame,
        importedSharedTexture: imported,
      });
    } catch (error) {
      if (!imported) native.release(frame.id);
      ready = false;
      native.input(-1, false);
      if (window && !window.isDestroyed())
        window.webContents.send("melee:surface-error", error.message);
    } finally {
      imported?.release();
      sending = false;
    }
  }, 4);
  return {
    environment: { OPENSMASH_SURFACE_SERVICE: service, OPENSMASH_INPUT_FILE: inputFile },
    attach(target) {
      window = target;
      target.on("blur", () => native.input(-1, false));
    },
    ready(value) {
      ready = value;
      if (!value) native.input(-1, false);
    },
    input(code, down) {
      if (ready && keyCodes[code] !== undefined) native.input(keyCodes[code], down);
    },
    clearInput() {
      native.input(-1, false);
    },
    close() {
      clearInterval(timer);
      native.input(-1, false);
      fs.rmSync(inputFile, { force: true });
    },
  };
};
