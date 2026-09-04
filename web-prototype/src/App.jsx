import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import flowMusicUrl from "../visual/assets/skyward-save.mp3?url";
import viewportLogoUrl from "../visual/assets/branding/super-weights-bros-stacked-white.png?url";
import AuthGate from "./AuthGate.jsx";
import CreateVisualShell from "./CreateVisualShell.jsx";
import CreationPaused from "./CreationPaused.jsx";
import FighterCreator from "./FighterCreator.jsx";
import FighterJobModal from "./FighterJobModal.jsx";
import ModalPage from "./ModalPage.jsx";
import RetroHome from "./RetroHome.jsx";
import SettingsModal from "./SettingsModal.jsx";
import { matchesCharacterSearch } from "../shared/character-search.js";
import { mergeCharactersBySlug } from "../shared/character-roster.js";
import {
  formatFighterJobError,
  reconcileVisibleFighterJobs,
} from "../shared/fighter-job-ui.js";
import {
  controlsRoadblockRequired,
  requireControlsRoadblock,
} from "../visual/controls-roadblock.js";
import { identifyRomFile } from "./rom-validation.js";
import { handoffCodeFromLocation } from "../shared/rom-handoff.js";
import { clearRomStore, hasStoredRom, prewarmEngineArchive, storeRom } from "../shared/rom-store.js";
import { lockPageScroll } from "../shared/page-scroll-lock.js";
import { clearControllerTutorialCompletion, readControllerTutorialCompletion } from "../visual/control-tutorial.js";
import { useGamepads } from "./gamepads.js";
import {
  FLOW_MUSIC_MAX_VOLUME,
  transitionMediaVolume,
} from "./audio-envelope.js";
import { useUiSounds } from "./ui-sounds.js";
import {
  DEFAULT_ADVANCED_OPTIONS,
  controllerPlan,
  engineUrl,
  hasAdvancedOverrides,
  normalizeAdvancedOptions,
  selectDirectBattleOpponents,
  createFullBootIntroConfig,
} from "./launch-options.js";
import {
  DEMO_CPU_LEVEL,
  DEMO_STAGE,
  TRAILER_CPU_LEVEL,
  TRAILER_STAGE,
  createDemoMatchAction,
  demoGridOrder,
  DEMO_MUSIC_ON_SCROLL,
  DEMO_PIN_ON_PLAY,
  demoStageFor,
  DEMO_PRESENTER,
  DEMO_SCROLL_DURATION_MS,
  DEMO_SCROLL_TARGET,
  createTrailerIntroAction,
  createTrailerMatchAction,
} from "./trailer-preset.js";
import { readCrtEnabled, writeCrtEnabled } from "./crt-preference.js";

const ADVANCED_OPTIONS_KEY = "opensmash-advanced-options";
// Posted by BattleShip/web/index.html when the engine cannot obtain its assets.
const ENGINE_ASSET_ERROR_MESSAGE = "opensmash:engine-asset-error";
const ENGINE_TRAILER_CAPTURE_SAVED_MESSAGE = "opensmash:trailer-capture-saved";
const ENGINE_TRAILER_READY_MESSAGE = "opensmash:trailer-ready";
const ENGINE_TRAILER_REVEAL_MESSAGE = "opensmash:trailer-reveal";

function inlineCharacters() {
  const characters = window.__OPENSMASH_INITIAL_STATE__?.characters;
  return Array.isArray(characters) ? characters : null;
}

const INLINE_CHARACTERS = inlineCharacters();

// Fire-and-forget: build the engine's asset archive while the launch flow
// animates, so the engine boots straight from the cache. Failures are
// reported through `onError` (they would otherwise only surface later, as
// small status text inside the engine iframe).
function prewarmArchiveInBackground(onError) {
  prewarmEngineArchive().then(
    (result) => { if (result) console.info("[rom] engine archive", result.source, result.ms ? `${Math.round(result.ms)}ms` : ""); },
    (error) => {
      console.warn("[rom] engine archive prewarm failed:", error);
      onError?.(error);
    },
  );
}
const ACTIVE_FIGHTER_JOB_STATUSES = new Set(["queued", "running", "retrying"]);
const TOAST_DURATION_MS = 5_000;
const FLOW_MUSIC_EVENT = "opensmash:launch-flow";
const FLOW_MUSIC_URL = flowMusicUrl;

function useFlowMusic(flowActive, soundOn) {
  const flowMusicRef = useRef(null);

  useEffect(() => {
    const flowMusic = new Audio(FLOW_MUSIC_URL);
    flowMusic.id = "launch-flow-music";
    flowMusic.hidden = true;
    flowMusic.loop = true;
    flowMusic.preload = "auto";
    flowMusic.volume = 0;
    flowMusic.dataset.mixVolume = "0.0000";
    document.body.append(flowMusic);
    flowMusicRef.current = flowMusic;

    return () => {
      flowMusic.pause();
      flowMusic.removeAttribute("src");
      flowMusic.load();
      flowMusic.remove();
      flowMusicRef.current = null;
    };
  }, []);

  useEffect(() => {
    const flowMusic = flowMusicRef.current;
    if (!flowMusic) return undefined;

    let cancelTransition = () => {};
    let retryPlayback = null;
    let cancelled = false;
    flowMusic.muted = !soundOn;

    if (flowActive) {
      const play = () => {
        if (cancelled) return;
        flowMusic.play()
          .then(() => {
            if (!cancelled) {
              cancelTransition = transitionMediaVolume(flowMusic, FLOW_MUSIC_MAX_VOLUME);
            }
          })
          .catch(() => {
            if (cancelled) return;
            // Browsers can block audible autoplay until the first interaction.
            // Retry from that interaction so the user's saved sound preference
            // still takes effect without requiring a second click.
            retryPlayback = play;
            document.addEventListener("pointerdown", retryPlayback, { once: true, capture: true });
            document.addEventListener("keydown", retryPlayback, { once: true, capture: true });
          });
      };
      play();
    } else if (!flowMusic.paused && flowMusic.volume > 0) {
      // Pause in place so the next overlay resumes where the music left off.
      cancelTransition = transitionMediaVolume(flowMusic, 0, {
        onComplete() {
          flowMusic.pause();
        },
      });
    } else {
      flowMusic.pause();
      flowMusic.volume = 0;
    }

    return () => {
      cancelled = true;
      cancelTransition();
      if (retryPlayback) {
        document.removeEventListener("pointerdown", retryPlayback, { capture: true });
        document.removeEventListener("keydown", retryPlayback, { capture: true });
      }
    };
  }, [flowActive, soundOn]);

  return useCallback(() => {
    const flowMusic = flowMusicRef.current;
    if (!flowMusic) return;
    flowMusic.muted = !soundOn;
    if (flowMusic.paused) flowMusic.volume = 0;
    flowMusic.play().catch(() => {});
  }, [soundOn]);
}

function loadAdvancedOptions() {
  try {
    return normalizeAdvancedOptions(JSON.parse(sessionStorage.getItem(ADVANCED_OPTIONS_KEY)));
  } catch {
    return { ...DEFAULT_ADVANCED_OPTIONS };
  }
}

async function getSession() {
  const response = await fetch("/api/session", { cache: "no-store" });
  if (!response.ok) return { authorized: false, authenticated: false, user: null };
  const session = await response.json();
  // The engine builds its assets from the ROM stored in this browser, so a
  // valid ROM cookie alone does not make the session playable. Re-prompt for
  // the ROM when the stored bytes are gone (cleared site data, private window).
  if (session.authorized && !(await hasStoredRom())) {
    return { ...session, authorized: false, romMissing: true };
  }
  return session;
}

