import { useEffect, useLayoutEffect, useRef, useState } from "react";
import logoFallbackUrl from "../visual/assets/smash-the-weights-logo.png?url";
import FlameAction from "./FlameAction.jsx";
import MobileControls from "./MobileControls.jsx";
import ModalPage from "./ModalPage.jsx";
import {
  controlEmbeddedTrailer,
  disableEmbeddedTrailerCaptions,
  subscribeEmbeddedTrailer,
  TRAILER_EMBED_URL,
} from "./embedded-trailer.js";
import { DEMO_MUSIC_HOTKEY, DEMO_SCROLL_HOTKEY, DEMO_START_HOTKEY, DEMO_TRAILER_HOTKEY } from "./trailer-preset.js";
import { startHomeRuntime } from "./visual-runtime.js";

const MOBILE_CONTROLS_MEDIA = "(hover: none) and (pointer: coarse)";
const ROM_FILENAME = "Super Smash Bros. (USA).z64";
const COPY_TOAST_DURATION_MS = 2_000;

function mobileControlsRequested() {
  return new URLSearchParams(window.location.search).has("mobileControls");
}

function ControllerCallouts() {
  return (
    <div id="controller-callouts" className="controller-callouts" aria-label="Keyboard controls">
      <svg id="controller-callout-lines" className="controller-callout-lines" aria-hidden="true">
        {['stick', 'dpad', 'a', 'b', 'c-buttons', 'z', 'left-bumper', 'right-bumper'].map((control) => (
          <g data-control-line={control} key={control}><line /><circle r="3" /></g>
        ))}
      </svg>
      <div className="controller-callout" data-control-callout="stick" aria-label="W A S D: joystick">
        <span className="controller-key-cluster" aria-hidden="true">
          {['w', 'a', 's', 'd'].map((key) => (
            <kbd className="controller-keycap" data-control-key={key} key={key}>{key.toUpperCase()}</kbd>
          ))}
        </span>
        <span className="controller-key-alt" data-control-alt="stick" aria-hidden="true">or arrow keys</span>
      </div>
      {[
        ['dpad', [['dup', '↑'], ['dleft', '←'], ['ddown', '↓'], ['dright', '→']], 'D-pad'],
        ['c-buttons', [['cup', 'C↑'], ['cleft', 'C←'], ['cdown', 'C↓'], ['cright', 'C→']], 'C buttons'],
      ].map(([control, keys, label]) => (
        <div className="controller-callout controller-extra-callout" data-control-callout={control} aria-label={label} key={control}>
          <span className="controller-key-cluster controller-n64-cluster" aria-hidden="true">
            {keys.map(([key, text]) => (
              <kbd className="controller-keycap" data-control-key={key} key={key}>{text}</kbd>
            ))}
          </span>
        </div>
      ))}
      {[
        ['a', 'j', 'J or Ctrl: A button', 'or Ctrl'],
        ['b', 'k', 'K or Alt: B button', 'or Alt'],
        ['z', 'l', 'L or Shift: Z button', 'or Shift'],
        ['left-bumper', 'i', 'I: left bumper', ''],
        ['right-bumper', 'o', 'O: right bumper', ''],
      ].map(([control, key, label, alt]) => (
        <div className="controller-callout" data-control-callout={control} aria-label={label} key={control}>
          <kbd className="controller-keycap" data-control-key={key} aria-hidden="true">{key.toUpperCase()}</kbd>
          {alt && <span className="controller-key-alt" data-control-alt={key} aria-hidden="true">{alt}</span>}
        </div>
      ))}
    </div>
  );
}

