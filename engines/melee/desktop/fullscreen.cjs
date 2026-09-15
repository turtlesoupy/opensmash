// Keep every fullscreen entry point on the same native window transition.
module.exports = function fullscreen(window) {
  let pending = null;
  let active = window.isFullScreen();
  const publish = () => {
    window.webContents.send("melee:fullscreen-state", active);
  };
  const settled = (value) => {
    active = value;
    pending = null;
    publish();
  };
  // On Windows isFullScreen() can still report the previous state inside
  // these events. The event itself is the authoritative transition result.
  window.on("enter-full-screen", () => settled(true));
  window.on("leave-full-screen", () => settled(false));
  window.webContents.on("did-finish-load", publish);
  return (value) => {
    // Ignore repeated toggles until the native transition has completed.
    if (pending !== null && typeof value !== "boolean") return;
    const target = typeof value === "boolean" ? value : !active;
    if (pending === null && target === active) return publish();
    pending = target;
    window.setFullScreen(target);
  };
};
