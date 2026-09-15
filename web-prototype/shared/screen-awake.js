// Keep an active game or file transfer awake. The browser may refuse a lock
// (for example in battery saver); this must never block the activity itself.
export function holdScreenAwake({ document = globalThis.document, wakeLock = globalThis.navigator?.wakeLock } = {}) {
  if (!document || !wakeLock?.request) return () => {};
  let sentinel = null, pending = false, released = false;
  const acquire = async () => {
    if (released || pending || (sentinel && !sentinel.released) || document.visibilityState !== "visible") return;
    pending = true;
    try {
      const lock = await wakeLock.request("screen");
      if (released || document.visibilityState !== "visible") {
        await lock.release();
      } else {
        sentinel = lock;
        lock.addEventListener("release", () => { if (sentinel === lock) sentinel = null; }, { once: true });
      }
    } catch { /* Screen locking remains under browser and device control. */ }
    finally { pending = false; }
  };
  const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
  document.addEventListener("visibilitychange", onVisible);
  void acquire();
  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisible);
    sentinel?.release().catch(() => {});
    sentinel = null;
  };
}
