import assert from "node:assert/strict";
import test from "node:test";
import { withControllerRemap } from "./engine-html.js";

test("injects the controller remapper before engine scripts run", () => {
  const html = "<html><head><title>Engine</title></head><body><script>boot()</script></body></html>";
  const result = withControllerRemap(html);
  assert.match(result, /<script src="\/controller-remap\.js"><\/script>\s*<\/head>/);
  assert.ok(result.indexOf("controller-remap.js") < result.indexOf("boot()"));
});

test("does not inject the remapper twice", () => {
  const html = '<head><script src="/controller-remap.js"></script></head>';
  assert.equal(withControllerRemap(html), html);
});
