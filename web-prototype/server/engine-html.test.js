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

test('N64 keyboard adapter installs before engine scripts and is idempotent', async () => {
  const {withN64Keyboard}=await import('./engine-html.js');
  const html='<head></head><body><script>boot()</script></body>';
  const result=withN64Keyboard(withControllerRemap(html));
  assert.ok(result.indexOf('openSmashN64Keyboard.installEngine()')<result.indexOf('boot()'));
  assert.equal(withN64Keyboard(result),result);
});
