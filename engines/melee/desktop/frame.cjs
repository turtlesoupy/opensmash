// Shared-memory transport used by Windows/Linux and available for macOS testing.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const WIDTH = 960,
  HEIGHT = 720,
  BYTES = WIDTH * HEIGHT * 4,
  SLOT = BYTES + 64;
module.exports = function createFrameBridge(directory, keyCodes) {
  const frameFile = path.join(directory, "frames-" + randomUUID());
  const inputFile = path.join(directory, "input-" + randomUUID());
  const frames = fs.openSync(frameFile, "wx+", 0o600),
    input = fs.openSync(inputFile, "wx+", 0o600);
  fs.ftruncateSync(frames, 3 * SLOT);
  fs.ftruncateSync(input, 512);
  const keys = Buffer.alloc(512),
    state = Buffer.alloc(8),
    free = Buffer.alloc(1);
  let window,
    ready = false,
    outstanding = null,
    serial = 0,
    deadline = 0;
  function clearInput() {
    keys.fill(0, 0, 128);
    fs.writeSync(input, keys, 0, 128, 0);
    keys[256] = (keys[256] + 1) & 255;
    fs.writeSync(input, keys, 256, 1, 256);
  }
  const timer = setInterval(() => {
    if (outstanding !== null) {
      if (Date.now() < deadline) return;
      outstanding = null;
      ready = false;
      clearInput();
      if (window && !window.isDestroyed())
        window.webContents.send(
          "melee:surface-error",
          "The game display stopped responding. Return to the roster and try again.",
        );
    }
    const pending = [];
    for (let i = 0; i < 3; i++) {
      fs.readSync(frames, state, 0, 8, i * SLOT);
      if (state[0] !== 1) continue;
      pending.push({ slot: i, sequence: state.readUInt32LE(4) });
    }
    pending.sort((a, b) => (a.sequence - b.sequence) | 0);
    for (const { slot: i } of pending) {
      if (!ready || !window || window.isDestroyed() || window.isMinimized()) {
        fs.writeSync(frames, free, 0, 1, i * SLOT);
        continue;
      }
      const pixels = Buffer.allocUnsafe(BYTES);
      const read = fs.readSync(frames, pixels, 0, BYTES, i * SLOT + 64);
      fs.writeSync(frames, free, 0, 1, i * SLOT);
      if (read !== BYTES) continue;
      outstanding = ++serial;
      deadline = Date.now() + 2000;
      window.webContents.send("melee:frame", outstanding, pixels);
      break;
    }
  }, 4);
  return {
    environment: { OPENSMASH_FRAME_FILE: frameFile, OPENSMASH_INPUT_FILE: inputFile },
    attach(target) {
      window = target;
      target.on("blur", clearInput);
    },
    ready(value) {
      ready = value;
      if (!value) {
        clearInput();
        outstanding = null;
      }
    },
    ack(id) {
      if (id === outstanding) outstanding = null;
    },
    input(code, down) {
      const value = keyCodes[code];
      if (!ready || value === undefined) return;
      if (down && !keys[value]) {
        keys[value + 128] = (keys[value + 128] + 1) & 255;
        fs.writeSync(input, keys, value + 128, 1, value + 128);
      }
      keys[value] = down ? 1 : 0;
      fs.writeSync(input, keys, value, 1, value);
    },
    clearInput,
    close() {
      clearInterval(timer);
      clearInput();
      fs.closeSync(frames);
      fs.closeSync(input);
      fs.rmSync(frameFile, { force: true });
      fs.rmSync(inputFile, { force: true });
    },
  };
};
