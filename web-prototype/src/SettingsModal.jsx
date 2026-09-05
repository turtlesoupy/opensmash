import { useEffect, useRef, useState } from "react";
import AuthGate from "./AuthGate.jsx";
import ModalPage from "./ModalPage.jsx";
import RomHandoffModal from "./RomHandoffModal.jsx";
import RomHandoffReceiver from "./RomHandoffReceiver.jsx";
import { canTurnPortOff, choiceForEntry, portOptions } from "../shared/controller-ports.js";
import {
  BOOT_MODES,
  CHARACTER_MESHES,
  DEFAULT_ADVANCED_OPTIONS,
  FRAME_PACING,
  OPPONENT_LEVELS,
  RENDER_RESOLUTIONS,
  STAGES,
  SELECTION_MODES,
  controllerPlan,
  normalizeAdvancedOptions,
} from "./launch-options.js";

export default function SettingsModal({
  accountConnected = false,
  authorized,
  debugMode,
  gamepads = [],
  open,
  options,
  soundOn,
  crtOn = true,
  onAuthenticated,
  onCancel,
  onLogOut,
  onOptionsChange,
  onRestoreDefaults,
  onResetControllerTutorial,
  onResetRom,
  onReceiveRom,
  onSound,
  onCrt,
}) {
  const [draft, setDraft] = useState(options);
  const [page, setPage] = useState("main");
  const mainFirstRef = useRef(null);
  const gameplayFirstRef = useRef(null);
  const controllersFirstRef = useRef(null);
  const loginBackRef = useRef(null);
  const receiveFirstRef = useRef(null);
  const sendBackRef = useRef(null);
  const portPlan = controllerPlan(draft, gamepads);
  const humanPorts = portPlan.filter((entry) => entry?.kind === "keyboard" || entry?.kind === "gamepad").length;

  useEffect(() => {
    if (open) {
      setDraft(options);
      setPage("main");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      if (page === "gameplay") gameplayFirstRef.current?.focus();
      else if (page === "controllers") controllersFirstRef.current?.focus();
      else if (page === "login") loginBackRef.current?.focus();
      else if (page === "receive") receiveFirstRef.current?.focus();
      else if (page === "send") sendBackRef.current?.focus();
      else mainFirstRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, page]);

  function update(key, value) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onOptionsChange(next);
  }

  function updatePort(port, value) {
    if (value === "none" && !canTurnPortOff(portPlan, port)) return;
    const ports = [...(draft.ports ?? DEFAULT_ADVANCED_OPTIONS.ports)];
    ports[port] = value;
    const next = { ...draft, ports };
    setDraft(next);
    onOptionsChange(next);
  }

  function restoreDefaults() {
    const defaults = normalizeAdvancedOptions(DEFAULT_ADVANCED_OPTIONS);
    setDraft(defaults);
    onRestoreDefaults(defaults);
  }

  const title = page === "gameplay"
    ? "Gameplay Options"
    : page === "controllers" ? "Players & Controllers" : "Settings";
  const handoffPage = page === "receive" || page === "send";

  return (
    <ModalPage
      bodyClass="is-advanced-open"
      className="advanced-overlay"
      dismissOnBackdrop
      initialFocusRef={mainFirstRef}
      onRequestClose={onCancel}
      open={open}
      role="presentation"
    >
      {(close) => (
        <section
          className="modal-page-surface advanced-screen"
          role="dialog"
          aria-modal="true"
          aria-labelledby={page === "login"
            ? "auth-title"
            : page === "receive"
              ? "settings-receive-handoff-title"
              : page === "send" ? "handoff-title" : "settings-title"}
        >
          <header className="advanced-heading" hidden={page === "login" || handoffPage}>
            <h2 id="settings-title">{title}</h2>
            {page === "controllers" && (
              <p className="settings-subtitle">Connect a controller for multiplayer</p>
            )}
          </header>

          <div className="settings-menu" hidden={page !== "main"}>
            <button
              ref={mainFirstRef}
              className="launch-flow-action settings-menu-button settings-sound-button"
              type="button"
              aria-label={`Sound ${soundOn ? "on" : "off"}. Turn sound ${soundOn ? "off" : "on"}.`}
              aria-pressed={soundOn}
              data-ui-sound-toggle
              onClick={onSound}
            >
              <span>Sound: {soundOn ? "On" : "Off"}</span>
            </button>
            <button
              className="launch-flow-action settings-menu-button settings-sound-button"
              type="button"
              aria-label={`CRT effect ${crtOn ? "on" : "off"}. Turn CRT effect ${crtOn ? "off" : "on"}.`}
              aria-pressed={crtOn}
              onClick={onCrt}
            >
              <span>CRT Effect: {crtOn ? "On" : "Off"}</span>
            </button>
            <button className="launch-flow-action settings-menu-button" type="button" onClick={() => setPage("gameplay")}>
              <span>Gameplay Options</span>
            </button>
            <button className="launch-flow-action settings-menu-button" type="button" onClick={() => setPage("controllers")}>
              <span>Players &amp; Controllers</span>
            </button>
            {authorized ? (
              <button
                className="launch-flow-action settings-menu-button advanced-handoff-action"
                type="button"
                onClick={() => setPage("send")}
              >
                <span>Share ROM with another device</span>
              </button>
            ) : (
              <button
                className="launch-flow-action settings-menu-button advanced-handoff-action"
                type="button"
                onClick={() => setPage("receive")}
              >
                <span>Get ROM from another device</span>
              </button>
            )}
            {authorized && (
              <button
                className="launch-flow-action settings-menu-button reset-rom-button"
                type="button"
                onClick={() => close(onResetRom)}
              >
                <span>Clear ROM from this device</span>
              </button>
            )}
            <button
              className="launch-flow-action settings-menu-button"
              type="button"
              onClick={() => accountConnected ? close(onLogOut) : setPage("login")}
            >
              {accountConnected ? "Log Out" : "Log In"}
            </button>
            <button className="launch-flow-action settings-menu-button" type="button" onClick={() => close()}>
              Cancel
            </button>
          </div>

          <div className="settings-subpage settings-login-page" hidden={page !== "login"}>
            <AuthGate
              accountOnly
              cancelButtonRef={loginBackRef}
              cancelLabel="Back"
              onAuthenticated={(nextUser) => {
                onAuthenticated(nextUser);
                setPage("main");
              }}
              onCancel={() => setPage("main")}
            />
          </div>

          <div className="settings-subpage settings-handoff-page" hidden={page !== "receive"}>
            <RomHandoffReceiver
              active={page === "receive"}
              codeInputRef={receiveFirstRef}
              onBack={() => setPage("main")}
              onReceiveRom={onReceiveRom}
            />
          </div>

          <div className="settings-subpage settings-handoff-page" hidden={page !== "send"}>
            <RomHandoffModal
              backButtonRef={sendBackRef}
              embedded
              open={page === "send"}
              onClose={() => setPage("main")}
            />
          </div>

          <div className="advanced-form settings-subpage" hidden={page !== "gameplay"}>
            <div className="advanced-selects">
              <label className="advanced-field">
                <span className="advanced-field-label">Character Mesh</span>
                <span className="advanced-select-shell advanced-cell-frame flame-bridge-cell">
                  <select
                    ref={gameplayFirstRef}
                    value={draft.characterMesh}
                    onChange={(event) => update("characterMesh", event.target.value)}
                  >
                    {CHARACTER_MESHES.map((mesh) => (
                      <option value={mesh.value} key={mesh.value}>{mesh.label}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="advanced-field">
                <span className="advanced-field-label">Stage</span>
                <span className="advanced-select-shell advanced-cell-frame flame-bridge-cell">
                  <select value={draft.stage} onChange={(event) => update("stage", event.target.value)}>
                    {STAGES.map((stage) => (
                      <option value={stage.value} key={stage.value}>{stage.label}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="advanced-field">
                <span className="advanced-field-label">Opponent Difficulty</span>
                <span className="advanced-select-shell advanced-cell-frame flame-bridge-cell">
                  <select value={draft.opponentLevel} onChange={(event) => update("opponentLevel", event.target.value)}>
                    {OPPONENT_LEVELS.map((level) => (
                      <option value={level.value} key={level.value}>{level.label}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="advanced-field">
                <span className="advanced-field-label">Boot Destination</span>
                <span className="advanced-select-shell advanced-cell-frame flame-bridge-cell">
                  <select value={draft.bootMode} onChange={(event) => update("bootMode", event.target.value)}>
                    {BOOT_MODES.map((mode) => (
                      <option value={mode.value} key={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="advanced-field">
                <span className="advanced-field-label">Frame Pacing</span>
                <span className="advanced-select-shell advanced-cell-frame flame-bridge-cell">
                  <select value={draft.framePacing} onChange={(event) => update("framePacing", event.target.value)}>
                    {FRAME_PACING.map((mode) => (
                      <option value={mode.value} key={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="advanced-field">
                <span className="advanced-field-label">Render Resolution</span>
                <span className="advanced-select-shell advanced-cell-frame flame-bridge-cell">
                  <select value={draft.renderResolution} onChange={(event) => update("renderResolution", event.target.value)}>
                    {RENDER_RESOLUTIONS.map((size) => (
                      <option value={size.value} key={size.value}>{size.label}</option>
                    ))}
                  </select>
                </span>
              </label>
            </div>
            <div className="advanced-actions">
              <button className="launch-flow-action" type="button" onClick={restoreDefaults}>
                Restore Defaults
              </button>
              <button className="launch-flow-action settings-back-button" type="button" onClick={() => setPage("main")}>
                Back
              </button>
            </div>
          </div>

          <div className="advanced-form settings-subpage" hidden={page !== "controllers"}>
            <div className="advanced-selects settings-selection-mode">
              <label className="advanced-field">
                <span className="advanced-field-label">Selection Mode</span>
                <span className="advanced-select-shell advanced-cell-frame flame-bridge-cell">
                  <select ref={controllersFirstRef} value={draft.selectionMode} onChange={(event) => update("selectionMode", event.target.value)}>
                    {SELECTION_MODES.map((mode) => (
                      <option value={mode.value} key={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                </span>
                <small>Choose just the players, or players and CPU opponents, before Free-for-All matches.</small>
              </label>
            </div>
            <section className="advanced-input" aria-label="Player inputs">
              <div className="advanced-selects advanced-inputs">
                {portPlan.map((entry, port) => {
                  const choices = portOptions(portPlan, gamepads, port);
                  const current = choiceForEntry(entry);
                  return (
                    <label className="advanced-field" key={port}>
                      <span className="advanced-field-label">{`P${port + 1}`}</span>
                      <span className="advanced-select-shell advanced-cell-frame flame-bridge-cell">
                        <select
                          value={current}
                          onChange={(event) => updatePort(port, event.target.value)}
                        >
                          <option value={current === "auto" ? "auto" : "cpu"}>CPU</option>
                          <option value="none" disabled={!canTurnPortOff(portPlan, port)}>Off</option>
                          {choices.map((choice) => (
                            <option value={choice.value} key={choice.value}>{choice.label}</option>
                          ))}
                        </select>
                      </span>
                    </label>
                  );
                })}
              </div>
              <small className="advanced-controllers-note">Off removes a fighter from the match. At least two fighters must stay enabled. Connect a controller to fill an unassigned CPU slot.</small>
              {humanPorts >= 2 && (
                <small className="advanced-controllers-note">
                  Choose each player’s fighter on the roster before the match starts.
                </small>
              )}
            </section>

            {debugMode && (
              <section className="advanced-debug-tools" aria-labelledby="advanced-debug-title">
                <div>
                  <strong id="advanced-debug-title">Debug</strong>
                  <small>Restore first-run checks for this browser.</small>
                </div>
                <div className="advanced-debug-actions">
                  {authorized && (
                    <button className="launch-flow-action reset-rom-button" type="button" onClick={() => close(onResetRom)}>
                      Reset ROM
                    </button>
                  )}
                  <button
                    className="launch-flow-action reset-controller-button"
                    type="button"
                    onClick={() => close(onResetControllerTutorial)}
                  >
                    Reset Controller Tutorial
                  </button>
                </div>
              </section>
            )}

            <BackButton onClick={() => setPage("main")} />
          </div>
        </section>
      )}
    </ModalPage>
  );
}

function BackButton({ onClick }) {
  return (
    <div className="advanced-actions">
      <button className="launch-flow-action settings-back-button" type="button" onClick={onClick}>
        Back
      </button>
    </div>
  );
}
