import { useEffect, useMemo, useRef, useState } from "react";
import { padDisplayName } from "../shared/controller-ports.js";

const CONTROLS = Object.freeze([
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "z", label: "Z trigger" },
  { id: "start", label: "Start" },
  { id: "l", label: "L" },
  { id: "r", label: "R" },
  { id: "cup", label: "C-Up" },
  { id: "cdown", label: "C-Down" },
  { id: "cleft", label: "C-Left" },
  { id: "cright", label: "C-Right" },
  { id: "dup", label: "D-pad Up" },
  { id: "ddown", label: "D-pad Down" },
  { id: "dleft", label: "D-pad Left" },
  { id: "dright", label: "D-pad Right" },
]);
const AXIS_GLYPHS = Object.freeze({ dup: "↑", ddown: "↓", dleft: "←", dright: "→" });

function remapApi() {
  return window.openSmashControllerRemap;
}

function rawPad(pad) {
  const pads = remapApi()?.rawGamepads?.() || [];
  return pads.find((candidate) => candidate && candidate.index === pad.index && candidate.id === pad.id)
    || null;
}

function pressedButtons(pad) {
  const pressed = new Set();
  pad?.buttons?.forEach((button, index) => {
    if (button && (button.pressed || button.value > 0.5)) pressed.add(index);
  });
  return pressed;
}

function movedAxis(pad, baseline) {
  let best = null;
  pad?.axes?.forEach((rawValue, index) => {
    const value = Number(rawValue);
    const neutral = Number(baseline[index] ?? 0);
    const travel = Math.abs(value - neutral);
    if (Number.isFinite(value) && travel >= 0.25 && (!best || travel > best.travel)) {
      best = { index, value, neutral, travel };
    }
  });
  return best;
}

function axesAtRest(pad, baseline) {
  return !movedAxis(pad, baseline);
}

