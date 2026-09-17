// Resume synchronously inside the trusted event: deferring to a React effect
// loses Safari's activation. Touch activation arrives when the tap completes.
export function installAudioUnlock(target, getContexts) {
  const events = ["keydown", "pointerdown", "pointerup", "touchend", "click"];
  const options = { capture: true, passive: true };
  const unlock = (event) => {
    if (!event.isTrusted) return;
    for (const context of new Set(getContexts())) {
      if (!context || !["suspended", "interrupted"].includes(context.state)) continue;
      try { context.resume()?.catch(() => {}); } catch { /* Retry on the next gesture. */ }
    }
  };
  for (const event of events) target.addEventListener(event, unlock, options);
  return () => {
    for (const event of events) target.removeEventListener(event, unlock, options);
  };
}
