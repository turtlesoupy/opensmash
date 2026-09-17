import assert from "node:assert/strict";
import test from "node:test";
import { controlEmbeddedTrailer } from "../src/embedded-trailer.js";

test('native trailer supports the same playback and sound commands', async () => {
  const calls = [];
  const video = { tagName: 'VIDEO', muted: true, currentTime: 0,
    play() { calls.push('play'); return Promise.reject(new Error('autoplay blocked')); },
    pause() { calls.push('pause'); },
  };
  controlEmbeddedTrailer(video, 'unMute');
  assert.equal(video.muted, false);
  controlEmbeddedTrailer(video, 'mute');
  assert.equal(video.muted, true);
  controlEmbeddedTrailer(video, 'seekTo', [12, true]);
  assert.equal(video.currentTime, 12);
  controlEmbeddedTrailer(video, 'playVideo');
  controlEmbeddedTrailer(video, 'pauseVideo');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['play', 'pause']);
});
