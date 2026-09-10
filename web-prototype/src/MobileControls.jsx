import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchGameKey, joystickCodesForVector } from "../shared/mobile-input.js";

function directionLabel(codes) {
  const vertical = codes.has("KeyW") ? "up" : codes.has("KeyS") ? "down" : "";
  const horizontal = codes.has("KeyA") ? "left" : codes.has("KeyD") ? "right" : "";
  return [vertical, horizontal].filter(Boolean).join(" ") || "centered";
}

function MobileButton({ code, label, description, caption = description, className = "", pressed, onPress, onRelease }) {
  const pointerRef = useRef(null);
  const activationTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(activationTimerRef.current), []);

  function press(event) {
    if (pointerRef.current !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onPress(code);
  }

  function release(event) {
    if (pointerRef.current !== event.pointerId) return;
    event.preventDefault();
    pointerRef.current = null;
    onRelease(code);
  }

  function pressFromKeyboard(event) {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat) return;
    event.preventDefault();
    onPress(code);
  }

  function releaseFromKeyboard(event) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    onRelease(code);
  }

  function activateFromAssistiveClick(event) {
    if (event.detail !== 0) return;
    onPress(code);
    window.clearTimeout(activationTimerRef.current);
    activationTimerRef.current = window.setTimeout(() => onRelease(code), 110);
  }

  return (
    <button
      className={`mobile-control-button ${className}`}
      type="button"
      aria-label={description}
      aria-pressed={pressed}
      data-code={code}
      onBlur={() => onRelease(code)}
      onClick={activateFromAssistiveClick}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={pressFromKeyboard}
      onKeyUp={releaseFromKeyboard}
      onLostPointerCapture={release}
      onPointerCancel={release}
      onPointerDown={press}
      onPointerUp={release}
    >
      <span aria-hidden="true">{label}</span>
      <small aria-hidden="true">{caption}</small>
    </button>
  );
}