export default function ControllerMapper({ pad, onBack, onSaved }) {
  const api = remapApi();
  const initialProfile = useMemo(() => api?.getProfile?.(pad.id) || null, [api, pad.id]);
  const initialSource = useMemo(() => api?.profileSource?.(pad.id) || "default", [api, pad.id]);
  const [step, setStep] = useState(-1);
  const [mapping, setMapping] = useState(() => initialProfile?.mode === "custom"
    ? { ...initialProfile.buttons }
    : {});
  const [axisMapping, setAxisMapping] = useState(() => initialProfile?.mode === "custom"
    ? { ...initialProfile.axes }
    : {});
  const [hasProfile, setHasProfile] = useState(Boolean(initialProfile));
  const [message, setMessage] = useState(initialSource === "m64"
    ? "M64 detected — complete setup recommended"
    : initialProfile ? "Custom mapping active" : "Using browser defaults");
  const firstRef = useRef(null);
  const neutralAxesRef = useRef([]);
  const current = CONTROLS[step] || null;

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!current) return undefined;
    let frame = 0;
    let cancelled = false;
    const startingPad = rawPad(pad);
    const baselineAxes = neutralAxesRef.current.length > 0
      ? neutralAxesRef.current
      : Array.from(startingPad?.axes || [], (value) => Number(value) || 0);
    let armed = pressedButtons(startingPad).size === 0;
    let axisArmed = axesAtRest(startingPad, baselineAxes);

    function finishControl(nextMapping, nextAxisMapping) {
      setMapping(nextMapping);
      setAxisMapping(nextAxisMapping);
      if (step === CONTROLS.length - 1) {
        if (!api?.saveProfile?.(pad.id, { mode: "custom", buttons: nextMapping, axes: nextAxisMapping })) {
          setStep(-1);
          setMessage("Could not save mapping. Allow browser storage and try again.");
          return;
        }
        setHasProfile(true);
        setStep(-1);
        setMessage("Mapping saved and active");
        onSaved?.();
      } else {
        setStep((value) => value + 1);
      }
    }

    function poll() {
      if (cancelled) return;
      const connected = rawPad(pad);
      if (!connected) {
        armed = false;
        axisArmed = false;
        setMessage("Controller disconnected. Reconnect it to continue.");
        frame = window.requestAnimationFrame(poll);
        return;
      }
      const pressed = pressedButtons(connected);
      if (!armed) {
        armed = pressed.size === 0;
      } else if (pressed.size > 0) {
        const button = [...pressed][0];
        const nextMapping = { ...mapping, [current.id]: button };
        const nextAxisMapping = { ...axisMapping };
        delete nextAxisMapping[current.id];
        finishControl(nextMapping, nextAxisMapping);
        return;
      } else {
        if (!axisArmed) {
          axisArmed = axesAtRest(connected, baselineAxes);
        } else {
          const axis = movedAxis(connected, baselineAxes);
          if (!axis) {
            frame = window.requestAnimationFrame(poll);
            return;
          }
          const nextMapping = { ...mapping };
          delete nextMapping[current.id];
          const nextAxisMapping = {
            ...axisMapping,
            [current.id]: { index: axis.index, value: axis.value, neutral: axis.neutral },
          };
          finishControl(nextMapping, nextAxisMapping);
          return;
        }
      }
      frame = window.requestAnimationFrame(poll);
    }

    frame = window.requestAnimationFrame(poll);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [api, axisMapping, current, mapping, onSaved, pad, step]);

  function beginMapping() {
    neutralAxesRef.current = Array.from(rawPad(pad)?.axes || [], (value) => Number(value) || 0);
    setMapping({});
    setAxisMapping({});
    setMessage("Release the buttons, then press A");
    setStep(0);
  }

  function swapAB() {
    if (!api?.saveProfile?.(pad.id, { mode: "standard", buttons: { a: 1, b: 0 } })) {
      setMessage("Could not save mapping. Allow browser storage and try again.");
      return;
    }
    setHasProfile(true);
    setMapping({ a: 1, b: 0 });
    setAxisMapping({});
    setStep(-1);
    setMessage("Swapped A/B layout active — use browser defaults to undo");
    onSaved?.();
  }

  function resetMapping() {
    if (!api?.disableProfile?.(pad.id)) {
      setMessage("Could not reset mapping. Allow browser storage and try again.");
      return;
    }
    setHasProfile(false);
    setMapping({});
    setAxisMapping({});
    setStep(-1);
    setMessage("Using browser defaults");
    onSaved?.();
  }

  return (
    <div className="controller-mapper settings-subpage">
      <section className="controller-map-panel" aria-live="polite">
        <div className="controller-map-device">
          <span className="controller-map-port">Controller</span>
          <strong>{padDisplayName(pad.id)}</strong>
          <small>{message}</small>
        </div>

        {current ? (
          <div className="controller-map-capture">
            <span className="controller-map-progress">{step + 1} / {CONTROLS.length}</span>
            <strong>Press {current.label}</strong>
            <small>Release each button before pressing the next one.</small>
          </div>
        ) : (
          <div className="controller-map-actions">
            <button ref={firstRef} className="launch-flow-action" type="button" onClick={swapAB}>
              Use swapped A/B
            </button>
            <button className="launch-flow-action" type="button" onClick={beginMapping}>
              Map every button
            </button>
            {hasProfile && (
              <button className="launch-flow-action controller-map-reset" type="button" onClick={resetMapping}>
                Use browser defaults
              </button>
            )}
          </div>
        )}

        <div className="controller-map-ledger" aria-label="Mapped controls">
          {CONTROLS.map((control, index) => (
            <span
              className={step === index ? "is-current" : mapping[control.id] !== undefined || axisMapping[control.id] ? "is-mapped" : ""}
              key={control.id}
            >
              <b>{control.label}</b>
              <small>{mapping[control.id] !== undefined
                ? `Button ${mapping[control.id]}`
                : axisMapping[control.id]
                  ? `Axis ${axisMapping[control.id].index} ${AXIS_GLYPHS[control.id] || ""}`.trim()
                  : "—"}</small>
            </span>
          ))}
        </div>
      </section>

      <div className="advanced-actions controller-map-footer">
        {current && (
          <button className="launch-flow-action" type="button" onClick={() => { setStep(-1); setMessage("Mapping cancelled"); }}>
            Cancel mapping
          </button>
        )}
        <button className="launch-flow-action settings-back-button" type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
