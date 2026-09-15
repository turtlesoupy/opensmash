const fs = require("node:fs");

module.exports = function windowState(file, screen) {
  let state = { bounds: { width: 1040, height: 820 }, maximized: true };
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    const b = saved.bounds;
    if ([b.x, b.y, b.width, b.height].every(Number.isSafeInteger) &&
        b.width >= 680 && b.height >= 600 && b.width <= 32768 && b.height <= 32768 &&
        typeof saved.maximized === "boolean") {
      const area = screen.getDisplayMatching(b).workArea;
      const width = Math.max(680, Math.min(b.width, area.width));
      const height = Math.max(600, Math.min(b.height, area.height));
      state = {
        maximized: saved.maximized,
        bounds: {
          width, height,
          x: Math.max(area.x, Math.min(b.x, area.x + area.width - width)),
          y: Math.max(area.y, Math.min(b.y, area.y + area.height - height)),
        },
      };
    }
  } catch {}
  return {
    bounds: state.bounds,
    maximized: state.maximized,
    track(window) {
      let timer;
      function save() {
        clearTimeout(timer);
        // Fullscreen and minimization are temporary game/window states.
        if (!window.isDestroyed() && !window.isFullScreen() && !window.isMinimized()) {
          state = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
        }
        try {
          fs.writeFileSync(file + ".tmp", JSON.stringify(state));
          fs.renameSync(file + ".tmp", file);
        } catch (error) {
          console.error("Could not save window placement:", error.message);
        }
      }
      for (const event of ["resize", "move", "maximize", "unmaximize", "leave-full-screen"])
        window.on(event, () => {
          clearTimeout(timer);
          timer = setTimeout(save, 200);
        });
      window.on("close", save);
      return save;
    },
  };
};