export default function MobileControls({ active, frameRef, preview = false }) {
  const heldCodesRef = useRef(new Set());
  const joystickCodesRef = useRef(new Set());
  const joystickPointerRef = useRef(null);
  const joystickRef = useRef(null);
  const pulseTimersRef = useRef(new Set());
  const [heldCodes, setHeldCodes] = useState(() => new Set());
  const [inputLog, setInputLog] = useState([]);
  const [joystickPosition, setJoystickPosition] = useState({ x: 0, y: 0 });
  const [lastInput, setLastInput] = useState("none");

  const sendKey = useCallback(
    (code, pressed) => dispatchGameKey(frameRef.current, code, pressed),
    [frameRef],
  );

  const setCodePressed = useCallback((code, pressed) => {
    const next = new Set(heldCodesRef.current);
    if (pressed) {
      if (next.has(code)) return;
      next.add(code);
    } else {
      if (!next.has(code)) return;
      next.delete(code);
    }
    heldCodesRef.current = next;
    sendKey(code, pressed);
    setHeldCodes(next);
    const transition = `${code}:${pressed ? "down" : "up"}`;
    setLastInput(transition);
    setInputLog((current) => [...current, transition].slice(-16));
  }, [sendKey]);

  const releaseJoystick = useCallback(() => {
    joystickPointerRef.current = null;
    joystickCodesRef.current.forEach((code) => setCodePressed(code, false));
    joystickCodesRef.current = new Set();
    setJoystickPosition({ x: 0, y: 0 });
  }, [setCodePressed]);

  const releaseAll = useCallback(() => {
    joystickPointerRef.current = null;
    heldCodesRef.current.forEach((code) => sendKey(code, false));
    heldCodesRef.current = new Set();
    joystickCodesRef.current = new Set();
    setHeldCodes(new Set());
    setJoystickPosition({ x: 0, y: 0 });
    setLastInput("released");
  }, [sendKey]);

  useEffect(() => {
    if (!active) releaseAll();
  }, [active, releaseAll]);

  useEffect(() => {
    const frame = frameRef.current;
    const replayHeldKeys = () => {
      heldCodesRef.current.forEach((code) => sendKey(code, true));
    };
    frame?.addEventListener("load", replayHeldKeys);
    return () => frame?.removeEventListener("load", replayHeldKeys);
  }, [frameRef, sendKey]);

  useEffect(() => {
    const releaseWhenHidden = () => {
      if (document.visibilityState !== "visible") releaseAll();
    };
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => {
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", releaseWhenHidden);
      pulseTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      heldCodesRef.current.forEach((code) => sendKey(code, false));
      heldCodesRef.current = new Set();
      joystickCodesRef.current = new Set();
    };
  }, [releaseAll, sendKey]);

  useEffect(() => {
    // Capture releases outside the control too, if pointer capture was lost.
    const releasePointer = (event) => {
      if (joystickPointerRef.current === event.pointerId) releaseJoystick();
    };
    // Touch events provide a fallback when the corresponding pointer release
    // is missing. Only reset when all fingers are up, preserving multitouch.
    const releaseWhenNoTouches = (event) => {
      if (event.touches.length === 0) releaseJoystick();
    };
    window.addEventListener("pointerup", releasePointer, true);
    window.addEventListener("pointercancel", releasePointer, true);
    window.addEventListener("touchend", releaseWhenNoTouches, true);
    window.addEventListener("touchcancel", releaseWhenNoTouches, true);
    window.addEventListener("pagehide", releaseAll);
    return () => {
      window.removeEventListener("pointerup", releasePointer, true);
      window.removeEventListener("pointercancel", releasePointer, true);
      window.removeEventListener("touchend", releaseWhenNoTouches, true);
      window.removeEventListener("touchcancel", releaseWhenNoTouches, true);
      window.removeEventListener("pagehide", releaseAll);
    };
  }, [releaseJoystick, releaseAll]);

  function updateJoystick(clientX, clientY) {
    const rect = joystickRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.34);
    const rawX = clientX - (rect.left + rect.width / 2);
    const rawY = clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > radius ? radius / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    const nextCodes = joystickCodesForVector(x, y, radius);
    joystickCodesRef.current.forEach((code) => {
      if (!nextCodes.has(code)) setCodePressed(code, false);
    });
    nextCodes.forEach((code) => {
      if (!joystickCodesRef.current.has(code)) setCodePressed(code, true);
    });
    joystickCodesRef.current = nextCodes;
    setJoystickPosition({ x, y });
  }

  function beginJoystick(event) {
    if (joystickPointerRef.current !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    joystickPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateJoystick(event.clientX, event.clientY);
  }

  function moveJoystick(event) {
    if (joystickPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    updateJoystick(event.clientX, event.clientY);
  }

  function endJoystick(event) {
    if (joystickPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    releaseJoystick();
  }

  function handleJoystickKey(event, pressed) {
    const codeByKey = {
      ArrowDown: "KeyS",
      ArrowLeft: "KeyA",
      ArrowRight: "KeyD",
      ArrowUp: "KeyW",
      a: "KeyA",
      d: "KeyD",
      s: "KeyS",
      w: "KeyW",
    };
    const code = codeByKey[event.key];
    if (!code || (pressed && event.repeat)) return;
    event.preventDefault();
    const nextJoystickCodes = new Set(joystickCodesRef.current);
    if (pressed) nextJoystickCodes.add(code);
    else nextJoystickCodes.delete(code);
    joystickCodesRef.current = nextJoystickCodes;
    setCodePressed(code, pressed);
  }

  function pulseCode(code) {
    setCodePressed(code, true);
    const timer = window.setTimeout(() => {
      pulseTimersRef.current.delete(timer);
      setCodePressed(code, false);
    }, 110);
    pulseTimersRef.current.add(timer);
  }

  const joystickDirection = directionLabel(joystickCodesRef.current);
  const buttonProps = (code) => ({
    code,
    pressed: heldCodes.has(code),
    onPress: () => setCodePressed(code, true),
    onRelease: () => setCodePressed(code, false),
  });

  return (
    <div
      id="touch-control-deck"
      className={`mobile-controls${preview ? " is-preview" : ""}`}
      hidden={!active}
      role="group"
      aria-label="Touch game controls"
      data-held-keys={[...heldCodes].sort().join(" ")}
      data-input-log={inputLog.join(" ")}
      data-last-input={lastInput}
      data-preview={preview ? "true" : "false"}
    >
      <p id="mobile-controls-help" className="visually-hidden">
        Drag the movement stick. Hold any labeled game button for continuous input.
      </p>

      <div className="mobile-shoulder-controls" role="group" aria-label="Shoulder and pause buttons">
        <MobileButton {...buttonProps("KeyI")} label="L" description="L shoulder" className="is-shoulder is-l" />
        <button
          className="mobile-start-button"
          type="button"
          aria-label="Start or pause"
          onClick={() => pulseCode("Space")}
        >
          Start
        </button>
        <MobileButton {...buttonProps("KeyO")} label="R" description="R shoulder" className="is-shoulder is-r" />
      </div>

      <button
        ref={joystickRef}
        className="mobile-joystick"
        type="button"
        aria-label={`Movement joystick, ${joystickDirection}`}
        aria-describedby="mobile-controls-help"
        data-direction={joystickDirection}
        onBlur={releaseJoystick}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => handleJoystickKey(event, true)}
        onKeyUp={(event) => handleJoystickKey(event, false)}
        onLostPointerCapture={endJoystick}
        onPointerCancel={endJoystick}
        onPointerDown={beginJoystick}
        onPointerMove={moveJoystick}
        onPointerUp={endJoystick}
      >
        <span className="mobile-joystick-ring" aria-hidden="true" />
        <span
          className="mobile-joystick-knob"
          aria-hidden="true"
          style={{ transform: `translate(${joystickPosition.x}px, ${joystickPosition.y}px)` }}
        />
        <span className="visually-hidden">Movement stick</span>
      </button>

      <div className="mobile-action-controls" role="group" aria-label="Action buttons">
        <MobileButton {...buttonProps("KeyU")} label="↑" description="Jump" caption="Jump" className="is-action is-jump" />
        <MobileButton {...buttonProps("KeyK")} label="B" description="B special" caption="Special" className="is-action is-b" />
        <MobileButton {...buttonProps("KeyJ")} label="A" description="A attack" caption="Attack" className="is-action is-a" />
        <MobileButton {...buttonProps("KeyL")} label="Z" description="Z shield" caption="Shield" className="is-z" />
      </div>
    </div>
  );
}
