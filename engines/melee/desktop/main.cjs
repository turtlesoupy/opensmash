const { net, protocol, app, BrowserWindow, dialog, ipcMain, shell, session, screen, Menu } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs"),
  path = require("node:path");
let window,
  backend,
  surface,
  origin,
  launcherOrigin,
  ssb64,
  ssb64Surface,
  activeEngine="melee",
  launcherInput,
  sharedPopupPolicy,
  saveWindowState,
  quitting = false;
const sharedLauncher=process.env.OPENSMASH_SHARED_LAUNCHER==='1'||require('./package.json').opensmashSharedLauncher===true;
if(sharedLauncher)app.setPath('userData',process.env.OPENSMASH_DESKTOP_DATA||path.join(app.getPath('appData'),app.isPackaged?'OpenSmash':'OpenSmash Integration'));
const token = randomBytes(32).toString("hex");
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../build");
const externalHosts = new Set(["github.com", "discord.gg"]);
async function startBackend() {
  const exe = app.isPackaged
    ? path.join(
        resources,
        "backend",
        "melee-backend",
        process.platform === "win32" ? "melee-backend.exe" : "melee-backend",
      )
    : process.env.OPENSMASH_DESKTOP_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const args = app.isPackaged ? [] : [path.join(__dirname, "backend_entry.py"), "--development"];
  const child = spawn(
    exe,
    [...args, "--desktop", app.getPath("userData"), "--resources", resources],
    {
      env: { ...process.env, ...surface?.environment, OPENSMASH_DESKTOP_TOKEN: token, ...(launcherInput?{OPENSMASH_LAUNCHER_INPUT:launcherInput.file}:{}) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  backend = child;
  const log = fs.createWriteStream(path.join(app.getPath("userData"), "desktop-backend.log"), {
    flags: "a",
  });
  child.stderr.pipe(log);
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error("The local game service did not start. Check desktop-backend.log."));
    }, 60000);
    child.once("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(Error(`Game service stopped (${code}).`));
      if (!quitting && window) {
        dialog.showErrorBox(
          "Game service stopped",
          "Close and reopen OpenSmash Melee. Your saved game is retained.",
        );
        app.quit();
      }
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.port) {
            clearTimeout(timeout);
            resolve(`http://127.0.0.1:${msg.port}`);
          }
        } catch {
          log.write(line + "\n");
        }
      }
    });
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(async () => {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    try {
      // Keep both engines on the same canvas transport when switching experiences.
      surface = require("./surface.cjs")(app.getPath("userData"), sharedLauncher);
      if(sharedLauncher){
        const root=app.isPackaged?path.join(resources,'launcher'):path.resolve(__dirname,'../../../desktop');
        launcherInput=require(path.join(root,'input.cjs')).createInput(app.getPath('userData'));
        ssb64Surface=require('./frame.cjs')(app.getPath('userData'),{});
      }
      origin = await startBackend();
      launcherOrigin = origin;
      if (sharedLauncher) {
        const launcherRoot = app.isPackaged ? path.join(resources,'launcher') : path.resolve(__dirname,'../../../desktop');
        const dist = app.isPackaged ? path.join(resources,'shared-web') : path.resolve(__dirname,'../../../web-prototype/dist');
        if(!fs.existsSync(path.join(dist,'index.html')))throw Error('Build the shared website frontend before starting the unified client.');
        const {createSiteHandler}=require(path.join(launcherRoot,'site.cjs'));
        sharedPopupPolicy=require(path.join(launcherRoot,'window-policy.cjs')).popupPolicy;
        protocol.handle('https',createSiteHandler({dist,backend:origin,token,
          fetchRemote:request=>net.fetch(request,{bypassCustomProtocolHandlers:true})}));
        launcherOrigin='https://smash.fun';
        const servicePath=app.isPackaged?path.join(resources,'ssb64-service','service.cjs'):path.resolve(__dirname,'../../ssb64/desktop/service.cjs');
        const {createNativeSsb64}=require(servicePath);
        ssb64=createNativeSsb64({chooseRom:async()=>{const result=await dialog.showOpenDialog(window,{title:'Choose Smash 64 USA ROM',properties:['openFile'],filters:[{name:'Nintendo 64 ROM',extensions:['z64','n64','v64']}]});return result.canceled?null:result.filePaths[0];},frameEnvironment:ssb64Surface?.environment,inputFile:launcherInput?.file,runtime:process.env.OPENSMASH_SSB64_RUNTIME||path.join(resources,'ssb64'),workspace:path.join(app.getPath('userData'),'ssb64-sessions')});
      }
      session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: [origin + "/*"] },
        (details, callback) =>
          callback({ requestHeaders: { ...details.requestHeaders, "X-OpenSmash-Token": token } }),
      );
      session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) =>
        callback(false),
      );
      const placement = require("./window-state.cjs")(
        path.join(app.getPath("userData"), "window-state.json"), screen,
      );
      window = new BrowserWindow({
        ...placement.bounds,
        minWidth: 680,
        minHeight: 600,
        title: ssb64 ? "OpenSmash" : "OpenSmash Melee",
        backgroundColor: "#0c0905",
        show: false,
        autoHideMenuBar: process.platform !== "darwin",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          additionalArguments: ssb64 ? ["--opensmash-shared-launcher"] : [],
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      if(process.env.OPENSMASH_FORCE_MUTE==='1')window.webContents.setAudioMuted(true);
      saveWindowState = placement.track(window);
      const setFullscreen = require("./fullscreen.cjs")(window);
      const settingsItem = {
        label: "Settings…", accelerator: "CmdOrCtrl+,",
        click: () => window.webContents.send("melee:open-settings"),
      };
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu", submenu: [
          { role: "about" }, { type: "separator" }, settingsItem,
          { type: "separator" }, { role: "services" }, { role: "hide" }, { role: "quit" },
        ] }] : [{ label: "File", submenu: [settingsItem, { type: "separator" }, { role: "quit" }] }]),
        { role: "editMenu" }, { label: "View", submenu: [
          { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
          { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
          { type: "separator" },
          { label: "Toggle Fullscreen", accelerator: process.platform === "darwin" ? "Ctrl+Command+F" : "F11",
            click: () => setFullscreen() },
        ] }, { role: "windowMenu" },
      ]));
      if (process.platform !== "darwin") window.setMenuBarVisibility(false);
      surface?.attach(window);
      ssb64Surface?.attach(window);
      const lifecycle = require("./game-lifecycle.cjs")(async (route, body) => {
        const response = await fetch(origin + route, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenSmash-Token": token },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Could not change the game session.");
        return result;
      }, surface);
      const resetGame = () => {
        ssb64Surface?.ready(false);
        launcherInput?.stop();
        void ssb64?.stop();
        void lifecycle.reset().catch((error) => {
          if (!quitting) dialog.showErrorBox("Could not close the game", error.message);
        });
      };
      window.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) resetGame();
      });
      window.webContents.on("render-process-gone", resetGame);
      window.webContents.on('did-create-window', child => {
        child.webContents.setWindowOpenHandler(() => ({action:'deny'}));
        child.webContents.on('will-navigate', (event,url) => {
          if(new URL(url).protocol!=='https:')event.preventDefault();
        });
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        const policy=sharedPopupPolicy?.(url,launcherOrigin);
        if(policy?.action==='allow')return policy;
        try {
          const u = new URL(url);
          if (u.protocol === "https:" && externalHosts.has(u.hostname))
            void shell.openExternal(url);
        } catch {}
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== launcherOrigin) event.preventDefault();
      });
      function validateCaller(event) {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          new URL(event.senderFrame.url).origin !== launcherOrigin
        )
          throw Error("Invalid desktop caller.");
      }
      ipcMain.on('opensmash:input',(event,session,ports)=>{
        try{validateCaller(event);launcherInput?.update(session,ports);}catch{}
      });
      ipcMain.on('opensmash:mute',(event,value)=>{
        try{validateCaller(event);if(typeof value==='boolean')launcherInput?.mute(process.env.OPENSMASH_FORCE_MUTE==='1'||value);}catch{}
      });
      ipcMain.handle('opensmash:launch',async(event,request)=>{
        validateCaller(event);
        if(!ssb64||request?.engine!=='ssb64')throw Error('Unsupported native engine.');
        await lifecycle.reset();
        activeEngine="ssb64";
        launcherInput?.begin(request.session);
        return ssb64.launch(request);
      });
      ipcMain.handle('opensmash:stop',async(event,request)=>{
        validateCaller(event);
        if(request?.engine==='ssb64'){if(ssb64?.status().session===request.session)ssb64Surface?.ready(false);launcherInput?.stop(request.session);return ssb64?.stop(request.session);}
        throw Error('Unsupported native engine.');
      });
      ipcMain.handle('opensmash:status',(event,engine)=>{
        validateCaller(event);
        if(engine==='ssb64')return ssb64?.status();
        throw Error('Unsupported native engine.');
      });
      const preferencesPath = path.join(app.getPath("userData"), "launcher-preferences.json");
      ipcMain.handle("melee:begin-game", async (event, session) => {
        validateCaller(event);
        await ssb64?.stop();
        ssb64Surface?.ready(false);activeEngine="melee";
        const result=await lifecycle.begin(session);
        launcherInput?.begin(session);
        return result;
      });
      ipcMain.on("melee:surface-ready", (event, ready) => {
        validateCaller(event);
        (activeEngine==="ssb64"?ssb64Surface:surface)?.ready(ready === true);
      });
      ipcMain.on("melee:frame-ack", (event, id) => {
        validateCaller(event);
        (activeEngine==="ssb64"?ssb64Surface:surface)?.ack?.(id);
      });
      ipcMain.on("melee:input", (event, code, down) => {
        validateCaller(event);
        if (code === null) surface?.clearInput();
        else if (typeof code === "string" && typeof down === "boolean") surface?.input(code, down);
      });
      ipcMain.handle("melee:fullscreen", (event, value) => {
        validateCaller(event);
        setFullscreen(value);
      });
      window.webContents.on("before-input-event", (event, input) => {
        if (
          input.type === "keyDown" &&
          !input.isAutoRepeat &&
          input.key === "Escape" && window.isFullScreen()
        ) {
          event.preventDefault();
          setFullscreen(false);
        }
      });
      let preferences = {};
      try {
        preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
      } catch {}
      const preferenceKeys = new Set(["melee-launch-v1", "melee-pending-import-v1", "melee-controls-v1"]);
      ipcMain.on("melee:preference", (event, operation, key, value) => {
        try {
          validateCaller(event);
          if (!preferenceKeys.has(key)) throw Error("Invalid preference key");
          if (operation === "get") {
            event.returnValue = preferences[key] ?? null;
            return;
          }
          if (operation === "set" && typeof value === "string" && value.length <= 16384)
            preferences[key] = value;
          else if (operation === "remove") delete preferences[key];
          else throw Error("Invalid preference");
          const temporary = preferencesPath + ".tmp";
          fs.writeFileSync(temporary, JSON.stringify(preferences));
          fs.renameSync(temporary, preferencesPath);
          event.returnValue = true;
        } catch {
          event.returnValue = null;
        }
      });
      ipcMain.handle("melee:choose-disc", async (event) => {
        validateCaller(event);
        const selected = await dialog.showOpenDialog(window, {
          title: "Choose Melee USA 1.02",
          properties: ["openFile"],
          filters: [{ name: "GameCube disc", extensions: ["iso", "gcm", "zip"] }],
        });
        if (selected.canceled) return { cancelled: true };
        const response = await fetch(origin + "/api/native/disc", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenSmash-Token": token },
          body: JSON.stringify({ path: selected.filePaths[0] }),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        return result;
      });
      await window.loadURL(launcherOrigin);
      if (placement.maximized) window.maximize();
      window.show();
    } catch (e) {
      dialog.showErrorBox("OpenSmash Melee could not start", e.message);
      app.quit();
    }
  });
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  saveWindowState?.();
  const ssb64Stop = ssb64?.stop();
  const stop = origin
    ? fetch(origin + "/api/native/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenSmash-Token": token },
        body: "{}",
        signal: AbortSignal.timeout(20000),
      })
    : Promise.resolve();
  Promise.allSettled([stop,ssb64Stop])
    .finally(() => {
      backend?.kill();
      surface?.close();
      ssb64Surface?.close();
      launcherInput?.close();
      app.exit();
    });
});
