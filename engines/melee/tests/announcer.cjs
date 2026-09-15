const {test} = require('node:test');
const assert = require('node:assert/strict');
test('selection replaces the previous voice; old playback failures cannot stop the new one', async () => {
  const clips = [];
  global.Audio = class {
    constructor(url) { this.url = url; this.currentTime = 4; clips.push(this); }
    pause() { this.paused = true; }
    play() { return new Promise((resolve, reject) => { this.reject = reject; }); }
    addEventListener(name, callback) { this[name] = callback; }
  };
  const {announceCharacter, stopAnnouncer} = await import('../web/lib/announcer.ts');
  announceCharacter('first fighter');
  assert.equal(clips[0].url, '/api/announcer/first%20fighter');
  announceCharacter('second');
  assert.equal(clips[0].paused, true);
  assert.equal(clips[0].currentTime, 0);
  clips[0].reject(Error('interrupted'));
  await Promise.resolve();
  stopAnnouncer();
  assert.equal(clips[1].paused, true);
  announceCharacter('third');
  clips[2].ended();
  stopAnnouncer();
  assert.equal(clips[2].paused, undefined);
  delete global.Audio;
});
