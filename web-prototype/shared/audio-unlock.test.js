import assert from "node:assert/strict";
import test from "node:test";
import { installAudioUnlock } from "./audio-unlock.js";

test("touch completion retries audio synchronously after touch-down is blocked", () => {
  const handlers = new Map();
  const target = {
    addEventListener: (name, handler) => handlers.set(name, handler),
    removeEventListener: (name) => handlers.delete(name),
  };
  let activated = false;
  let calls = 0;
  const context = { state: "suspended", resume() {
    calls++;
    if (activated) this.state = "running";
    return Promise.resolve();
  } };
  const cleanup = installAudioUnlock(target, () => [context, context, null]);
  handlers.get("pointerdown")({ isTrusted: true });
  assert.equal(context.state, "suspended");
  activated = true;
  handlers.get("touchend")({ isTrusted: true });
  assert.equal(context.state, "running");
  assert.equal(calls, 2);
  context.state = "interrupted";
  handlers.get("pointerup")({ isTrusted: true });
  assert.equal(context.state, "running");
  context.state = "suspended";
  handlers.get("click")({ isTrusted: false });
  assert.equal(context.state, "suspended");
  cleanup();
  assert.equal(handlers.size, 0);
});

test("muted contexts are excluded and failed resumes can retry", async () => {
  const handlers = new Map();
  let muted = true;
  let calls = 0;
  const context = { state: "interrupted", resume() {
    calls++;
    return Promise.reject(new Error("blocked"));
  } };
  installAudioUnlock({ addEventListener: (name, fn) => handlers.set(name, fn) },
    () => muted ? [] : [context]);
  handlers.get("touchend")({ isTrusted: true });
  assert.equal(calls, 0);
  muted = false;
  handlers.get("click")({ isTrusted: true });
  handlers.get("touchend")({ isTrusted: true });
  await Promise.resolve();
  assert.equal(calls, 2);
});
