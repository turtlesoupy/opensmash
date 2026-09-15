// Install compatibility handling in each rendering pthread before Emscripten
// starts it. Synchronous imports preserve the initial pthread message queue.
importScripts(new URL('./webgl-compat.js', self.location.href).href);
if (new URL(self.location.href).searchParams.get('debug-present') === '1')
  importScripts(new URL('./webgl-diagnostics.js', self.location.href).href);
const runtimeVersion = new URL(self.location.href).searchParams.get('v');
importScripts(new URL('./opensmash-web.js?v=' + encodeURIComponent(runtimeVersion || ''), self.location.href).href);
