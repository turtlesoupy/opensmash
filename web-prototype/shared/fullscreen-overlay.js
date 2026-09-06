// Keep the same canvas (and WebGL context) when native fullscreen promotes
// the game shell into the browser's top layer. The host owns no React children.
export function mountFullscreenOverlay(host, document) {
  const canvas = document.createElement("canvas");
  canvas.id = "crt-viewport-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  function sync() {
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    const parent = fullscreen?.matches(".game-surface-shell") ? fullscreen : host;
    if (canvas.parentNode !== parent) parent.appendChild(canvas);
  }

  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  sync();
  return () => {
    document.removeEventListener("fullscreenchange", sync);
    document.removeEventListener("webkitfullscreenchange", sync);
    canvas.remove();
  };
}