export function LaunchFlow() {
  const [copyToastId, setCopyToastId] = useState(0);
  const copyToastTimerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(copyToastTimerRef.current), []);

  async function copyRomFilename() {
    try {
      await navigator.clipboard.writeText(ROM_FILENAME);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = ROM_FILENAME;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      const copied = document.execCommand("copy");
      fallback.remove();
      if (!copied) return;
    }

    window.clearTimeout(copyToastTimerRef.current);
    setCopyToastId((current) => current + 1);
    copyToastTimerRef.current = window.setTimeout(() => setCopyToastId(0), COPY_TOAST_DURATION_MS);
  }

  return (
    <div id="launch-flow-overlay" className="launch-flow-overlay" data-step="upload" data-mode="launch" hidden>
      <canvas id="launch-flow-canvas" className="launch-flow-canvas" aria-hidden="true" />
      <section className="launch-flow-step launch-flow-upload" role="dialog" aria-modal="true" aria-labelledby="launch-flow-title" aria-describedby="launch-flow-copy rom-filename-hint">
        <h2 id="launch-flow-title" className="visually-hidden">Play Smash.fun</h2>
        <p id="launch-flow-copy" className="launch-flow-copy">
          To play, choose your legally obtained USA-release Super Smash Bros. 64 ROM. It never leaves your device.
        </p>
        <div id="rom-filename-hint" className="launch-flow-rom-hint">
          <span className="launch-flow-rom-hint-label">The file is usually named</span>{" "}
          <button
            className="launch-flow-rom-copy"
            type="button"
            aria-label={`Copy ${ROM_FILENAME} to clipboard`}
            onClick={copyRomFilename}
          >
            <code>{ROM_FILENAME}</code>
          </button>
        </div>
        <input id="rom-file-input" className="launch-flow-file-input" type="file" hidden accept=".z64,.n64,.v64,.rom,.zip,application/octet-stream,application/zip" />
        <FlameAction id="rom-upload-button" type="button">Choose ROM</FlameAction>
        <button id="launch-cancel-button" className="launch-flow-action launch-flow-cancel" type="button">Cancel</button>
        <button
          id="rom-more-options-button"
          className="launch-flow-text-link"
          type="button"
          aria-controls="rom-handoff-page"
        >
          Get ROM from another device
        </button>
        <p id="rom-form-error" className="launch-flow-error" role="alert" hidden />
      </section>
      <section
        id="rom-handoff-page"
        className="launch-flow-step launch-flow-handoff-page"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rom-handoff-title"
        aria-describedby="rom-handoff-copy"
        tabIndex="-1"
      >
        <div className="launch-flow-handoff-content">
          <h2 id="rom-handoff-title" className="launch-flow-title">Get ROM from another device</h2>
          <p id="rom-handoff-copy" className="launch-flow-copy launch-flow-handoff-copy">
            Open Smash.fun from a device with the ROM uploaded and navigate to
            {" "}<strong>Settings &gt; Share ROM with another device</strong> and then enter the code below.
          </p>
          <form id="rom-handoff-panel" className="launch-flow-handoff-form">
            <input
              id="rom-handoff-code"
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
            />
            <FlameAction id="rom-handoff-connect" type="submit">Connect</FlameAction>
            <button id="rom-handoff-back" className="launch-flow-action launch-flow-cancel" type="button">Back</button>
            <p id="rom-handoff-status" className="launch-flow-status" aria-live="polite" hidden />
            <p id="rom-handoff-error" className="launch-flow-error" role="alert" hidden />
          </form>
          <p id="rom-handoff-unavailable" className="launch-flow-error" role="alert" hidden>
            This browser cannot connect directly to another device.
          </p>
        </div>
      </section>
      <section id="launch-flow-controller-step" className="launch-flow-step launch-flow-controller" role="dialog" aria-modal="true" aria-labelledby="how-to-play-title" aria-describedby="launch-control-prompt" tabIndex="-1">
        <div className="launch-flow-controller-instructions">
          <h2 id="how-to-play-title" className="launch-flow-title launch-flow-how-title">How to play</h2>
          <p id="launch-control-prompt" className="launch-flow-control-prompt" aria-live="polite">Press each key on your keyboard to continue</p>
        </div>
        <ControllerCallouts />
        <FlameAction cellClassName="launch-flow-controls-skip launch-flow-controls-bottom" className="launch-flow-skip" id="launch-control-skip" type="button" hidden>Skip</FlameAction>
        <FlameAction cellClassName="launch-flow-controls-close launch-flow-controls-bottom" id="controls-close-button" type="button">Close</FlameAction>
      </section>
      {copyToastId > 0 && (
        <p key={copyToastId} className="launch-flow-copy-toast" role="status" aria-live="polite">
          Copied to Clipboard
        </p>
      )}
    </div>
  );
}

