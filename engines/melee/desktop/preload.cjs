const { contextBridge, ipcRenderer, sharedTexture } = require("electron");
let surfaceActive = false;
ipcRenderer.on("melee:frame", (_event, id, pixels) => {
  try {
    const canvas = surfaceActive && document.getElementById("native-game-canvas");
    if (!canvas || pixels.byteLength !== 960 * 720 * 4) return;
    if (canvas.width !== 960) canvas.width = 960;
    if (canvas.height !== 720) canvas.height = 720;
    canvas
      .getContext("2d", { alpha: false })
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
          960,
          720,
        ),
        0,
        0,
      );
    canvas.dispatchEvent(new Event("native-frame"));
  } catch (error) {
    document
      .getElementById("native-game-canvas")
      ?.dispatchEvent(new CustomEvent("native-error", { detail: error.message }));
  } finally {
    ipcRenderer.send("melee:frame-ack", id);
  }
});
ipcRenderer.on("melee:fullscreen-state", (_event, fullscreen) => {
  document.body.classList.toggle("is-native-fullscreen", fullscreen);
});
if (sharedTexture)
  sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }) => {
    let frame;
    try {
      const canvas = surfaceActive && document.getElementById("native-game-canvas");
      if (!canvas) return;
      frame = importedSharedTexture.getVideoFrame();
      if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
      if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
      canvas.getContext("2d", { alpha: false }).drawImage(frame, 0, 0);
      canvas.dispatchEvent(new Event("native-frame"));
    } finally {
      frame?.close();
      importedSharedTexture.release();
    }
  });
ipcRenderer.on("melee:surface-error", (_event, message) => {
  document
    .getElementById("native-game-canvas")
    ?.dispatchEvent(new CustomEvent("native-error", { detail: message }));
});
contextBridge.exposeInMainWorld(
  "meleeDesktop",
  Object.freeze({
    storage: {
      getItem: (key) => ipcRenderer.sendSync("melee:preference", "get", key),
      setItem: (key, value) => ipcRenderer.sendSync("melee:preference", "set", key, value),
      removeItem: (key) => ipcRenderer.sendSync("melee:preference", "remove", key),
    },
    protocol: 1,
    embedded: true,
    onOpenSettings: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("melee:open-settings", listener);
      return () => ipcRenderer.removeListener("melee:open-settings", listener);
    },
    beginGame: (session) => ipcRenderer.invoke("melee:begin-game", session),
    setGameActive: (active) => {
      surfaceActive = active === true;
      ipcRenderer.send("melee:surface-ready", surfaceActive);
    },
    input: (code, down) => ipcRenderer.send("melee:input", code, down),
    fullscreen: (value) => ipcRenderer.invoke("melee:fullscreen", value),
    chooseDisc: () => ipcRenderer.invoke("melee:choose-disc"),
  }),
);

if(process.argv.includes('--opensmash-shared-launcher'))contextBridge.exposeInMainWorld('openSmashDesktop',Object.freeze({
 input:(session,ports)=>ipcRenderer.send('opensmash:input',session,ports),
 mute:value=>ipcRenderer.send('opensmash:mute',value),
 protocol:1,engines:Object.freeze({ssb64:true,melee:true}),
 launch:request=>ipcRenderer.invoke('opensmash:launch',request),
 stop:request=>ipcRenderer.invoke('opensmash:stop',request),
 status:engine=>ipcRenderer.invoke('opensmash:status',engine),
}));