function RomModal({ action, onCancel, onValidated, onPrewarmError }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => lockPageScroll(), []);

  useEffect(() => {
    inputRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && status === "idle") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, status]);

  async function validate(event) {
    event.preventDefault();
    if (!file) return;
    setError("");
    try {
      const rom = await identifyRomFile(file, { onStatus: setStatus });

      setStatus("validating");
      const response = await fetch("/api/validate-rom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ algorithm: "SHA-1", hash: rom.sha1, size: rom.size }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "ROM validation failed");
      // The engine builds its assets from these bytes inside the browser.
      setStatus("storing");
      await storeRom(rom);
      prewarmArchiveInBackground(onPrewarmError);
      onValidated(result.rom);
    } catch (validationError) {
      setStatus("idle");
      setError(validationError.message || "Could not validate that file");
    }
  }

  const target =
    action?.type === "character"
      ? action.character.name
      : action?.type === "start"
        ? "the full game"
        : action?.type === "create"
          ? "the fighter lab"
          : "character select";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rom-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onCancel} aria-label="Close">
          ×
        </button>
        <p className="eyebrow">One-time check</p>
        <h2 id="rom-title">Choose your ROM to continue</h2>
        <p className="modal-copy">Choose your legally obtained Smash 64 ROM (USA release) to launch {target}.</p>
        <p className="modal-copy modal-copy-secondary">It never leaves your device.</p>
        <form onSubmit={validate}>
          <label className={`file-picker ${file ? "has-file" : ""}`}>
            <input
              ref={inputRef}
              type="file"
              accept=".z64,.n64,.v64,.rom,.zip,application/octet-stream,application/zip"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setError("");
              }}
              disabled={status !== "idle"}
            />
            <span>{file ? file.name : "Choose ROM file"}</span>
            <small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ".zip, .z64, .n64, .v64, or .rom"}</small>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="validate-button" type="submit" disabled={!file || status !== "idle"}>
            {status === "reading" && "Reading ROM…"}
            {status === "extracting" && "Opening archive…"}
            {status === "hashing" && "Checking ROM…"}
            {status === "validating" && "Checking ROM…"}
            {status === "storing" && "Storing ROM in this browser…"}
            {status === "idle" && (action?.type === "create" ? "Validate & create" : "Validate & play")}
          </button>
        </form>
      </section>
    </div>
  );
}

function CreateExperienceOverlay({ onAuthenticated, onClose, onCreated, onPlay, stage, turnstileSiteKey, user }) {
  const surfaceRef = useRef(null);
  const open = stage === "auth" || stage === "creator";

  return (
    <ModalPage
      bodyClass="is-create-experience-open"
      className="create-experience-backdrop"
      initialFocusRef={surfaceRef}
      onRequestClose={onClose}
      open={open}
      role="presentation"
    >
      {(close) => (
        <section
          ref={surfaceRef}
          className="modal-page-surface create-experience create-page"
          aria-label="Create a fighter"
          aria-modal="true"
          role="dialog"
          tabIndex="-1"
        >
          {stage === "auth" && <AuthGate onAuthenticated={onAuthenticated} onCancel={() => close()} />}
          {stage === "creator" && user && (
            <FighterCreator
              turnstileSiteKey={turnstileSiteKey}
              onCancel={() => close()}
              onCreated={(job) => close(() => onCreated(job))}
              onPlay={onPlay}
            />
          )}
        </section>
      )}
    </ModalPage>
  );
}