function GodRay() {
  return (
    <svg id="hardware-god-ray" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id="god-ray-outer-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffde8" stopOpacity=".08" /><stop offset=".34" stopColor="#fff8d4" stopOpacity=".22" /><stop offset=".5" stopColor="#ffeab1" stopOpacity=".15" /><stop offset="1" stopColor="#e5bd76" stopOpacity="0" /></linearGradient>
        <linearGradient id="god-ray-middle-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffff3" stopOpacity=".12" /><stop offset=".34" stopColor="#fffde1" stopOpacity=".28" /><stop offset=".56" stopColor="#ffe6aa" stopOpacity=".13" /><stop offset="1" stopColor="#dba65b" stopOpacity="0" /></linearGradient>
        <linearGradient id="god-ray-core-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".12" /><stop offset=".3" stopColor="#fffef0" stopOpacity=".32" /><stop offset=".48" stopColor="#fff2c8" stopOpacity=".18" /><stop offset=".84" stopColor="#f2c980" stopOpacity="0" /></linearGradient>
        <radialGradient id="god-ray-halo-gradient"><stop offset="0" stopColor="#ffffff" stopOpacity=".38" /><stop offset=".28" stopColor="#fffbe2" stopOpacity=".22" /><stop offset="1" stopColor="#f3c97e" stopOpacity="0" /></radialGradient>
        <radialGradient id="god-ray-haze-gradient"><stop offset="0" stopColor="#fff5d1" stopOpacity=".17" /><stop offset=".44" stopColor="#f2d098" stopOpacity=".08" /><stop offset="1" stopColor="#c58d46" stopOpacity="0" /></radialGradient>
        <filter id="god-ray-blur-wide" x="-40%" y="-20%" width="180%" height="140%"><feGaussianBlur stdDeviation="28" /></filter>
        <filter id="god-ray-blur-medium" x="-30%" y="-16%" width="160%" height="132%"><feGaussianBlur stdDeviation="12" /></filter>
        <filter id="god-ray-blur-tight" x="-20%" y="-12%" width="140%" height="124%"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      <path id="god-ray-outer" className="god-ray-outer" />
      <path id="god-ray-middle" className="god-ray-middle" />
      <path id="god-ray-core" className="god-ray-core" />
      <ellipse id="god-ray-console-haze" className="god-ray-console-haze" />
      <ellipse id="god-ray-cartridge-halo" className="god-ray-cartridge-halo" />
    </svg>
  );
}

function RuntimeControls() {
  return (
    <>
      <aside id="hardware-inset" data-cartridge-state="free" aria-label="Television, interactive cartridge, and console">
        <div id="tv-control" aria-hidden="true" />
        <button id="cartridge-control" type="button" aria-label="Drag the cartridge into the console"><span className="visually-hidden">Drag the cartridge into the console</span></button>
        <div id="console-control" aria-hidden="true" />
      </aside>
      <details id="shader-tuner" hidden>
        <summary>Shader tuning</summary>
        <div className="shader-tuner-body"><button id="shader-reset" type="button">Reset defaults</button></div>
      </details>
      <details id="crt-tuner" hidden><summary>CRT viewport tuning</summary><div className="crt-tuner-body"><button type="button" data-crt-reset>Reset defaults</button></div></details>
      <canvas id="glove-canvas" />
      <canvas id="crt-viewport-canvas" aria-hidden="true" />
    </>
  );
}

