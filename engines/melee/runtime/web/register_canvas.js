// Intercept our explicit frame messages before Emscripten's pthread handler.
// This presents frames even while the synchronous game loop owns its worker.
if (typeof Worker !== 'undefined') {
  const NativeWorker = Worker;
  Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data?.cmd === 'opensmash-frame') {
          event.stopImmediatePropagation();
          Module['onFrame']?.(event.data.bitmap);
        }
      });
    }
  };
}
// The host transfers its DOM canvas into the engine's control worker. Register
// that OffscreenCanvas for Emscripten's selector-based GL API; rendering pthreads
// proxy commands to this owner, leaving the page/input thread responsive.
Module['preRun'] = [() => {
  if (Module['canvas']) {
    Module['canvas'].id = 'canvas';
    GL.offscreenCanvases['canvas'] = {offscreenCanvas: Module['canvas'], id: 'canvas'};
  }
}];

if (typeof self !== "undefined") self.addEventListener("error", event => { if (typeof err === "function") err("[browser-stack] " + (event.error?.stack || event.message)); });
