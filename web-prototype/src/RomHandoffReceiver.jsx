import { useEffect, useRef, useState } from "react";
import FlameAction from "./FlameAction.jsx";
import {
  holdScreenAwake,
  isHandoffSupported,
  receiveRomHandoff,
} from "./rom-handoff-client.js";

const STATUS_COPY = {
  joining: "Finding the other device…",
  waiting: "Waiting for the other device…",
  connecting: "Connecting…",
  reading: "Reading ROM…",
  extracting: "Opening archive…",
  hashing: "Checking ROM…",
  validating: "Checking ROM…",
  storing: "Storing ROM…",
  done: "Game received and ready to play.",
};

export default function RomHandoffReceiver({ active, codeInputRef, onBack, onReceiveRom, game = 'ssb64' }) {
  const [state, setState] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const attemptRef = useRef(0);
  const sessionRef = useRef(null);
  const releaseWakeLockRef = useRef(null);
  const supported = isHandoffSupported();
  const busy = !["idle", "done", "error"].includes(state);

  function stopTransfer() {
    attemptRef.current += 1;
    sessionRef.current?.cancel();
    sessionRef.current = null;
    releaseWakeLockRef.current?.();
    releaseWakeLockRef.current = null;
  }

  useEffect(() => {
    if (!active) return undefined;
    setState("idle");
    setProgress(0);
    setError("");
    return stopTransfer;
  }, [active]);

  async function connect(event) {
    event.preventDefault();
    if (busy || !supported) return;

    stopTransfer();
    const attempt = attemptRef.current;
    setError("");
    setProgress(0);

    const session = receiveRomHandoff({
      game,
      code: codeInputRef.current?.value || "",
      onState(nextState, detail = {}) {
        if (attempt !== attemptRef.current) return;
        setState(nextState);
        if (nextState === "receiving" && detail.total) {
          setProgress(Math.round((detail.received / detail.total) * 100));
        }
      },
    });
    sessionRef.current = session;
    releaseWakeLockRef.current = holdScreenAwake();

    try {
      const file = await session.promise;
      if (attempt !== attemptRef.current) return;
      sessionRef.current = null;
      setState("validating");
      await onReceiveRom(file, (nextState) => {
        if (attempt === attemptRef.current) setState(nextState);
      });
      if (attempt !== attemptRef.current) return;
      setState("done");
    } catch (nextError) {
      if (attempt !== attemptRef.current || nextError?.name === "HandoffCancelled") return;
      sessionRef.current = null;
      setState("error");
      setError(nextError?.message || "Could not receive the ROM from the other device.");
      requestAnimationFrame(() => codeInputRef.current?.focus());
    } finally {
      await session.dispose?.();
      if (attempt === attemptRef.current) {
        releaseWakeLockRef.current?.();
        releaseWakeLockRef.current = null;
      }
    }
  }

  function updateCode(event) {
    const canonical = event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (canonical !== event.currentTarget.value) event.currentTarget.value = canonical;
  }

  const status = state === "receiving"
    ? `Receiving game file… ${progress}%`
    : STATUS_COPY[state] || (!["idle", "error"].includes(state) ? state : "");

  return (
    <div className="settings-handoff-content handoff-screen">
      <header className="advanced-heading">
        <h2 id="settings-receive-handoff-title">Get from another device</h2>
        <p>
          On the device that has the {game === "melee" ? "Melee disc" : "N64 ROM"}, open <strong>Settings &gt; Share with another device</strong>,
          then enter its code below.
        </p>
      </header>

      {supported ? (
        <form className="launch-flow-handoff-form settings-receive-handoff-form" onSubmit={connect}>
          <input
            ref={codeInputRef}
            className="launch-flow-handoff-input"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck="false"
            maxLength="8"
            placeholder="CODE"
            aria-label="Code from the other device"
            disabled={busy || state === "done"}
            onInput={updateCode}
          />
          <FlameAction type="submit" disabled={busy || state === "done"}>
            {busy ? "Connecting…" : state === "done" ? "Connected" : "Connect"}
          </FlameAction>
          {status && <p className="launch-flow-status" aria-live="polite">{status}</p>}
          {error && <p className="launch-flow-error" role="alert">{error}</p>}
        </form>
      ) : (
        <p className="launch-flow-error settings-handoff-unavailable" role="alert">
          This browser cannot connect directly to another device.
        </p>
      )}

      <div className="advanced-actions">
        <button
          className="launch-flow-action settings-back-button"
          type="button"
          onClick={() => {
            stopTransfer();
            onBack();
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}
