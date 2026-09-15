const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const create = require("../desktop/frame.cjs");
const BYTES = 960 * 720 * 4,
  SLOT = BYTES + 64;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await wait(10);
  }
  assert.ok(check(), "bridge timed out");
}
test("frames stay ordered and bounded; inactive frames and inputs are cleared", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embedded-frame-"));
  const bridge = create(dir, { KeyJ: 38 }),
    messages = [];
  const window = {
    on() {},
    isDestroyed: () => false,
    isMinimized: () => false,
    webContents: {
      send(...args) {
        messages.push(args);
      },
    },
  };
  bridge.attach(window);
  bridge.ready(true);
  const fd = fs.openSync(bridge.environment.OPENSMASH_FRAME_FILE, "r+");
  function write(slot, seq) {
    const data = Buffer.alloc(BYTES + 64, seq);
    data.fill(0, 0, 64);
    data.writeUInt32LE(seq, 4);
    fs.writeSync(fd, data, 0, data.length, slot * SLOT);
    fs.writeSync(fd, Buffer.from([1]), 0, 1, slot * SLOT);
  }
  try {
    write(0, 3);
    write(1, 1);
    write(2, 2);
    await until(() => messages.length === 1);
    assert.equal(messages[0][0], "melee:frame");
    assert.equal(messages[0][2][0], 1);
    await wait(30);
    assert.equal(messages.length, 1);
    bridge.ack(-1);
    await wait(20);
    assert.equal(messages.length, 1);
    bridge.ack(messages[0][1]);
    await until(() => messages.length === 2);
    assert.equal(messages[1][2][0], 2);
    bridge.ack(messages[1][1]);
    await until(() => messages.length === 3);
    assert.equal(messages[2][2][0], 3);
    bridge.input("KeyJ", true);
    let keys = fs.readFileSync(bridge.environment.OPENSMASH_INPUT_FILE);
    assert.equal(keys[38], 1);
    assert.equal(keys[166], 1);
    bridge.input("KeyJ", true);
    keys = fs.readFileSync(bridge.environment.OPENSMASH_INPUT_FILE);
    assert.equal(keys[166], 1);
    bridge.ready(false);
    keys = fs.readFileSync(bridge.environment.OPENSMASH_INPUT_FILE);
    assert.equal(keys[38], 0);
    assert.equal(keys[256], 1);
    write(0, 4);
    await wait(30);
    assert.equal(messages.length, 3);
    const state = Buffer.alloc(1);
    fs.readSync(fd, state, 0, 1, 0);
    assert.equal(state[0], 0);
  } finally {
    fs.closeSync(fd);
    bridge.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
