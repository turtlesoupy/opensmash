// Engine keyboard map: WASD stick, J=A, K=B, L=Z, I=L, O=R, Space=Start,
// U=C-up (jump in Smash 64). Arrows are a stick fallback, so the overlay's
// Jump must send KeyU rather than ArrowUp.
export const MOBILE_KEY_VALUES = Object.freeze({
  KeyA: "a",
  KeyD: "d",
  KeyI: "i",
  KeyJ: "j",
  KeyK: "k",
  KeyL: "l",
  KeyO: "o",
  KeyS: "s",
  KeyU: "u",
  KeyW: "w",
  Space: " ",
});

export function joystickCodesForVector(x, y, radius, {
  axisThreshold = 0.32,
  deadZone = 0.28,
} = {}) {
  const safeRadius = Math.max(1, radius);
  const normalizedX = x / safeRadius;
  const normalizedY = y / safeRadius;
  const codes = new Set();
  if (Math.hypot(normalizedX, normalizedY) < deadZone) return codes;
  if (normalizedX <= -axisThreshold) codes.add("KeyA");
  if (normalizedX >= axisThreshold) codes.add("KeyD");
  if (normalizedY <= -axisThreshold) codes.add("KeyW");
  if (normalizedY >= axisThreshold) codes.add("KeyS");
  return codes;
}

// A radial dead zone with a continuous ramp to the N64's full stick range.
// Screen Y points down; the controller's positive Y points up.
export function joystickAxesForVector(x, y, radius, { deadZone = 0.28 } = {}) {
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) return { x: 0, y: 0 };
  const nx = x / radius, ny = y / radius;
  const distance = Math.hypot(nx, ny);
  const dead = Math.max(0, Math.min(0.99, deadZone));
  if (distance <= dead) return { x: 0, y: 0 };
  const strength = (Math.min(1, distance) - dead) / (1 - dead);
  return {
    x: Math.round(nx / distance * strength * 80) || 0,
    y: Math.round(-ny / distance * strength * 80) || 0,
  };
}

// Null releases the touch override so ordinary keyboard input works again.
// The shell copies these numbers; no engine callbacks are retained by the page.
export function dispatchGameStick(frame, axes) {
  try {
    const ports = frame?.contentWindow?.controllerPorts;
    if (typeof ports?.setVirtualStick !== "function") return false;
    ports.setVirtualStick(axes);
    return true;
  } catch {
    return false;
  }
}

export function dispatchGameKey(frame, code, pressed) {
  try {
    const frameWindow = frame?.contentWindow;
    const canvas = frame?.contentDocument?.getElementById("canvas");
    if (!frameWindow?.KeyboardEvent || !canvas) return false;
    // Synthetic events reach the engine through bubbling without focus. Moving
    // focus into the iframe here can blur the touch deck and release its keys
    // before this keydown is delivered, leaving an untracked key held in-game.
    canvas.dispatchEvent(new frameWindow.KeyboardEvent(pressed ? "keydown" : "keyup", {
      bubbles: true,
      cancelable: true,
      code,
      key: MOBILE_KEY_VALUES[code] || code,
    }));
    return true;
  } catch {
    return false;
  }
}
