import assert from "node:assert/strict";
import test from "node:test";

import {
  controlEmbeddedTrailer,
  subscribeEmbeddedTrailer,
  TRAILER_EMBED_URL,
} from "../src/embedded-trailer.js";

function player() {
  const calls = [];
  return {
    id: "test-player",
    calls,
    contentWindow: {
      postMessage(message, origin) { calls.push([JSON.parse(message), origin]); },
    },
  };
}

test("YouTube embed keeps native controls enabled on one persistent player", () => {
  const url = new URL(TRAILER_EMBED_URL);
  assert.equal(url.searchParams.get("controls"), "1");
  assert.equal(url.searchParams.get("enablejsapi"), "1");
  assert.equal(url.searchParams.get("autoplay"), "1");
});

test("trailer controls use the YouTube iframe API", () => {
  const iframe = player();

  controlEmbeddedTrailer(iframe, "playVideo");
  controlEmbeddedTrailer(iframe, "seekTo", [27.5, true]);
  subscribeEmbeddedTrailer(iframe);

  assert.deepEqual(iframe.calls.map(([message]) => message), [
    { event: "command", func: "playVideo", args: [] },
    { event: "command", func: "seekTo", args: [27.5, true] },
    { event: "listening", id: "test-player" },
  ]);
  assert.ok(iframe.calls.every(([, origin]) => origin === "https://www.youtube-nocookie.com"));
});

test('isolated trailer falls back when credentialless iframes are unavailable', async () => {
  const {canEmbedTrailer} = await import('../src/embedded-trailer.js');
  assert.equal(canEmbedTrailer({}), false);
  assert.equal(canEmbedTrailer(null), false);
  assert.equal(canEmbedTrailer({credentialless: false}), true);
});
