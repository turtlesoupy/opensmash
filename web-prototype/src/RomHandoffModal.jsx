import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import ModalPage from "./ModalPage.jsx";
import { loadStoredRom } from "../shared/rom-store.js";
import { holdScreenAwake, isHandoffSupported, startRomHandoffHost } from "./rom-handoff-client.js";

// Host side of the game file handoff: shows a QR code + short code, then streams
// this browser's stored ROM to the device that scans it. Only reachable from
// Settings in a browser that already validated a ROM. It can render either as
// a Settings subpage or in its original standalone ModalPage shell.

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function RomHandoffModal({ backButtonRef, embedded = false, open, onClose, loadRom = loadStoredRom, game = 'ssb64' }) {
  const [state, setState] = useState("idle");
  const [detail, setDetail] = useState({});
  const [qr, setQr] = useState("");
  const [attempt, setAttempt] = useState(0);
  const closeButtonRef = useRef(null);
  const runRef = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    if (!isHandoffSupported()) {
      setState("error");
      setDetail({ error: new Error("This browser cannot open a direct connection to another device.") });
      return undefined;
    }
    setState("creating");
    setDetail({});
    setQr("");
    const run = ++runRef.current;
    const session = startRomHandoffHost({
      loadRom,
      game,
      onState(next, info = {}) {
        if (run !== runRef.current) return;
        setState(next);
        setDetail(info);
        if (next === "waiting" && info.url) {
          QRCode.toDataURL(info.url, { margin: 1, width: 320, color: { dark: "#120b08", light: "#fff2d6" } })
            .then((image) => { if (run === runRef.current) setQr(image); })
            .catch(() => { if (run === runRef.current) setQr(""); });
        }
      },
    });
    session.promise.catch(() => {});
    const releaseWakeLock = holdScreenAwake();
    return () => {
      runRef.current += 1;
      session.cancel();
      releaseWakeLock();
    };
  }, [open, attempt]);

  const busy = state === "connecting" || state === "sending";
  const percent = detail.total ? Math.round(((detail.sent ?? 0) / detail.total) * 100) : 0;
  const subtitle = {
    creating: "Opening a private connection…",
    waiting: "Scan the code on the other device, or enter it under Settings → ROM Management → Get from another device.",
    connecting: "Other device found. Connecting…",
    sending: `Sending ${detail.total ? formatMiB(detail.total) : "the game file"}… ${percent}%`,
    done: "Done. The other device is checking the game file now.",
    error: "The handoff did not complete.",
    cancelled: "Handoff cancelled.",
  }[state] || "";

  function renderContent(close) {
    return (
      <section
        className={embedded
          ? "settings-handoff-content handoff-screen handoff-modal"
          : "modal-page-surface advanced-screen handoff-screen handoff-modal"}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : "true"}
        aria-labelledby="handoff-title"
        aria-describedby="handoff-copy"
      >
        <header className="advanced-heading">
          <h2 id="handoff-title">Share with another device</h2>
          <p id="handoff-copy">{subtitle}</p>
        </header>

        {state === "waiting" && (
          <div className="handoff-card">
            {qr
              ? <img className="handoff-qr" src={qr} alt={`QR code for ${detail.url}`} width="240" height="240" />
              : <div className="handoff-qr handoff-qr-placeholder" aria-hidden="true" />}
            <div className="handoff-card-copy">
              <span className="handoff-code-label">Code</span>
              <code className="handoff-code" aria-label={`Handoff code ${detail.code.split("").join(" ")}`}>{detail.code}</code>
              <a className="handoff-url" href={detail.url} target="_blank" rel="noreferrer">{detail.url}</a>
              <small className="handoff-note">
                Keep this window open and awake until it finishes. The game file travels directly between your devices;
                our servers only pass along the connection details. Both devices should be on the same Wi-Fi.
              </small>
            </div>
          </div>
        )}

        {state === "sending" && (
          <div className="handoff-card handoff-card-progress">
            <progress className="handoff-progress" max={detail.total} value={detail.sent} aria-label="Transfer progress" />
          </div>
        )}

        {state === "error" && (
          <div className="handoff-card handoff-card-error" role="alert">
            <p className="handoff-error">{detail.error?.message || "The handoff failed."}</p>
          </div>
        )}

        <div className="advanced-actions">
          {(state === "error" || state === "done") && (
            <button className="launch-flow-action" type="button" onClick={() => setAttempt((count) => count + 1)}>
              {state === "done" ? "Send to another device" : "Try again"}
            </button>
          )}
          <button
            ref={(node) => {
              closeButtonRef.current = node;
              if (backButtonRef) backButtonRef.current = node;
            }}
            className="launch-flow-action cancel-options-button"
            type="button"
            onClick={close}
          >
            {embedded ? "Back" : state === "done" ? "Close" : busy ? "Stop sending" : "Cancel"}
          </button>
        </div>
      </section>
    );
  }

  if (embedded) return open ? renderContent(onClose) : null;

  return (
    <ModalPage
      bodyClass="is-advanced-open"
      className="advanced-overlay handoff-overlay"
      dismissOnBackdrop={!busy}
      initialFocusRef={closeButtonRef}
      onRequestClose={onClose}
      open={open}
      role="presentation"
    >
      {(close) => renderContent(() => close())}
    </ModalPage>
  );
}