export default function App() {
  const isCreatePage = window.location.pathname.replace(/\/+$/, "") === "/create";
  const [trailerMode] = useState(() => (
    !isCreatePage && new URLSearchParams(window.location.search).get("trailer") === "1"
  ));
  // `?demo=1`: fixed funny opponents on every pick, T hands off to the trailer.
  const [demoMode] = useState(() => {
    const demo = !isCreatePage && new URLSearchParams(window.location.search).get("demo") === "1";
    // The CRT overlay is a lazy module and the demo/trailer flags leave the
    // URL on load, so hand it a global: demos and trailer captures run with
    // the filter off (projectors and screen recordings lose the picture
    // under the scanlines).
    if (demo || trailerMode) {
      window.__opensmashDemo = true;
      // The query is stripped before the CRT module loads: keep `?crt=` too.
      window.__opensmashCrt = new URLSearchParams(window.location.search).get("crt");
    }
    return demo;
  });
  const [demoTrailer, setDemoTrailer] = useState(false);
  // "Loading trailer" curtain between the live match and the video (demo T).
  const [demoCurtain, setDemoCurtain] = useState(false);
  // Demo background music (M toggles); always stops when a match starts.
  const [demoMusic, setDemoMusic] = useState(false);
  const [trailerRecording] = useState(() => (
    new URLSearchParams(window.location.search).get("record") === "1"
  ));
  const [characters, setCharacters] = useState(() => INLINE_CHARACTERS || []);
  const [fighterJobs, setFighterJobs] = useState([]);
  const [loadingCharacters, setLoadingCharacters] = useState(() => INLINE_CHARACTERS === null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [user, setUser] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [engine, setEngine] = useState(null);
  const [pageErrorToast, setPageErrorToast] = useState(null);
  const [fighterSearch, setFighterSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  // CSS-only fullscreen for browsers without an element Fullscreen API (iPhone Safari).
  const [immersive, setImmersive] = useState(false);
  const [trailerCinematic, setTrailerCinematic] = useState(trailerMode);
  const [trailerEngineReady, setTrailerEngineReady] = useState(false);
  const [trailerEngineStarted, setTrailerEngineStarted] = useState(false);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("opensmash-sound") !== "off");
  // Browsers only allow audible playback after a user gesture. Track the very
  // first one at the document level (capture phase, so nothing can swallow it)
  // and fan it out to every audio source: trailer iframe, flow music, engine
  // AudioContext. The sound preference stays the single override.
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  // The home-page trailer only goes audible after the viewer explicitly turns
  // sound on through the site's own toggle (or unmutes the player itself). A
  // random first click/keypress used to unmute it, which felt like the page
  // deciding to blast audio on its own.
  const [trailerSoundOptIn, setTrailerSoundOptIn] = useState(false);
  const firstGestureTargetRef = useRef(null);
  // Audio is only ever audible while the page is in the foreground. A hidden
  // tab / backgrounded iPhone throttles the engine's setTimeout pacer to ~1fps,
  // which starves the SDL audio queue and produces garbage, and looping music
  // playing under another app is just annoying. Everything audible keys off
  // audioActive = unlocked && visible; soundOn stays the user override.
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");
  const audioActive = audioUnlocked && pageVisible;
  const [crtOn, setCrtOn] = useState(readCrtEnabled);
  const [advancedOptions, setAdvancedOptions] = useState(loadAdvancedOptions);
  const gamepads = useGamepads();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Fighter job whose generation details modal is open (null = closed).
  const [detailsJobId, setDetailsJobId] = useState(null);
  const [createStage, setCreateStage] = useState(null);
  // Server killswitch (CREATION_ENABLED). Assumed on until /api/session
  // answers; the value is re-read on every create click, so a flip takes
  // effect without the player reloading.
  const [creationOpen, setCreationOpen] = useState(true);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [flowMusicActive, setFlowMusicActive] = useState(false);
  const gameRef = useRef(null);
  const gameFrameRef = useRef(null);
  const engineRef = useRef(null);
  const devMenuRef = useRef(null);
  const announcerRef = useRef(null);
  const visualBridgeRef = useRef({});
  const previousFighterJobStatusesRef = useRef(new Map());
  const trailerBootStartedRef = useRef(false);
  const setPageError = useCallback((value) => {
    // Live demos stay clean: no error/status toasts over the show.
    if (demoMode && value) return;
    setPageErrorToast((current) => {
      const currentMessage = current?.message || "";
      const message = typeof value === "function" ? value(currentMessage) : value;
      return message
        ? { message: String(message), id: (current?.id || 0) + 1 }
        : null;
    });
  }, [demoMode]);
  const pageError = pageErrorToast?.message || "";

  useLayoutEffect(() => {
    if (!(trailerMode || demoMode) || !window.location.search) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, [demoMode, trailerMode]);

  // A handoff QR opens the receiver directly, then removes the one-time code
  // from the URL so a reload cannot consume it twice. Keep the code in state
  // because React StrictMode intentionally re-runs effects in development.
  const [initialHandoffCode] = useState(() => handoffCodeFromLocation(window.location.search));
  useEffect(() => {
    if (!initialHandoffCode) return undefined;
    const url = new URL(window.location.href);
    if (url.searchParams.has("handoff")) {
      url.searchParams.delete("handoff");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    let attempts = 0;
    let timer = 0;
    function deliver() {
      if (window.gameLauncher?.receiveHandoff) {
        window.gameLauncher.receiveHandoff(initialHandoffCode);
        return;
      }
      attempts += 1;
      if (attempts < 200) timer = window.setTimeout(deliver, 50);
    }
    deliver();
    return () => window.clearTimeout(timer);
  }, [initialHandoffCode]);

  useEffect(() => {
    if (!pageErrorToast) return undefined;
    const timer = window.setTimeout(() => setPageErrorToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [pageErrorToast]);
  useUiSounds(soundOn && pageVisible);

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    const hide = () => setPageVisible(false);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", update);
    };
  }, []);

  // Cut the announcer clip the moment the page goes to the background.
  useEffect(() => {
    if (pageVisible || !announcerRef.current) return;
    announcerRef.current.pause();
    announcerRef.current.currentTime = 0;
    announcerRef.current = null;
  }, [pageVisible]);

  useEffect(() => {
    const gestureEvents = ["pointerdown", "keydown", "touchstart"];
    function markGesture(event) {
      firstGestureTargetRef.current = event.target;
      setAudioUnlocked(true);
      for (const type of gestureEvents) document.removeEventListener(type, markGesture, true);
    }
    for (const type of gestureEvents) document.addEventListener(type, markGesture, true);
    return () => {
      for (const type of gestureEvents) document.removeEventListener(type, markGesture, true);
    };
  }, []);
  // The launch flow, About, and Settings overlays share one music bed.
  const overlayMusicActive = flowMusicActive || advancedOpen || aboutOpen || Boolean(detailsJobId);
  const startFlowMusic = useFlowMusic(
    (overlayMusicActive || (demoMode && demoMusic)) && !engine,
    soundOn && pageVisible,
  );
  useEffect(() => {
    if (engine) setDemoMusic(false);
  }, [engine]);
  function toggleDemoMusic() {
    if (engine) return;
    setDemoMusic((active) => {
      if (!active) startFlowMusic();
      return !active;
    });
  }
  useEffect(() => {
    const syncFlowMusic = (event) => {
      const open = Boolean(event.detail?.open);
      setFlowMusicActive(open);
      if (open && !engine) startFlowMusic();
    };
    window.addEventListener(FLOW_MUSIC_EVENT, syncFlowMusic);
    return () => window.removeEventListener(FLOW_MUSIC_EVENT, syncFlowMusic);
  }, [engine, startFlowMusic]);
  const reportCreateVisualError = useCallback((error) => {
    setPageError(error.message || "Could not load the ROM screen.");
  }, []);

  async function fetchCharacters() {
    const response = await fetch("/api/characters", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the configured characters");
    return (await response.json()).characters;
  }

  async function loadCharacters({ replace = false } = {}) {
    const loadedCharacters = await fetchCharacters();
    setCharacters((current) =>
      replace ? loadedCharacters : mergeCharactersBySlug(current, loadedCharacters),
    );
    return loadedCharacters;
  }

  const recordFighterJob = useCallback((job) => {
    if (!job?.id) return;
    setFighterJobs((current) => {
      const existing = current.find((candidate) => candidate.id === job.id);
      if (existing && (existing.revision || 0) > (job.revision || 0)) return current;
      return [job, ...current.filter((candidate) => candidate.id !== job.id)];
    });
    if (job.status === "complete" && job.character) {
      setCharacters((current) => {
        const generated = { ...job.character, generated: true };
        const existingIndex = current.findIndex((character) => character.slug === generated.slug);
        if (existingIndex === -1) return [...current, generated];
        return current.map((character, index) => (index === existingIndex ? generated : character));
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshCharacters({ finishInitialLoad = false } = {}) {
      try {
        const loadedCharacters = await fetchCharacters();
        if (!cancelled) {
          setCharacters((current) => mergeCharactersBySlug(current, loadedCharacters));
        }
      } catch (error) {
        if (!cancelled) setPageError(error.message);
      } finally {
        if (!cancelled && finishInitialLoad) setLoadingCharacters(false);
      }
    }

    if (INLINE_CHARACTERS === null) {
      refreshCharacters({ finishInitialLoad: true });
    }

    getSession()
      .then((session) => {
        if (cancelled) return;
        setAuthorized(Boolean(session.authorized));
        setUser(session.user || null);
        setCreationOpen(session.creationEnabled !== false);
        setTurnstileSiteKey(session.turnstileSiteKey || "");
        if (isCreatePage && session.user && !session.authorized) {
          setPendingAction({ type: "create" });
        }
        // The edge-cached seed is deliberately public. Once the private
        // session is known, merge in the complete roster visible to this
        // user without holding up the public first paint. Merging also keeps
        // a live job completion that beats this request back to the client.
        if (INLINE_CHARACTERS !== null && session.user) {
          refreshCharacters();
        }
      })
      .catch((error) => {
        if (!cancelled) setPageError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingSession(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Live demos show the public roster only: no private/own fighters, no jobs.
  // Memoised: the grid effect below re-syncs every tile when this identity
  // changes, and a fresh filtered array per render made every state change
  // (engine boot, pin, Esc) repaint 1000 caption bitmaps in one task.
  const gridCharacters = useMemo(() => (demoMode
    ? demoGridOrder(characters.filter((character) => character.visibility !== "private" && !character.mine))
    : characters), [characters, demoMode]);
  const gridJobs = demoMode ? [] : fighterJobs;

  useEffect(() => {
    let cancelled = false;
    let timer;
    let attempts = 0;
    function syncGridCharacters() {
      if (cancelled) return;
      if (window.characterGrid?.syncCharacters) {
        Promise.resolve(window.characterGrid.syncCharacters(gridCharacters)).catch(() => {});
        return;
      }
      attempts += 1;
      if (attempts < 100) timer = window.setTimeout(syncGridCharacters, 50);
    }
    syncGridCharacters();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [gridCharacters]);

  useEffect(() => {
    if (!authorized || !user) {
      setFighterJobs([]);
      return undefined;
    }
    let cancelled = false;

    async function refreshFighterJobs() {
      const response = await fetch("/api/fighters", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      if (cancelled) return;
      setFighterJobs((current) => reconcileVisibleFighterJobs(current, result.jobs));
    }

    refreshFighterJobs().catch(() => {});
    const timer = window.setInterval(() => refreshFighterJobs().catch(() => {}), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authorized, user?.uid]);

  useEffect(() => {
    const previousStatuses = previousFighterJobStatusesRef.current;
    const nextStatuses = new Map();
    for (const job of fighterJobs) {
      nextStatuses.set(job.id, job.status);
      if (job.status === "failed" && previousStatuses.get(job.id) !== "failed") {
        setPageError(formatFighterJobError(job));
        // A toast alone is easy to miss and says nothing about why; open the
        // details modal so the player sees the stage, error and retry.
        if (previousStatuses.has(job.id)) setDetailsJobId(job.id);
      }
    }
    previousFighterJobStatusesRef.current = nextStatuses;
  }, [fighterJobs, setPageError]);

  const detailsJob = detailsJobId ? fighterJobs.find((job) => job.id === detailsJobId) || null : null;
  useEffect(() => {
    if (detailsJobId && !detailsJob) setDetailsJobId(null);
  }, [detailsJobId, detailsJob]);

  const retryFighterJob = useCallback(async (job) => {
    const response = await fetch(`/api/fighters/${encodeURIComponent(job.id)}/retry`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not retry this fighter.");
    if (result.job) recordFighterJob(result.job);
    return result.job;
  }, [recordFighterJob]);

  const deleteFighterJob = useCallback(async (job) => {
    const response = await fetch(`/api/fighters/${encodeURIComponent(job.id)}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not delete this fighter.");
    const slug = job.character?.slug || job.slug;
    setFighterJobs((current) => current.filter((candidate) => candidate.id !== job.id));
    setCharacters((current) => current.filter((character) => character.slug !== slug));
    setDetailsJobId(null);
    window.characterGrid?.select?.(null);
  }, []);

  const activeFighterJobKey = fighterJobs
    .filter((job) => ACTIVE_FIGHTER_JOB_STATUSES.has(job.status))
    .map((job) => job.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!activeFighterJobKey) return undefined;
    const streams = activeFighterJobKey.split(",").map((id) => {
      const stream = new EventSource(`/api/fighters/${id}/events`);
      stream.addEventListener("job", (event) => {
        try {
          recordFighterJob(JSON.parse(event.data).job);
        } catch {
          // The polling fallback will reconcile malformed or interrupted events.
        }
      });
      return stream;
    });
    return () => streams.forEach((stream) => stream.close());
  }, [activeFighterJobKey, recordFighterJob]);

  useEffect(() => {
    let cancelled = false;
    let timer;
    let attempts = 0;
    function syncGridJobs() {
      if (cancelled) return;
      if (window.characterGrid?.syncJobs) {
        Promise.resolve(window.characterGrid.syncJobs(gridJobs)).catch(() => {});
        return;
      }
      attempts += 1;
      if (attempts < 100) timer = window.setTimeout(syncGridJobs, 50);
    }
    syncGridJobs();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [gridJobs]);

  useEffect(() => {
    if (isCreatePage || createStage !== "rom") return undefined;
    let cancelled = false;
    let attempts = 0;
    let timer;

    function requestCreateRom() {
      if (cancelled) return;
      if (window.gameLauncher?.requestCreate) {
        window.gameLauncher.requestCreate();
        return;
      }
      attempts += 1;
      if (attempts < 100) timer = window.setTimeout(requestCreateRom, 50);
      else {
        setCreateStage(null);
        setPageError("Could not open the cartridge screen.");
      }
    }

    requestCreateRom();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [createStage, isCreatePage]);

  useEffect(() => {
    if (!engine) return undefined;
    let cancelled = false;
    let attempts = 0;
    let retry;

    function applySoundPreference() {
      if (cancelled) return;
      const audioContext = engineRef.current?.contentWindow?.Module?.SDL2?.audioContext;
      if (audioContext) {
        const update = soundOn && pageVisible ? audioContext.resume() : audioContext.suspend();
        update?.catch(() => {});
        return;
      }
      attempts += 1;
      if (attempts < 40) retry = window.setTimeout(applySoundPreference, 250);
    }

    applySoundPreference();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, [audioUnlocked, engine, pageVisible, soundOn]);

  // WebKit only lets an AudioContext start from a gesture inside its own
  // document, and the gesture that launches a game (the roster tile click)
  // happens here, before the engine iframe exists. So the page keeps one
  // shared AudioContext that any trusted key press or pointer press creates
  // and resumes, and the engine shell adopts it instead of constructing its
  // own (BattleShip/web/index.html wraps AudioContext for SDL). The context
  // is already running by the time SDL asks for it, so the opening is
  // audible from the click itself. As a fallback for a context the engine
  // did create (older shells), the same gesture resumes the iframe's SDL
  // context synchronously; WebKit's gesture scope covers a same-origin frame
  // called from the handler. Chrome inherits activation via allow="autoplay"
  // and never needs either path.
  useEffect(() => {
    const unlockAudio = (event) => {
      if (!event.isTrusted) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !window.__openSmashAudioContext) {
        try { window.__openSmashAudioContext = new AudioContextClass(); } catch { /* no audio device */ }
      }
      const contexts = [
        window.__openSmashAudioContext,
        engine ? engineRef.current?.contentWindow?.Module?.SDL2?.audioContext : null,
      ];
      for (const audioContext of contexts) {
        if (!audioContext || audioContext.state !== "suspended") continue;
        // The sound preference is applied to the engine's context separately
        // once it runs; a running silent context before that is harmless.
        if (!soundOn && engine) continue;
        audioContext.resume().catch(() => {});
      }
    };
    const options = { capture: true, passive: true };
    window.addEventListener("keydown", unlockAudio, options);
    window.addEventListener("pointerdown", unlockAudio, options);
    return () => {
      window.removeEventListener("keydown", unlockAudio, options);
      window.removeEventListener("pointerdown", unlockAudio, options);
    };
  }, [engine, soundOn]);

  // Re-plan the running game's ports when the controller settings change;
  // the shell (window.controllerPorts) handles hot-plug on its own.
  useEffect(() => {
    if (!engine) return;
    engineRef.current?.contentWindow?.controllerPorts?.apply?.(controllerPlan(advancedOptions, gamepads));
  }, [engine, advancedOptions, gamepads]);

  useEffect(() => {
    document.body.classList.toggle("is-immersive", immersive);
    return () => document.body.classList.remove("is-immersive");
  }, [immersive]);

  useEffect(() => {
    if (!engine) setImmersive(false);
  }, [engine]);

  useEffect(() => {
    function syncFullscreenState() {
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      setIsFullscreen(Boolean(fullscreenElement) && fullscreenElement === fullscreenTarget());
      if (!fullscreenElement) setDemoTrailer((active) => {
        if (active) setTrailerCinematic(false);
        return false;
      });
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

  function launchOptionsFor(action) {
    if (action.trailerIntro) {
      return { ...advancedOptions, bootMode: "full-boot" };
    }
    if (trailerMode && action.type === "character") {
      return {
        ...advancedOptions,
        bootMode: "free-for-all",
        stage: TRAILER_STAGE,
        opponentLevel: TRAILER_CPU_LEVEL,
      };
    }
    if (demoMode && action.type === "character") {
      return {
        ...advancedOptions,
        bootMode: "free-for-all",
        stage: demoStageFor(action.character?.slug),
        opponentLevel: DEMO_CPU_LEVEL,
      };
    }
    return advancedOptions;
  }

  // A pick from deep in the roster scrolls the page back to the game. Booting
  // the engine in the same frame starves that scroll: every tile passing the
  // viewport paints its caption while the wasm module loads, so the grid
  // tears and stutters. Wait for the scroll to settle first (fallback timer
  // for browsers without scrollend), then hand the iframe its URL.
  const pendingBootRef = useRef(0);
  function bootEngineAfterScroll(boot) {
    const token = ++pendingBootRef.current;
    if (window.scrollY <= 4) {
      boot();
      return;
    }
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("scrollend", finish);
      if (pendingBootRef.current === token) boot();
    };
    timer = window.setTimeout(finish, 1200);
    window.addEventListener("scrollend", finish, { once: true });
  }

  function launch(action) {
    try {
      const launchOptions = launchOptionsFor(action);
      const launchAction = prepareLaunchAction(action, launchOptions);
      if (action.trailerIntro) {
        setTrailerEngineReady(false);
        setTrailerEngineStarted(false);
      }
      const src = engineUrl(launchAction, launchOptions, gamepads);
      setPendingAction(null);
      if (action.trailerIntro) {
        setEngine({ src, action: launchAction });
      } else {
        requestAnimationFrame(() => gameRef.current?.scrollIntoView({
          behavior: demoMode ? "instant" : "smooth",
          block: "start",
        }));
        bootEngineAfterScroll(() => {
          setEngine({ src, action: launchAction });
          if (demoMode && DEMO_PIN_ON_PLAY) setImmersive(true);
        });
      }
    } catch (error) {
      setPageError(error.message || "Could not apply those advanced options.");
    }
  }

  function prepareLaunchAction(action, launchOptions = advancedOptions) {
    if (action.trailerIntro) {
      return createTrailerIntroAction(action, characters);
    }
    if (trailerMode && action.type === "character") {
      return createTrailerMatchAction(action, characters);
    }
    if (demoMode && action.type === "character") {
      return createDemoMatchAction(action, characters);
    }
    if (launchOptions.bootMode === "full-boot") {
      return {
        ...action,
        introConfig: createFullBootIntroConfig(
          characters,
          Math.random,
          action.type === "character" ? action.character : null,
          advancedOptions.characterMesh,
        ),
      };
    }
    if (action.type !== "character" || action.opponents) return action;
    const ownedCharacters = fighterJobs
      .filter((job) => job.status === "complete" && job.character)
      .map((job) => job.character);
    return {
      ...action,
      opponents: selectDirectBattleOpponents(
        action.character,
        characters,
        ownedCharacters,
      ),
    };
  }

  useEffect(() => {
    if (!trailerMode || loadingCharacters || loadingSession || trailerBootStartedRef.current) return;
    trailerBootStartedRef.current = true;
    const action = { type: "start", trailerIntro: true, trailerRecording };
    if (authorized) {
      launch(action);
      return undefined;
    }

    // The direct-site visual runtime owns the ROM/controller gates. Wait for
    // its bridge and send the same trailer action through that normal flow.
    let attempts = 0;
    let timer = 0;
    function requestTrailerLaunch() {
      if (window.gameLauncher?.requestTrailer) {
        window.gameLauncher.requestTrailer();
        return;
      }
      attempts += 1;
      if (attempts < 100) timer = window.setTimeout(requestTrailerLaunch, 50);
      else setPageError("Could not start trailer capture mode.");
    }
    requestTrailerLaunch();
    return () => window.clearTimeout(timer);
  }, [authorized, loadingCharacters, loadingSession, trailerMode, trailerRecording]);

  function updateAdvancedOptions(nextOptions) {
    const normalized = normalizeAdvancedOptions(nextOptions);
    setAdvancedOptions(normalized);
    try {
      sessionStorage.setItem(ADVANCED_OPTIONS_KEY, JSON.stringify(normalized));
    } catch {
      // The in-memory choice still applies when session storage is unavailable.
    }
  }

  function restoreDefaultSettings(nextOptions) {
    updateAdvancedOptions(nextOptions);
    setSoundPreference(true);
  }

  async function requestLaunch(action) {
    setPageError("");
    if (isCreatePage && controlsRoadblockRequired()) {
      window.location.assign("/");
      return;
    }
    const session = authorized ? null : await getSession();
    if (authorized || session?.authorized) {
      setAuthorized(true);
      if (session?.user) setUser(session.user);
      launch(action);
    } else {
      setPendingAction(action);
    }
  }

  async function validated() {
    setAuthorized(true);
    const session = await getSession();
    setUser(session.user || null);
    if (pendingAction && pendingAction.type !== "create") launch(pendingAction);
    else setPendingAction(null);
  }

  async function authenticated(nextUser) {
    setUser(nextUser);
    if (isCreatePage && !authorized) setPendingAction({ type: "create" });
    await loadCharacters().catch((error) => setPageError(error.message));
  }

  async function openCreateExperience() {
    setPageError("");
    try {
      const session = await getSession();
      setAuthorized(Boolean(session.authorized));
      setUser(session.user || null);
      const open = session.creationEnabled !== false;
      setCreationOpen(open);
      setTurnstileSiteKey(session.turnstileSiteKey || "");
      if (!open) setCreateStage("paused");
      else if (!session.user) setCreateStage("auth");
      else setCreateStage(session.authorized ? "creator" : "rom");
    } catch (error) {
      setPageError(error.message || "Could not start character creation.");
    }
  }

  async function authenticatedForCreate(nextUser) {
    setUser(nextUser);
    setCreateStage(authorized ? "creator" : "rom");
    await loadCharacters().catch((error) => setPageError(error.message));
  }

  async function authenticatedFromSettings(nextUser) {
    setUser(nextUser);
    await loadCharacters().catch((error) => setPageError(error.message));
  }

  function playCreatedCharacter(character) {
    setCreateStage(null);
    announceCharacter(character);
    window.setTimeout(() => window.gameLauncher?.requestCharacter?.(character.slug), 0);
  }

  function fighterCreated(job) {
    recordFighterJob(job);
    setCreateStage(null);
    setPageError("");
  }

  async function signOutUser() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) {
      setPageError("Could not sign out.");
      return;
    }
    setUser(null);
    setCreateStage(null);
    await loadCharacters({ replace: true }).catch((error) => setPageError(error.message));
  }

  function selectCharacter(character) {
    // Once the ROM is validated and the controls tutorial is behind the
    // player, a click goes straight into the engine, whose VS card
    // announces the matchup itself; voicing the pick here too would play
    // the name twice.
    let controlsStepComing = true;
    try {
      const ask = window.openSmashRequiresControllerTutorial;
      controlsStepComing = ask ? Boolean(ask()) : Boolean(
        controlsRoadblockRequired() || !readControllerTutorialCompletion(localStorage),
      );
    } catch {
      controlsStepComing = true;
    }
    if (!authorized || controlsStepComing) announceCharacter(character);
    requestLaunch({ type: "character", character });
  }

  function announceCharacter(character) {
    const previous = announcerRef.current;
    if (previous) {
      previous.pause();
      previous.currentTime = 0;
    }

    if (soundOn && character.announcer) {
      const announcer = new Audio(character.announcer);
      announcerRef.current = announcer;
      announcer.play().catch(() => {
        if (announcerRef.current === announcer) announcerRef.current = null;
      });
      announcer.addEventListener("ended", () => {
        if (announcerRef.current === announcer) announcerRef.current = null;
      }, { once: true });
    } else {
      announcerRef.current = null;
    }

  }

  async function validateVisualRom(file, onStatus) {
    const rom = await identifyRomFile(file, { onStatus });
    onStatus?.("validating");
    const response = await fetch("/api/validate-rom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: "SHA-1", hash: rom.sha1, size: rom.size }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ROM validation failed");
    // The engine builds its assets from these bytes inside the browser.
    onStatus?.("storing");
    await storeRom(rom);
    prewarmArchiveInBackground(reportEngineAssetError);
    setAuthorized(true);
    const session = await getSession();
    setUser(session.user || null);
    return result;
  }

  async function validateCreateVisualRom(file, onStatus) {
    const result = await validateVisualRom(file, onStatus);
    requireControlsRoadblock();
    return result;
  }

  function launchVisualAction({ type, slug, picks = [] }) {
    const action = type === "trailer-intro"
      ? { type: "start", trailerIntro: true }
      : type === "character"
      ? {
          type,
          character: characters.find((character) => character.slug === slug),
          picks: picks.map((pickSlug) => characters.find((character) => character.slug === pickSlug)),
        }
      : { type };
    if (type === "character" && (!action.character || action.picks.some((pick) => !pick))) {
      setPageError("That fighter is no longer available.");
      return "about:blank";
    }
    try {
      const launchOptions = launchOptionsFor(action);
      const launchAction = prepareLaunchAction(action, launchOptions);
      const src = engineUrl(launchAction, launchOptions, gamepads);
      if (action.trailerIntro) setEngine({ src, action: launchAction });
      else bootEngineAfterScroll(() => {
        setEngine({ src, action: launchAction });
        if (demoMode && DEMO_PIN_ON_PLAY) setImmersive(true);
      });
      setPendingAction(null);
      setPageError("");
      return src;
    } catch (error) {
      setPageError(error.message || "Could not apply those advanced options.");
      return "about:blank";
    }
  }

  // The engine could not build/find its assets (extraction failed, or the
  // stored ROM is gone). Close the game, tell the player, and re-prompt for
  // the ROM so a retry is one click away.
  function reportEngineAssetError(error) {
    const message = error?.message || String(error);
    setEngine(null);
    setPageError(`Could not prepare the game's assets from your ROM: ${message}`);
    setAuthorized(false);
    setPendingAction((current) => current || { type: "start" });
  }

  useEffect(() => {
    function onEngineMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === ENGINE_TRAILER_READY_MESSAGE) {
        setTrailerEngineReady(true);
        return;
      }
      if (event.data?.type === ENGINE_TRAILER_REVEAL_MESSAGE) {
        runTrailerControl();
        return;
      }
      if (event.data?.type === ENGINE_TRAILER_CAPTURE_SAVED_MESSAGE) {
        setPageError(`Trailer capture saved: ${event.data.path}`);
        return;
      }
      if (event.data?.type === ENGINE_ASSET_ERROR_MESSAGE) {
        // A frame we already closed (fast click on Close/another launch) can
        // still post as its aborted fetches reject. Only the live engine counts.
        if (event.source !== engineRef.current?.contentWindow) return;
        reportEngineAssetError(new Error(String(event.data.message || "unknown error")));
      }
    }
    window.addEventListener("message", onEngineMessage);
    return () => window.removeEventListener("message", onEngineMessage);
  }, [trailerEngineReady, trailerEngineStarted]);

  async function clearVerification() {
    setPageError("");
    const response = await fetch("/api/dev/clear-rom", { method: "POST" });
    if (!response.ok) {
      setPageError("Could not clear ROM verification");
      return;
    }
    try {
      await clearRomStore();
    } catch (error) {
      console.warn("Could not clear the stored ROM:", error);
    }
    setAuthorized(false);
    setPendingAction(null);
    setEngine(null);
    setAdvancedOpen(false);
    window.characterGrid?.select(null);
    if (devMenuRef.current) devMenuRef.current.open = false;
  }

  async function resetRomFromAdvanced() {
    setAdvancedOpen(false);
    await clearVerification();
  }

  function resetControllerTutorialFromAdvanced() {
    try { clearControllerTutorialCompletion(localStorage); }
    catch { /* The runtime reset below still applies to this tab. */ }
    window.gameLauncher?.resetControls?.();
    setAdvancedOpen(false);
  }

  function toggleCrt() {
    setCrtOn((current) => {
      const next = !current;
      writeCrtEnabled(next);
      return next;
    });
  }

  function setSoundPreference(nextValue) {
    setSoundOn((current) => {
      const next = typeof nextValue === "function" ? nextValue(current) : Boolean(nextValue);
      try { localStorage.setItem("opensmash-sound", next ? "on" : "off"); }
      catch { /* The in-memory preference still applies when storage is unavailable. */ }
      if (!next && announcerRef.current) {
        announcerRef.current.pause();
        announcerRef.current.currentTime = 0;
        announcerRef.current = null;
      }
      return next;
    });
  }

  // When sound is already "on" but the page has not been interacted with yet,
  // the first press on the sound button unlocks audio rather than flipping the
  // preference off. Detect that by checking whether the page's first gesture
  // landed on this very button.
  // The viewer used the YouTube player's own speaker button. Unmuting there
  // is the same opt-in as the site toggle (and implies sound on); muting there
  // just drops the trailer opt-in and leaves game/UI sound alone.
  function trailerSoundChangedByPlayer(audible) {
    setTrailerSoundOptIn(audible);
    if (audible) setSoundPreference(true);
  }

  function toggleSound(event) {
    const firstTarget = firstGestureTargetRef.current;
    if (soundOn && firstTarget && event?.currentTarget?.contains?.(firstTarget)) {
      // First gesture landed on the sound button itself: that is an explicit
      // "enable sound", not a request to turn it off.
      firstGestureTargetRef.current = null;
      setTrailerSoundOptIn(true);
      return;
    }
    firstGestureTargetRef.current = null;
    if (!soundOn) setTrailerSoundOptIn(true);
    setSoundPreference((current) => !current);
  }

  // Fullscreen the surface shell (frame + touch deck) so mobile controls stay
  // visible; on the desktop layout the shell is just the frame's wrapper.
  function fullscreenTarget() {
    const frame = gameFrameRef.current;
    return frame?.closest?.(".game-surface-shell") || frame || null;
  }

  async function toggleFullscreen() {
    const target = fullscreenTarget();
    if (!target) return;

    // Live demos never leave the tab: browser fullscreen repaints Chrome and
    // flashes the transition. The pinned in-page shell (RetroHome FLIPs it)
    // reads as fullscreen on a projector and Esc releases it.
    if (demoMode) {
      setImmersive((current) => !current);
      return;
    }

    if (immersive) {
      setImmersive(false);
      return;
    }

    try {
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreenElement) {
        const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
        await exitFullscreen.call(document);
      } else {
        const requestFullscreen = target.requestFullscreen || target.webkitRequestFullscreen;
        if (!requestFullscreen) throw new Error("Fullscreen API unavailable");
        await requestFullscreen.call(target);
      }
    } catch {
      // iPhone Safari exposes no element fullscreen: pin the shell over the
      // page instead. Safari's own toolbars stay, but tabs and page chrome go.
      setImmersive(true);
    }
  }

  // Demo hand-off: the looping trailer takes the whole screen over the live
  // match, then the engine is torn down once the video is covering it.
  // P: the presenter's match, booted from wherever the page is, straight
  // into the pinned shell so the VS card lands framed for the recording.
  function startDemoMatch() {
    const character = characters.find((entry) => entry.slug === DEMO_PRESENTER);
    if (!character) {
      setPageError(`Demo presenter "${DEMO_PRESENTER}" is not in the roster.`);
      return;
    }
    window.clearTimeout(demoCurtainTimerRef.current);
    setDemoTrailer(false);
    setDemoCurtain(false);
    setTrailerCinematic(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    window.characterGrid?.select?.(character.slug);
    launch({ type: "character", character, picks: [] });
  }

  // N: close the match and glide the roster down to the next pick. A custom
  // eased scroll (not the browser's smooth scroll) so the glide is the same
  // length every take and the engine is gone before any tile has to paint.
  const demoScrollFrameRef = useRef(0);
  function runDemoScroll() {
    window.cancelAnimationFrame(demoScrollFrameRef.current);
    window.clearTimeout(demoCurtainTimerRef.current);
    setDemoTrailer(false);
    setDemoCurtain(false);
    setTrailerCinematic(false);
    setImmersive(false);
    setEngine(null);
    window.characterGrid?.select?.(null);
    if (DEMO_MUSIC_ON_SCROLL) {
      setDemoMusic(true);
      startFlowMusic();
    }
    const tile = document.querySelector(`#replica-grid [data-roster-character="${DEMO_SCROLL_TARGET}"]`);
    if (!tile) {
      setPageError(`Demo scroll target "${DEMO_SCROLL_TARGET}" is not on the grid.`);
      return;
    }
    // Let React drop the pinned shell first so the tile's page position is
    // measured against the normal layout.
    window.setTimeout(() => {
      const rect = tile.getBoundingClientRect();
      const maxTop = document.documentElement.scrollHeight - window.innerHeight;
      const target = Math.max(0, Math.min(maxTop, window.scrollY + rect.top + rect.height / 2 - window.innerHeight * 0.62));
      const from = window.scrollY;
      const started = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        const t = Math.min(1, (now - started) / DEMO_SCROLL_DURATION_MS);
        // Explicitly instant: the page's own scroll-behavior would turn every
        // frame's scrollTo into a fresh smooth animation.
        window.scrollTo({ top: from + (target - from) * ease(t), left: 0, behavior: "instant" });
        if (t < 1) demoScrollFrameRef.current = window.requestAnimationFrame(step);
      };
      demoScrollFrameRef.current = window.requestAnimationFrame(step);
    }, 60);
  }

  const demoCurtainTimerRef = useRef(0);
  function toggleDemoTrailer() {
    if (!fullscreenTarget()) return;
    window.clearTimeout(demoCurtainTimerRef.current);
    if (demoTrailer) {
      setDemoTrailer(false);
      setDemoCurtain(false);
      setTrailerCinematic(false);
      setImmersive(false);
      return;
    }
    // Stay in the tab: the shell FLIPs to the pinned cinematic box, a
    // "Loading trailer" curtain fades over the match, the engine goes away
    // behind it, then the curtain lifts on the video already playing.
    setDemoTrailer(true);
    setDemoCurtain(true);
    setTrailerCinematic(true);
    setImmersive(false);
    demoCurtainTimerRef.current = window.setTimeout(() => {
      setEngine(null);
      demoCurtainTimerRef.current = window.setTimeout(() => setDemoCurtain(false), 700);
    }, 1400);
  }

  async function runTrailerControl() {
    const target = fullscreenTarget();
    if (!target) return;

    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (!trailerEngineStarted) {
      if (!trailerEngineReady) return;
      const startTrailer = engineRef.current?.contentWindow?.openSmashStartTrailer;
      if (typeof startTrailer !== "function") {
        setPageError("The trailer engine is not ready yet.");
        return;
      }

      // Call into the same-origin iframe synchronously while this trusted click
      // still owns browser activation. SDL creates its AudioContext inside
      // callMain(), so the opening starts audible instead of autoplay-blocked.
      startTrailer();
      setTrailerEngineStarted(true);
      return;
    }

    if (trailerRecording) {
      const stopTrailerClip = engineRef.current?.contentWindow?.stopTrailerClip;
      if (typeof stopTrailerClip !== "function") {
        setPageError("The trailer capture has already stopped and is finishing or saved.");
        return;
      }
      stopTrailerClip();
      setPageError("Finishing the 2560×1920 trailer capture…");
      return;
    }

    if (fullscreenElement) {
      try {
        const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
        await exitFullscreen.call(document);
      } catch {
        // Continue with the in-page reveal if browser fullscreen exit fails.
      }
    }
    setTrailerCinematic(false);
  }

  const visibleCharacters = characters
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => matchesCharacterSearch(character, fighterSearch));

  // /create is a real URL, so the killswitch has to close it too — not just
  // the create tile on the home page. A closed lab replaces the whole page:
  // no ROM shell, no sign-in gate, nothing to fill in.
  if (isCreatePage && !loadingSession && !creationOpen) {
    return <CreationPaused open onClose={() => window.location.assign("/")} />;
  }

  if (isCreatePage) {
    Object.assign(visualBridgeRef.current, {
      completeCreateRom() { setPendingAction(null); },
      isAuthorized() { return authorized; },
      cancelCreateRom() { window.location.assign("/"); },
      reportError: reportCreateVisualError,
      validateCreateRom: validateCreateVisualRom,
      validateRom: validateCreateVisualRom,
    });
    window.openSmashReactBridge = visualBridgeRef.current;
  }

  if (!isCreatePage) {
    Object.assign(visualBridgeRef.current, {
      characters,
      fighterJobs,
      announceCharacter(slug) {
        const character = characters.find((candidate) => candidate.slug === slug);
        if (character) announceCharacter(character);
      },
      clearVerification,
      closeGame() { setEngine(null); },
      completeCreateRom() { setCreateStage("creator"); },
      hasGamepad() { return gamepads.length > 0; },
      humanPortCount() {
        return controllerPlan(advancedOptions, gamepads)
          .filter((entry) => entry && entry.kind !== "none").length;
      },
      isAuthorized() { return authorized; },
      launch: launchVisualAction,
      cancelCreateRom() { setCreateStage(null); },
      navigate(pathname) {
        if (pathname === "/create") openCreateExperience();
        else window.location.assign(pathname);
      },
      reportError(error) { setPageError(error.message || "Could not load the visual experience."); },
      reportGenerationError(job) { setPageError(formatFighterJobError(job)); },
      showGenerationDetails(job) { if (job?.id) setDetailsJobId(job.id); },
      // Padlock/manage control on an own tile: open the job details (delete lives there).
      manageFighter(slug) {
        const job = fighterJobs.find((candidate) => (candidate.character?.slug || candidate.slug) === slug);
        if (job) setDetailsJobId(job.id);
      },
      validateCreateRom: validateCreateVisualRom,
      validateRom: validateVisualRom,
    });
    window.openSmashReactBridge = visualBridgeRef.current;

    return (
      <>
        <RetroHome
          aboutOpen={aboutOpen}
          advancedActive={hasAdvancedOverrides(advancedOptions)}
          authorized={authorized}
          developmentMode={import.meta.env.DEV}
          engine={engine}
          engineRef={engineRef}
          gameFrameRef={gameFrameRef}
          gamepadCount={gamepads.length}
          immersive={immersive}
          isFullscreen={isFullscreen || immersive}
          launchFlowOpen={overlayMusicActive}
          onAboutChange={setAboutOpen}
          onAdvanced={() => setAdvancedOpen(true)}
          onCreate={openCreateExperience}
          onFullscreen={toggleFullscreen}
          onTrailerControl={runTrailerControl}
          demoMode={demoMode}
          demoMusic={demoMusic}
          onDemoMusic={toggleDemoMusic}
          demoTrailer={demoTrailer}
          demoCurtain={demoCurtain}
          onDemoTrailer={toggleDemoTrailer}
          onDemoStart={startDemoMatch}
          onDemoScroll={runDemoScroll}
          onResetRom={clearVerification}
          onSignOut={signOutUser}
          pageError={pageError}
          ready={!loadingCharacters}
          audioActive={audioActive}
          trailerSoundOptIn={trailerSoundOptIn}
          onTrailerSoundChange={trailerSoundChangedByPlayer}
          soundOn={soundOn}
          trailerCinematic={trailerCinematic}
          trailerEngineReady={trailerEngineReady}
          trailerEngineStarted={trailerEngineStarted}
          trailerMode={trailerMode}
          trailerRecording={trailerRecording}
          user={user}
        />
        <CreateExperienceOverlay
          turnstileSiteKey={turnstileSiteKey}
          onAuthenticated={authenticatedForCreate}
          onClose={() => setCreateStage(null)}
          onCreated={fighterCreated}
          onPlay={playCreatedCharacter}
          stage={createStage}
          user={user}
        />
        <CreationPaused open={createStage === "paused"} onClose={() => setCreateStage(null)} />
        <FighterJobModal
          job={detailsJob}
          open={Boolean(detailsJob)}
          onClose={() => setDetailsJobId(null)}
          onRetry={retryFighterJob}
          onDelete={deleteFighterJob}
        />
        <SettingsModal
          accountConnected={Boolean(user)}
          authorized={authorized}
          debugMode={new URLSearchParams(window.location.search).get("debug") === "1"}
          gamepads={gamepads}
          open={advancedOpen}
          options={advancedOptions}
          soundOn={soundOn}
          crtOn={crtOn}
          onCrt={toggleCrt}
          onAuthenticated={authenticatedFromSettings}
          onCancel={() => setAdvancedOpen(false)}
          onLogOut={signOutUser}
          onOptionsChange={updateAdvancedOptions}
          onRestoreDefaults={restoreDefaultSettings}
          onResetControllerTutorial={resetControllerTutorialFromAdvanced}
          onResetRom={resetRomFromAdvanced}
          onReceiveRom={validateVisualRom}
          onSound={toggleSound}
        />
      </>
    );
  }

  return (
    <main className={isCreatePage ? "create-page" : undefined}>
      {isCreatePage && (
        <CreateVisualShell
          onError={reportCreateVisualError}
          romUploadRequired={!loadingSession && Boolean(user) && !authorized}
        />
      )}
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Smash.fun home">
          SMASH<span>.FUN</span>
        </a>
        <div className="header-tools">
          <a className="create-link" href={isCreatePage ? "/" : "/create"}>
            {isCreatePage ? "Browse fighters" : "Create fighter"}
          </a>
          {user && (
            <button className="account-button" type="button" onClick={signOutUser}>
              {user.displayName || user.email || "Account"} · Sign out
            </button>
          )}
          <button
            className={`sound-button ${soundOn ? "is-on" : ""}`}
            type="button"
            aria-pressed={soundOn}
            data-ui-sound-toggle
            onClick={toggleSound}
          >
            <i /> {soundOn ? (audioUnlocked ? "Sound on" : "Enable sound") : "Sound off"}
          </button>
          <button
            className={`advanced-button ${hasAdvancedOverrides(advancedOptions) ? "is-active" : ""}`}
            type="button"
            aria-haspopup="dialog"
            onClick={() => setAdvancedOpen(true)}
          >
            <i /> Settings
          </button>
          <span className={`rom-status ${authorized ? "is-ready" : ""}`}>
            <i /> {authorized ? "ROM verified" : "Browser build"}
          </span>
          <details className="dev-menu" ref={devMenuRef}>
            <summary>Dev</summary>
            <div className="dev-menu-panel">
              <button type="button" onClick={clearVerification}>
                Clear ROM verification
              </button>
            </div>
          </details>
        </div>
      </header>

      {(!isCreatePage || engine) && <section className="hero" id="top" ref={gameRef}>
        <div className={`game-frame ${engine ? "is-running" : ""}`} ref={gameFrameRef}>
          {engine ? (
            <iframe
              ref={engineRef}
              src={engine.src}
              title="Smash.fun game engine"
              allow="autoplay; gamepad; fullscreen"
            />
          ) : (
            <div className="engine-placeholder">
              <img
                src={viewportLogoUrl}
                alt="Smash.fun"
              />
              <div>
                <p className="eyebrow">WASM game viewport</p>
                <h1>Pick a fighter.<br />Start a match.</h1>
                <p>The engine stays unloaded until you choose how to play.</p>
              </div>
            </div>
          )}
          <div className="game-frame-tools">
            {engine && (
              <button className="frame-button" type="button" onClick={() => setEngine(null)}>
                Close game
              </button>
            )}
            <button
              className="frame-button fullscreen-button"
              type="button"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              onClick={toggleFullscreen}
            >
              <span aria-hidden="true">⛶</span>
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
          </div>
        </div>
      </section>}

      {isCreatePage && !loadingSession && !user && <AuthGate onAuthenticated={authenticated} />}

      {isCreatePage && (
        <CreateExperienceOverlay
          turnstileSiteKey={turnstileSiteKey}
          onAuthenticated={authenticated}
          onClose={() => window.location.assign("/")}
          onCreated={() => window.location.assign("/")}
          onPlay={selectCharacter}
          stage={!loadingSession && authorized && user ? "creator" : null}
          user={user}
        />
      )}

      {!isCreatePage && <section className="select-section" aria-labelledby="select-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Choose your fighter</p>
            <h2 id="select-title">Character select</h2>
          </div>
          <div className="select-controls">
            <label className="fighter-search">
              <span>Search roster</span>
              <input
                type="search"
                value={fighterSearch}
                onChange={(event) => setFighterSearch(event.target.value)}
                placeholder="Find a fighter…"
                autoComplete="off"
              />
            </label>
            <div className="play-actions">
              <button
                className="start-button"
                type="button"
                onClick={() => requestLaunch({ type: "start" })}
              >
                <span>Play from start</span>
                <small>Watch the intro</small>
              </button>
              <button className="play-button" type="button" onClick={() => requestLaunch({ type: "select" })}>
                <span>Play now</span>
                <small>Open character select →</small>
              </button>
            </div>
          </div>
        </div>

        {pageError && <p className="page-error">{pageError}</p>}
        <div className="character-grid" aria-busy={loadingCharacters}>
          {loadingCharacters && <p className="loading-message">Loading fighters…</p>}
          {!loadingCharacters && characters.length === 0 && (
            <p className="loading-message">No valid characters are enabled in config/characters.json.</p>
          )}
          {!loadingCharacters && characters.length > 0 && visibleCharacters.length === 0 && (
            <p className="loading-message">No portraits match “{fighterSearch.trim()}”.</p>
          )}
          {visibleCharacters.map(({ character, index }) => (
            <button
              className="character-card"
              type="button"
              key={character.slug}
              style={{ "--index": index }}
              onClick={() => selectCharacter(character)}
            >
              <span className="portrait-wrap">
                <img src={character.portraitMedium || character.portrait} alt="" loading="lazy" />
              </span>
              <span className="character-number">{String(index + 1).padStart(2, "0")}</span>
              {character.generated && <span className="generated-label">Fighter Lab</span>}
              <span className="character-name">{character.name}</span>
              <span className="quick-match">Quick match ↗</span>
            </button>
          ))}
        </div>
      </section>}

      <footer>
        <span>Smash.fun</span>
        <span>React · Node · WASM on demand</span>
      </footer>

      <SettingsModal
        accountConnected={Boolean(user)}
        authorized={authorized}
        debugMode={new URLSearchParams(window.location.search).get("debug") === "1"}
        gamepads={gamepads}
        open={advancedOpen}
        options={advancedOptions}
        soundOn={soundOn}
        crtOn={crtOn}
        onCrt={toggleCrt}
        onAuthenticated={authenticatedFromSettings}
        onCancel={() => setAdvancedOpen(false)}
        onLogOut={signOutUser}
        onOptionsChange={updateAdvancedOptions}
        onRestoreDefaults={restoreDefaultSettings}
        onResetControllerTutorial={resetControllerTutorialFromAdvanced}
        onResetRom={resetRomFromAdvanced}
        onReceiveRom={validateVisualRom}
        onSound={toggleSound}
      />

      {pendingAction && pendingAction.type !== "create" && (
        <RomModal
          onPrewarmError={reportEngineAssetError}
          action={pendingAction}
          onCancel={() => {
            if (pendingAction.type === "create") window.location.assign("/");
            else setPendingAction(null);
          }}
          onValidated={validated}
        />
      )}
    </main>
  );
}
