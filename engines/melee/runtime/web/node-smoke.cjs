// Headless real-game smoke run. Accepts the private extracted game and runtime paths.
const fs = require('node:fs');
const path = require('node:path');
const build = path.resolve(process.argv[2]);
const game = path.resolve(process.argv[3]);
const sys = path.resolve(process.argv[4]);
const duration = Number(process.argv[5] || 120);
(async () => {
  const createMelee = require(path.join(build, 'opensmash-web.js'));
  const engine = await createMelee({
    wasmBinary: fs.readFileSync(path.join(build, 'opensmash-web.wasm')),
    locateFile: file => path.join(build, file),
    print: console.log,
    printErr: console.error,
  });
  engine.FS.mkdir('/game');
  engine.FS.mount(engine.NODEFS, {root: game}, '/game');
  engine.FS.mkdir('/sys');
  engine.FS.mount(engine.NODEFS, {root: sys}, '/sys');
  engine.FS.mkdir('/user');
  engine._opensmash_set_pad(0, 0, 0x80808080, 0, 1);
  engine.callMain(['/game', 'Null', '/user', '8']);
  const start = Date.now();
  // The first isolated run must confirm creation of its new memory card.
  const input = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    engine._opensmash_set_pad(0, Math.floor(elapsed) % 3 === 0 ? 0x100 : 0, 0x80808080, 0, 1);
  }, 100);
  setTimeout(() => {clearInterval(input); console.log('Smoke timeout reached. Check game evidence; timeout is not a pass.'); process.exit(2);}, duration * 1000);
})().catch(error => {console.error(error); process.exit(1);});