export default function RetroHome({
  aboutOpen,
  advancedActive,
  authorized,
  developmentMode,
  engine,
  engineRef,
  gameFrameRef,
  gamepadCount = 0,
  immersive = false,
  isFullscreen,
  launchFlowOpen,
  onAboutChange,
  onAdvanced,
  onCreate,
  onFullscreen,
  onTrailerControl,
  demoMode = false,
  demoMusic = false,
  onDemoMusic,
  demoTrailer = false,
  demoCurtain = false,
  onDemoTrailer,
  onDemoStart,
  onDemoScroll,
  audioActive = false,
  trailerSoundOptIn = false,
  onTrailerSoundChange,
  onResetRom,
  onSignOut,
  pageError,
  ready,
  soundOn,
  trailerCinematic = false,
  trailerEngineReady = false,
  trailerEngineStarted = false,
  trailerMode = false,
  trailerRecording = false,
  user,
}) {
  const aboutCancelRef = useRef(null);
  const introVideoRef = useRef(null);
  const [trailerPlayerReady, setTrailerPlayerReady] = useState(false);
  // Last mute/pause state pushed to the YouTube player; reset per player load.
  const trailerCommandRef = useRef({ audible: null, paused: null, sentAt: 0 });
  const onTrailerSoundChangeRef = useRef(onTrailerSoundChange);
  useEffect(() => { onTrailerSoundChangeRef.current = onTrailerSoundChange; }, [onTrailerSoundChange]);
  const moreMenuRef = useRef(null);
  const gameSurfaceRef = useRef(null);
  const cinematicFirstRectRef = useRef(null);
  const cinematicAnimationRef = useRef(null);
  const [mobileLayout, setMobileLayout] = useState(() => (
    mobileControlsRequested() || window.matchMedia(MOBILE_CONTROLS_MEDIA).matches
  ));
  const mobileControlsVisible = mobileLayout && Boolean(engine);
  const hasResetRomAction = developmentMode && authorized;
  const keepSingleTouchActionVisible = mobileLayout && !hasResetRomAction;

  useEffect(() => {
    const showNativeCursor = new URLSearchParams(window.location.search).has("showCursor");
    const mobileControlsMedia = window.matchMedia(MOBILE_CONTROLS_MEDIA);
    const syncMobileControls = () => {
      const enabled = mobileControlsRequested() || mobileControlsMedia.matches;
      setMobileLayout(enabled);
      document.body.classList.toggle("uses-mobile-controls", enabled);
    };
    document.documentElement.classList.add("is-direct-site");
    document.body.classList.add("retro-home");
    document.body.classList.toggle("show-native-cursor", showNativeCursor);
    syncMobileControls();
    if (mobileControlsMedia.addEventListener) {
      mobileControlsMedia.addEventListener("change", syncMobileControls);
    } else {
      mobileControlsMedia.addListener?.(syncMobileControls);
    }
    return () => {
      document.documentElement.classList.remove("is-direct-site");
      document.body.classList.remove("retro-home", "show-native-cursor", "uses-mobile-controls");
      if (mobileControlsMedia.removeEventListener) {
        mobileControlsMedia.removeEventListener("change", syncMobileControls);
      } else {
        mobileControlsMedia.removeListener?.(syncMobileControls);
      }
    };
  }, []);

  useLayoutEffect(() => {
    document.body.classList.toggle("is-trailer-mode", trailerMode);
    document.body.classList.toggle("is-demo-mode", demoMode);
    document.body.classList.toggle("is-trailer-cinematic", (trailerMode || demoMode) && trailerCinematic);
    return () => {
      document.body.classList.remove("is-trailer-mode", "is-demo-mode", "is-trailer-cinematic");
    };
  }, [demoMode, trailerCinematic, trailerMode]);

  useLayoutEffect(() => {
    const first = cinematicFirstRectRef.current;
    const surface = gameSurfaceRef.current;
    cinematicFirstRectRef.current = null;
    if (!first || !surface) return undefined;

    const last = surface.getBoundingClientRect();
    const scaleX = last.width ? first.width / last.width : 1;
    const scaleY = last.height ? first.height / last.height : 1;
    cinematicAnimationRef.current?.cancel();
    const animation = surface.animate([
      {
        transformOrigin: "top left",
        transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${scaleX}, ${scaleY})`,
      },
      { transformOrigin: "top left", transform: "none" },
    ], {
      duration: 1050,
      easing: "cubic-bezier(.2,.82,.2,1)",
      fill: "both",
    });
    cinematicAnimationRef.current = animation;
    animation.finished.catch(() => {}).finally(() => {
      if (cinematicAnimationRef.current === animation) cinematicAnimationRef.current = null;
    });
    return () => animation.cancel();
  }, [trailerCinematic, immersive]);

  // Demo pseudo-fullscreen: record where the shell sits so the pinned box
  // (or its release) is a FLIP animation instead of a jump cut.
  function runFullscreenControl() {
    if (demoMode) {
      const surface = gameSurfaceRef.current;
      if (surface) cinematicFirstRectRef.current = surface.getBoundingClientRect();
      if (!immersive) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    onFullscreen?.();
  }

  function runTrailerControl() {
    const surface = gameSurfaceRef.current;
    if (surface) cinematicFirstRectRef.current = surface.getBoundingClientRect();
    if (trailerCinematic) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    onTrailerControl?.();
  }

  // Demo hotkey (T): from a running match, FLIP the shell to fullscreen with
  // the trailer restarted and audible on top; T again (or Esc) releases it.
  // The engine iframe is same-origin and owns keyboard focus during play, so
  // listen inside it as well as on the page.
  const demoHotkeyRef = useRef(null);
  const demoTrailerRef = useRef(false);
  demoTrailerRef.current = demoTrailer;
  const immersiveRef = useRef(false);
  immersiveRef.current = immersive;
  const fullscreenControlRef = useRef(null);
  fullscreenControlRef.current = runFullscreenControl;
  const demoStartRef = useRef(null);
  demoStartRef.current = onDemoStart;
  const demoScrollRef = useRef(null);
  demoScrollRef.current = onDemoScroll;
  demoHotkeyRef.current = () => {
    if (!demoMode || !onDemoTrailer) return;
    if (!engine && !demoTrailer) return;
    const surface = gameSurfaceRef.current;
    if (surface) cinematicFirstRectRef.current = surface.getBoundingClientRect();
    if (!demoTrailer) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      // Always restart from the top, even if the presenter paused or scrubbed
      // the player by hand while positioning it (the site's play/pause dedupe
      // would otherwise leave it paused at 0).
      controlEmbeddedTrailer(introVideoRef.current, "seekTo", [0, true]);
      controlEmbeddedTrailer(introVideoRef.current, "playVideo");
      trailerCommandRef.current.paused = false;
    }
    onDemoTrailer();
  };
  useEffect(() => {
    if (!demoMode) return undefined;
    const onKey = (event) => {
      const key = event.key?.toLowerCase();
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      // Keys the demo handles never reach the engine (Esc is its settings
      // menu, T is D-pad up): this runs in the capture phase on the frame's
      // own window, ahead of SDL's document listeners.
      const swallow = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      if (key === "escape") {
        // Esc releases whichever pinned view is up: the trailer, then the
        // pseudo-fullscreen match.
        if (demoTrailerRef.current) { swallow(); demoHotkeyRef.current?.(); }
        else if (immersiveRef.current) { swallow(); fullscreenControlRef.current?.(); }
        return;
      }
      const demoKeys = [DEMO_TRAILER_HOTKEY, DEMO_MUSIC_HOTKEY, DEMO_START_HOTKEY, DEMO_SCROLL_HOTKEY];
      if (!demoKeys.includes(key)) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
      swallow();
      if (key === DEMO_MUSIC_HOTKEY) onDemoMusic?.();
      else if (key === DEMO_START_HOTKEY) demoStartRef.current?.();
      else if (key === DEMO_SCROLL_HOTKEY) demoScrollRef.current?.();
      else demoHotkeyRef.current?.();
    };
    const frame = engineRef.current;
    // The iframe's inner Window is replaced on every navigation, so re-attach
    // on each load (addEventListener is idempotent per listener/window).
    const frameWindow = () => {
      try { return frame?.contentWindow?.document ? frame.contentWindow : null; } catch { return null; }
    };
    const attachFrame = () => frameWindow()?.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey, true);
    attachFrame();
    frame?.addEventListener("load", attachFrame);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      frameWindow()?.removeEventListener("keydown", onKey, true);
      frame?.removeEventListener("load", attachFrame);
    };
  }, [demoMode, engine, engineRef, onDemoMusic]);

  useEffect(() => {
    if (!ready) return;
    startHomeRuntime().catch((error) => window.openSmashReactBridge?.reportError?.(error));
  }, [ready]);

  useEffect(() => {
    document.body.classList.toggle("is-game-running", Boolean(engine));
    return () => document.body.classList.remove("is-game-running");
  }, [engine]);

  // The YouTube iframe ignores API commands until its player reports ready,
  // which happens after the iframe's own load event. Subscribe to its events
  // and only drive it once ready (re-sent on every reload of the iframe).
  useEffect(() => {
    const player = introVideoRef.current;
    if (!player) return undefined;
    const onMessage = (event) => {
      if (event.source !== player.contentWindow) return;
      let data;
      try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; }
      catch { return; }
      if (data?.event === "onReady") setTrailerPlayerReady(true);
      // The player's own speaker button is the other way to (un)mute. Mirror
      // it into site state so "Sound" and the trailer never disagree. Reports
      // that arrive right after one of our own mute/unMute commands are the
      // player echoing that command, not the viewer.
      if (data?.event === "infoDelivery" && typeof data.info?.muted === "boolean") {
        const expected = trailerCommandRef.current.audible;
        if (expected === null) return;
        if (performance.now() - trailerCommandRef.current.sentAt < 1500) return;
        const playerAudible = !data.info.muted;
        if (playerAudible !== expected) onTrailerSoundChangeRef.current?.(playerAudible);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Desired trailer state is a pure function of: player ready, game running,
  // launch overlay open, sound preference, and audioActive (page has had its
  // first user gesture and is in the foreground). Muted autoplay needs neither.
  useEffect(() => {
    const player = introVideoRef.current;
    if (!player || !trailerPlayerReady) return;
    // Demo music owns the audio bed while it plays; the trailer stays silent.
    const audible = demoTrailer
      || (soundOn && audioActive && trailerSoundOptIn && !(demoMode && demoMusic));
    const paused = Boolean(!demoTrailer && (launchFlowOpen || engine));
    // Only send commands for state that actually changed: a redundant
    // playVideo would restart a trailer the viewer paused by hand.
    // mute/unMute are idempotent, so they are re-sent on every state change:
    // the viewer may have flipped the player's own speaker button meanwhile.
    const previous = trailerCommandRef.current;
    controlEmbeddedTrailer(player, audible ? "unMute" : "mute");
    if (previous.paused !== paused) controlEmbeddedTrailer(player, paused ? "pauseVideo" : "playVideo");
    trailerCommandRef.current = { audible, paused, sentAt: performance.now() };
  }, [audioActive, demoMode, demoMusic, demoTrailer, engine, launchFlowOpen, soundOn, trailerPlayerReady, trailerSoundOptIn]);

  function closeMoreMenu() {
    moreMenuRef.current?.removeAttribute("open");
  }

  function openControlsFromMore() {
    closeMoreMenu();
    document.getElementById("controls-menu-button")?.click();
  }

  function openAdvancedFromMore() {
    closeMoreMenu();
    onAdvanced();
  }

  function resetRomFromMore() {
    closeMoreMenu();
    onResetRom();
  }

  return (
    <>
      {pageError && <p className="retro-page-error" role="alert">{pageError}</p>}
      <main className="arena-shell" aria-label="Smash.fun character grid">
        <header className="retro-site-header">
          <div id="hero-logo-stage" className="retro-site-logo" aria-label="Smash.fun">
            <img className="hero-logo-fallback" src={logoFallbackUrl} alt="Smash.fun" draggable="false" />
            <canvas id="hero-logo-canvas" className="hero-logo-canvas" aria-hidden="true" />
          </div>
          <nav
            className={`retro-site-nav ${keepSingleTouchActionVisible ? "has-single-collapsible-action" : ""}`}
            aria-label="Site information and settings"
          >
            {gamepadCount > 0 && (
              <button
                className="retro-site-link retro-site-pads"
                type="button"
                aria-haspopup="dialog"
                aria-label={`${gamepadCount} controller${gamepadCount === 1 ? "" : "s"} connected. Open controller settings.`}
                title={`${gamepadCount} controller${gamepadCount === 1 ? "" : "s"} connected`}
                onClick={onAdvanced}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7.5 6.5h9a4.5 4.5 0 0 1 4.5 4.5v2.2a4.3 4.3 0 0 1-7.6 2.8L12 14.6l-1.4 1.4A4.3 4.3 0 0 1 3 13.2V11a4.5 4.5 0 0 1 4.5-4.5z" />
                  <path d="M7.5 9.5v4M5.5 11.5h4" />
                  <path d="M16.2 10.6h.01M18.6 12.6h.01" />
                </svg>
                <span>{gamepadCount}</span>
              </button>
            )}
            <button
              className="retro-site-link"
              type="button"
              aria-haspopup="dialog"
              aria-controls="about-overlay"
              aria-expanded={aboutOpen}
              onClick={() => onAboutChange(true)}
            >
              About
            </button>
            {!mobileLayout && (
              <button
                id="controls-menu-button"
                className="retro-site-link"
                type="button"
                aria-haspopup="dialog"
                aria-controls="launch-flow-controller-step"
              >
                Controls
              </button>
            )}
            <button className={`retro-site-link retro-site-advanced-button ${advancedActive ? "is-active" : ""}`} type="button" aria-haspopup="dialog" onClick={onAdvanced}>Settings</button>
            <details className="retro-site-more" ref={moreMenuRef}>
              <summary className="retro-site-link">More</summary>
              <div className="retro-site-more-menu" role="menu">
                {!mobileLayout && (
                  <button className="retro-site-link" type="button" role="menuitem" onClick={openControlsFromMore}>Controls</button>
                )}
                <button className={`retro-site-link ${advancedActive ? "is-active" : ""}`} type="button" role="menuitem" onClick={openAdvancedFromMore}>Settings</button>
                {hasResetRomAction && (
                  <button className="retro-site-link retro-site-dev-link" type="button" role="menuitem" onClick={resetRomFromMore}>Reset ROM</button>
                )}
              </div>
            </details>
            {hasResetRomAction && (
              <button
                className="retro-site-link retro-site-dev-link"
                type="button"
                onClick={onResetRom}
                aria-label="Remove verified ROM and reset the game"
              >
                Reset ROM
              </button>
            )}
            <div className="retro-social-links">
              <a
                className="retro-site-link retro-social-link retro-github-link"
                href="https://github.com/turtlesoupy/opensmash"
                target="_blank"
                rel="noreferrer"
                aria-label="View the source on GitHub"
                title="GitHub"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 .7a11.6 11.6 0 0 0-3.7 22.6c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.7 5 16.7 5.3 16.7 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.6 11.6 0 0 0 12 .7Z" />
                </svg>
                <span>Github</span>
              </a>
              <a
                className="retro-site-link retro-social-link retro-discord-link"
                href="https://discord.gg/qYBbGmwBhr"
                target="_blank"
                rel="noreferrer"
                aria-label="Join the Smash.fun community on Discord"
                title="Discord"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.6 5.3A18 18 0 0 0 15.3 4l-.5 1a14.7 14.7 0 0 0-5.6 0l-.5-1a18 18 0 0 0-4.3 1.3C1.7 9.4 1 13.4 1.4 17.4a17.3 17.3 0 0 0 5.3 2.7l1.3-1.8a10.8 10.8 0 0 1-2-1l.5-.4a12.6 12.6 0 0 0 11 0l.5.4a11 11 0 0 1-2 1l1.3 1.8a17.3 17.3 0 0 0 5.3-2.7c.5-4.6-.8-8.5-3-12.1ZM8.5 15.2c-1.3 0-2.3-1.2-2.3-2.7s1-2.7 2.3-2.7 2.3 1.2 2.3 2.7-1 2.7-2.3 2.7Zm7 0c-1.3 0-2.3-1.2-2.3-2.7s1-2.7 2.3-2.7 2.3 1.2 2.3 2.7-1 2.7-2.3 2.7Z" />
                </svg>
                <span>Discord</span>
              </a>
            </div>
          </nav>
        </header>
        <section className="intro-video-stage" aria-label="Intro video">
          <div
            ref={gameSurfaceRef}
            className={`game-surface-shell ${mobileControlsVisible ? "has-mobile-control-deck" : ""} ${immersive ? "is-immersive" : ""} ${trailerCinematic ? "is-cinematic" : ""} ${demoTrailer ? "is-demo-trailer" : ""}`}
          >
            <div
              className={`intro-video-frame ${engine ? "is-game-running" : ""}`}
              ref={gameFrameRef}
            >
              <iframe
                ref={introVideoRef}
                id="intro-video"
                className="intro-video"
                src={TRAILER_EMBED_URL}
                title="smash.fun Introduction"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                onLoad={(event) => {
                  setTrailerPlayerReady(false);
                  trailerCommandRef.current = { audible: null, paused: null, sentAt: 0 };
                  disableEmbeddedTrailerCaptions(event.currentTarget);
                  subscribeEmbeddedTrailer(event.currentTarget);
                }}
              />
              <img className="intro-video-rule-layer" alt="" aria-hidden="true" />
              <iframe ref={engineRef} id="intro-game-frame" className="intro-game-frame" src={engine?.src || "about:blank"} title={engine ? "Smash.fun game engine" : "Smash.fun game"} allow="autoplay; gamepad; fullscreen" />
              {engine && <button
                className="game-fullscreen-control"
                type="button"
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                onClick={runFullscreenControl}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {isFullscreen ? (
                    <>
                      <path d="m4 4 6 6m0-5v5H5" />
                      <path d="m20 20-6-6m0 5v-5h5" />
                    </>
                  ) : (
                    <>
                      <path d="M10 10 4 4m0 6V4h6" />
                      <path d="m14 14 6 6m0-6v6h-6" />
                    </>
                  )}
                </svg>
              </button>}
            </div>
            {demoMode && (
              <div className={`demo-trailer-curtain ${demoCurtain ? "is-active" : ""}`} aria-hidden="true">
                <span className="demo-trailer-curtain-label">Loading trailer…</span>
              </div>
            )}
            {trailerMode && trailerCinematic && (
              <button
                className={`trailer-cinematic-control ${trailerEngineStarted && !trailerRecording ? "is-reveal" : ""}`}
                type="button"
                disabled={!trailerEngineReady}
                onClick={runTrailerControl}
              >
                {!trailerEngineReady
                  ? "Loading intro…"
                  : trailerEngineStarted
                    ? trailerRecording ? "Stop capture" : "Reveal website"
                    : "Start capture"}
              </button>
            )}
            <MobileControls
              active={mobileControlsVisible}
              frameRef={engineRef}
            />
          </div>
        </section>
        <div className="arena-surface"><div id="replica-grid" className="replica-grid" role="grid" aria-label="Search, create, and character roster" />{!ready && <p className="retro-roster-loading">Loading fighters…</p>}<p id="fighter-empty-state" className="fighter-empty-state" role="status" aria-live="polite" hidden /><p id="fighter-pick-prompt" className="fighter-pick-prompt" role="status" aria-live="polite" hidden /></div>
        <span id="replica-metrics" hidden>Building 200-cell grid…</span>
      </main>

      <ModalPage
        id="about-overlay"
        className="about-overlay"
        bodyClass="is-about-open"
        initialFocusRef={aboutCancelRef}
        onRequestClose={() => onAboutChange(false)}
        open={aboutOpen}
        role="presentation"
      >
        {(close) => (
          <section
            className="modal-page-surface about-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            aria-describedby="about-copy"
          >
            <div className="about-content">
              <h2 id="about-title" className="launch-flow-title about-title">About</h2>
              <div id="about-copy" className="about-copy">
                <p className="launch-flow-copy">
                  Smash.fun is a fan-made browser port of Super Smash Bros. for the Nintendo 64 which allows you to
                  create custom fighters and play them inside the original game.
                </p>
                <p className="launch-flow-copy">You must supply a legally obtained copy of the game ROM to play.</p>
                <p className="launch-flow-copy">Your ROM and its assets stay on your device. Nothing is uploaded.</p>
                <p className="launch-flow-copy">
                  The source is open at{" "}
                  <a className="about-link" href="https://github.com/turtlesoupy/opensmash" target="_blank" rel="noreferrer">
                    github.com/turtlesoupy/opensmash
                  </a>.
                </p>
                <p className="launch-flow-copy about-legal">
                  Smash.fun is not affiliated with, endorsed by, or sponsored by Nintendo. Super Smash Bros., Nintendo
                  64, and all related characters, names, and marks are trademarks of Nintendo and their respective
                  owners.
                </p>
              </div>
              <button
                ref={aboutCancelRef}
                className="launch-flow-action launch-flow-cancel about-cancel"
                type="button"
                onClick={() => close()}
              >
                Cancel
              </button>
            </div>
          </section>
        )}
      </ModalPage>

      <LaunchFlow />
      <GodRay />
      <RuntimeControls />
    </>
  );
}
