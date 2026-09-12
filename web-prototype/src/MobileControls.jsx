import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchGameKey, dispatchGameStick, joystickAxesForVector, joystickCodesForVector } from "../shared/mobile-input.js";

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
  const joystickKnobRef = useRef(null);
  const joystickRectRef = useRef(null);
  const joystickAnimationRef = useRef(null);
  const joystickPositionRef = useRef({ x: 0, y: 0 });
  const joystickAxesRef = useRef({ x: 0, y: 0 });
  const pulseTimersRef = useRef(new Set());
  const [heldCodes, setHeldCodes] = useState(() => new Set());
  const [inputLog, setInputLog] = useState([]);
  const [lastInput, setLastInput] = useState("none");

  // Pointer input is immediate; its decoration only needs one update per
  // display frame. Do not rerender the control deck for every drag coordinate.
  const setJoystickPosition = useCallback((position) => {
    joystickPositionRef.current = position;
    if (joystickAnimationRef.current !== null) return;
    joystickAnimationRef.current = window.requestAnimationFrame(() => {
      joystickAnimationRef.current = null;
      const { x, y } = joystickPositionRef.current;
      if (joystickKnobRef.current) {
        joystickKnobRef.current.style.transform = `translate(${x}px, ${y}px)`;
      }
    });
  }, []);

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
    joystickRectRef.current = null;
    joystickAxesRef.current = { x: 0, y: 0 };
    joystickCodesRef.current.forEach((code) => setCodePressed(code, false));
    joystickCodesRef.current = new Set();
    dispatchGameStick(frameRef.current, null);
    setJoystickPosition({ x: 0, y: 0 });
  }, [frameRef, setCodePressed, setJoystickPosition]);

  const releaseAll = useCallback(() => {
    joystickPointerRef.current = null;
    joystickRectRef.current = null;
    joystickAxesRef.current = { x: 0, y: 0 };
    heldCodesRef.current.forEach((code) => sendKey(code, false));
    heldCodesRef.current = new Set();
    joystickCodesRef.current = new Set();
    setHeldCodes(new Set());
    setJoystickPosition({ x: 0, y: 0 });
    setLastInput("released");
    dispatchGameStick(frameRef.current, null);
  }, [frameRef, sendKey, setJoystickPosition]);

  useEffect(() => {
    const invalidateRect = () => { joystickRectRef.current = null; };
    window.addEventListener("resize", invalidateRect);
    window.addEventListener("scroll", invalidateRect, { passive: true });
    return () => {
      window.removeEventListener("resize", invalidateRect);
      window.removeEventListener("scroll", invalidateRect);
      window.cancelAnimationFrame(joystickAnimationRef.current);
    };
  }, []);

  useEffect(() => {
    if (!active) releaseAll();
  }, [active, releaseAll]);

  useEffect(() => {
    const frame = frameRef.current;
    const replayHeldKeys = () => {
      if (joystickPointerRef.current !== null) dispatchGameStick(frameRef.current, joystickAxesRef.current);
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
      dispatchGameStick(frameRef.current, null);
    };
  }, [frameRef, releaseAll, sendKey]);

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
    const rect = joystickRectRef.current ?? joystickRef.current?.getBoundingClientRect();
    if (!rect) return;
    joystickRectRef.current = rect;
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.34);
    const rawX = clientX - (rect.left + rect.width / 2);
    const rawY = clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > radius ? radius / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    joystickAxesRef.current = joystickAxesForVector(x, y, radius);
    dispatchGameStick(frameRef.current, joystickAxesRef.current);
    // Keep key transitions for accessibility state and older engine shells.
    // The current shell uses the analog override for axes, plus these keys
    // for buttons; it never adds the digital directions to the analog values.
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
    joystickRectRef.current = null;
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
          ref={joystickKnobRef}
          className="mobile-joystick-knob"
          aria-hidden="true"
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
