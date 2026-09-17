// Run with desktop/node_modules/.bin/electron tests/fullscreen.test.cjs.
const { app, BrowserWindow, Menu, screen } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const createFullscreen = require("../desktop/fullscreen.cjs");
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1040, height: 820, show: process.platform === 'darwin',
    autoHideMenuBar: true,
    webPreferences: { preload: path.resolve(__dirname, "../desktop/preload.cjs"), sandbox: true },
  });
  const toggle = createFullscreen(window);
  window.webContents.on("preload-error", (_event, file, error) => console.error(file, error));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "View", submenu: [
    { label: "Toggle Fullscreen", accelerator: "F11", click: () => toggle() },
  ] }]));
  window.setMenuBarVisibility(false);
  // Website layout is owned by the unified shell; this test covers the
  // native window transition and preload notification.
  await window.loadURL("data:text/html;charset=utf-8,<html><body>Unified launcher window</body></html>");
  const transition = async value => {
    const completed = new Promise((resolve, reject) => {
      window.once(value ? 'enter-full-screen' : 'leave-full-screen', resolve);
      setTimeout(() => reject(Error('Fullscreen transition timed out')), 10000).unref();
    });
    toggle(value);
    await completed;
    await pause();
  };
  for (const maximized of [false, true]) {
    if (maximized) window.maximize();
    await pause();
    for (let i = 0; i < 3; i++) {
      await transition(true);
      assert.equal(window.isFullScreen(), true);
      assert.deepEqual(window.getBounds(), screen.getDisplayMatching(window.getBounds()).bounds);
      await transition(false);
      assert.equal(window.isFullScreen(), false);
      assert.equal(await window.webContents.executeJavaScript("document.body.classList.contains('is-native-fullscreen')"), false);
    }
  }
  console.log("PASS: repeated fullscreen from normal/maximized windows covers the display.");
  window.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
