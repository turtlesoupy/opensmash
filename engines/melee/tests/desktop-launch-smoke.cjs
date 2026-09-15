// Local end-to-end check using the verified disc and saved launcher settings.
// Close the development app, then run with Electron from the repository root.
// Exercises two real launches, captures the result, and closes its test session.
const {app, shell} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const resultsDirectory = path.resolve(__dirname, '../build');
const iceScenario = process.env.OPENSMASH_SMOKE_SCENARIO === 'ice-climbers';
app.setName('OpenSmash Melee');
app.setPath('userData', path.join(app.getPath('appData'), 'OpenSmash Melee'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('browser-window-created', (_event, window) => {
  const preferencesPath = path.join(app.getPath('userData'), 'launcher-preferences.json');
  let originalPreferences;
  if (iceScenario) {
    originalPreferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    const settings = {...require('../runtime/launch-options.json').defaults, stage: Number(process.env.OPENSMASH_SMOKE_STAGE || 31),
      ports: [
        {device:'keyboard',character:'selected'},
        {device:'cpu',character:'vanilla:' + (process.env.OPENSMASH_SMOKE_VANILLA || '0')},
        {device:'cpu',character:'lucianopavarotti',target:'popo'},
        {device:'cpu',character:'sachintendulkar',target:'link'},
      ]};
    fs.writeFileSync(preferencesPath, JSON.stringify({...originalPreferences, 'melee-launch-v1': JSON.stringify(settings)}));
  }
  console.log('Validation attached to window');
  window.webContents.once('did-finish-load', async () => {
    console.log('Validation page loaded');
    const run = code => Promise.race([window.webContents.executeJavaScript(code, true),
      new Promise((_,reject) => setTimeout(() => reject(Error('Renderer script timed out')), 10000))]);
    const results = [];
    try {
      let opened;
      const openExternal = shell.openExternal;
      shell.openExternal = async url => { opened = url; };
      try {
        await run("document.querySelector('.retro-github-link').click()");
        await pause(500);
        assert.equal(opened, 'https://github.com/turtlesoupy/opensmash-melee');
        console.log('PASS: GitHub button opens opensmash-melee');
      } finally {
        shell.openExternal = openExternal;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const started = Date.now();
        while (!await run("!!document.querySelector('[data-kind=fighter]') && document.querySelector('.intro-video-stage')?.style.display === 'none'")) {
          if (Date.now() - started > 30000) throw Error('Verified game setup did not become ready');
          await pause(250);
        }
        if (attempt === 0 && iceScenario) {
          await run(`window.meleeDesktop.storage.setItem('melee-launch-v1', ${JSON.stringify(originalPreferences['melee-launch-v1'])}); void 0;`);
        }
        if (attempt === 0) await run("window.validationRandom = Math.random; Math.random = () => 0; void 0;");
        await run(`(() => {
          window.validationFrames = 0;
          document.addEventListener('native-frame', () => window.validationFrames++, true);
          const fighter = [...document.querySelectorAll('[data-kind=fighter]')].find(b => /Jesus Christ/i.test(b.getAttribute('aria-label')));
          if (!fighter) throw Error('Test fighter missing');
          fighter.click();
        })()`);
        console.log('Selected test fighter');
        let elapsed = 0, lastStatus = '', firstFrameAt = null;
        while (true) {
          await pause(250);
          const state = await run(`(() => ({
            message: document.querySelector('.native-loading p')?.textContent || '',
            elapsed: document.querySelector('.native-loading small')?.textContent || '',
            error: document.querySelector('.native-game [role=alert]')?.textContent || '',
            loading: !!document.querySelector('.native-loading'),
            frames: window.validationFrames
          }))()`);
          if (state.error) throw Error(state.error);
          const log = fs.readFileSync(path.join(app.getPath('userData'), 'workspace/build/native-session.log'), 'utf8');
          if (state.frames && log.includes('[opensmash] guest assert')) throw Error(log.slice(-8000));
          const seconds = Number.parseInt(state.elapsed);
          if (Number.isFinite(seconds)) {
            assert(seconds >= elapsed, `Timer reset from ${elapsed} to ${seconds}`);
            elapsed = seconds;
          }
          if (state.frames && firstFrameAt === null) firstFrameAt = elapsed;
          if (state.message !== lastStatus) {
            console.log(JSON.stringify({attempt: attempt + 1, ...state}));
            lastStatus = state.message;
          }
          if (!state.loading && state.frames > 5) break;
          if (Date.now() - started > 120000) throw Error('Game did not become ready within two minutes');
        }
        results.push({attempt: attempt + 1, launchSeconds: (Date.now() - started) / 1000, elapsed, firstFrameAt});
        const initialFrames = await run('window.validationFrames');
        for (let second = 0; second < 20; second++) {
          await pause(1000);
          const log = fs.readFileSync(path.join(app.getPath('userData'), 'workspace/build/native-session.log'), 'utf8');
          assert(!log.includes('[opensmash] guest assert'), log.slice(-8000));
        }
        assert(await run('window.validationFrames') > initialFrames + 100, 'Combat frames stopped');
        if (attempt === 0) {
          await run("[...document.querySelectorAll('.native-game button')].find(b => b.textContent.includes('Return to roster')).click()");
          await pause(750);
        }
      }
      await run("[...document.querySelectorAll('.native-game button')].find(b => b.textContent.includes('Fullscreen')).click()");
      await pause(500);
      assert.equal(window.isFullScreen(), true);
      const layout = await run(`(() => {const r=document.querySelector('.native-game').getBoundingClientRect();return [r.x,r.y,r.width,r.height,innerWidth,innerHeight,document.body.classList.contains('is-native-fullscreen')];})()`);
      assert.deepEqual(layout, [0,0,layout[4],layout[5],layout[4],layout[5],true]);
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      await pause(500);
      assert.equal(window.isFullScreen(), false);
      fs.writeFileSync(path.join(resultsDirectory,'desktop-validation.json'), JSON.stringify(results,null,2));
      fs.writeFileSync(path.join(resultsDirectory,'desktop-validation.png'), (await window.webContents.capturePage()).toPNG());
      console.log('PASS: two real launches, continuous elapsed timer, rendered frames, fullscreen and Escape. Closing test session.');
      console.log(JSON.stringify(results));
    } catch (error) {
      console.error('VALIDATION FAILED:', error);
      fs.writeFileSync(path.join(resultsDirectory,'desktop-validation-error.txt'), String(error.stack));
    } finally {
      if (!window.isDestroyed()) await run("if (window.validationRandom) Math.random = window.validationRandom; void 0;").catch(() => {});
      if (iceScenario && originalPreferences) fs.writeFileSync(preferencesPath, JSON.stringify(originalPreferences));
      // Bound shutdown even if a native surface prevents Electron from exiting.
      setTimeout(() => app.exit(), 30000).unref();
      app.quit();
    }
  });
});
require('../desktop/main.cjs');
