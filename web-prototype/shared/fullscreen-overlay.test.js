import assert from "node:assert/strict";
import test from "node:test";
import { mountFullscreenOverlay } from "./fullscreen-overlay.js";

function harness() {
  const listeners = new Map();
  const element = (shell = false) => ({
    children: [],
    setAttribute() {},
    matches: (selector) => shell && selector === ".game-surface-shell",
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; },
  });
  const document = {
    createElement: () => element(),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const host = element();
  const cleanup = mountFullscreenOverlay(host, document);
  return { document, host, canvas: host.children[0], shell: element(true), other: element(), listeners, cleanup };
}

for (const [property, event] of [["fullscreenElement", "fullscreenchange"], ["webkitFullscreenElement", "webkitfullscreenchange"]]) {
  test(`${event} preserves the canvas across repeated enter/exit and cleans up`, () => {
    const h = harness();
    for (let i = 0; i < 2; i++) {
      h.document[property] = h.shell;
      h.listeners.get(event)();
      assert.equal(h.canvas.parentNode, h.shell);
      assert.deepEqual(h.shell.children, [h.canvas]);
      h.document[property] = null;
      h.listeners.get(event)();
      assert.deepEqual(h.host.children, [h.canvas]);
      assert.equal(h.shell.children.length, 0);
    }
    h.document[property] = h.shell;
    h.listeners.get(event)();
    h.cleanup();
    assert.equal(h.listeners.size, 0);
    assert.equal(h.shell.children.length, 0);
  });
}

test("unrelated fullscreen elements do not take ownership of the CRT canvas", () => {
  const h = harness();
  h.document.fullscreenElement = h.other;
  h.listeners.get("fullscreenchange")();
  assert.equal(h.canvas.parentNode, h.host);
  h.cleanup();
});
