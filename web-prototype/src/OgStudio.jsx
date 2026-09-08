import { useEffect, useMemo, useRef, useState } from "react";
import prebattleSkyUrl from "../visual/assets/game/prebattle-sky.png?url";
import logoFallbackUrl from "../visual/assets/smash-the-weights-logo.png?url";
import SearchableFighterSelect from "./SearchableFighterSelect.jsx";
import {
  availableBodyModels,
  fighterFrame,
  fighterSlotAtPoint,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  OG_MAX_ZOOM,
  OG_MIN_ZOOM,
  OG_ROSTER_SLOTS,
  shuffledRoster,
} from "../shared/og-studio.js";
import { renderInGameFighter } from "./osb-fighter-renderer.js";
import {
  OG_LOGO_RENDER_HEIGHT,
  OG_LOGO_RENDER_WIDTH,
  renderGameLogo,
} from "./og-logo-renderer.js";
import "./og-studio.css";

const STORAGE_KEY = "opensmash-og-studio-v2";
const MAX_OFFSET_X = 20;
const MAX_OFFSET_Y = 15;
const LOGO_MIN_WIDTH = 140;
const LOGO_MAX_WIDTH = 1000;
const DEFAULT_LOGO_PLACEMENT = Object.freeze({ x: 420, y: 18, width: 360 });
// backdrop: "sky" = the game's pre-battle sky; "band" = title-screen style
// giant green band on cream. renderer: "engine" = native VS-card capture via
// /api/og-sprite (dev machine only; falls back per fighter), "preview" =
// the three.js bind-pose render.
// "band": flat colour fill with one big black vertical divider, like the
// engine's chroma capture frames; the divider's centre and width are tunable.
const DEFAULT_SCENE = Object.freeze({ backdrop: "sky", renderer: "engine", bandColor: "#ff00ff", dividerX: 1000, dividerWidth: 216 });
const BACKDROPS = Object.freeze([
  { value: "sky", label: "Pre-battle sky" },
  { value: "band", label: "Solid colour + divider" },
]);
const BAND_SWATCHES = Object.freeze([
  { value: "#ff00ff", label: "Hot pink" },
  { value: "#00ff00", label: "Hot green" },
]);
const DIVIDER_MIN_WIDTH = 0;
const DIVIDER_MAX_WIDTH = 600;
function validColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : fallback;
}
const RENDERERS = Object.freeze([
  { value: "engine", label: "In-engine (VS-card pose)" },
  { value: "preview", label: "Quick preview (bind pose)" },
]);
function validScene(value) {
  return {
    backdrop: BACKDROPS.some((option) => option.value === value?.backdrop) ? value.backdrop : DEFAULT_SCENE.backdrop,
    renderer: RENDERERS.some((option) => option.value === value?.renderer) ? value.renderer : DEFAULT_SCENE.renderer,
    bandColor: validColor(value?.bandColor, DEFAULT_SCENE.bandColor),
    dividerX: Number.isFinite(value?.dividerX) ? clamp(value.dividerX, 0, OG_IMAGE_WIDTH) : DEFAULT_SCENE.dividerX,
    dividerWidth: Number.isFinite(value?.dividerWidth)
      ? clamp(value.dividerWidth, DIVIDER_MIN_WIDTH, DIVIDER_MAX_WIDTH)
      : DEFAULT_SCENE.dividerWidth,
  };
}
const imageCache = new Map();

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (imageCache.has(url)) return imageCache.get(url);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => {
      imageCache.delete(url);
      reject(new Error(`Could not load ${url}`));
    };
    image.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

function blankPlacement(slot) {
  return { slug: null, fkind: null, zoom: slot.zoom, offsetX: 0, offsetY: 0 };
}

function emptyPlacements() {
  return OG_ROSTER_SLOTS.map((slot) => blankPlacement(slot));
}

function freshPlacements(characters) {
  const picks = shuffledRoster(characters, OG_ROSTER_SLOTS.length);
  return OG_ROSTER_SLOTS.map((slot, index) => {
    const character = picks[index];
    return {
      ...blankPlacement(slot),
      slug: character?.slug || null,
      fkind: Number.isInteger(character?.fkind) ? character.fkind : null,
    };
  });
}

function validLogoPlacement(value) {
  return {
    x: Number.isFinite(value?.x) ? value.x : DEFAULT_LOGO_PLACEMENT.x,
    y: Number.isFinite(value?.y) ? value.y : DEFAULT_LOGO_PLACEMENT.y,
    width: Number.isFinite(value?.width)
      ? clamp(value.width, LOGO_MIN_WIDTH, LOGO_MAX_WIDTH)
      : DEFAULT_LOGO_PLACEMENT.width,
  };
}

function restoreComposition(characters) {
  const bySlug = new Map(characters.map((character) => [character.slug, character]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved?.placements)) return null;
    const placements = OG_ROSTER_SLOTS.map((slot, index) => {
      const value = saved.placements[index];
      if (!value || !bySlug.has(value.slug)) return blankPlacement(slot);
      const character = bySlug.get(value.slug);
      const bodyModels = availableBodyModels(character);
      const fkind = bodyModels.some((body) => body.fkind === value.fkind)
        ? value.fkind
        : character.fkind;
      return {
        slug: value.slug,
        fkind,
        zoom: Number.isFinite(value.zoom) ? clamp(value.zoom, OG_MIN_ZOOM, OG_MAX_ZOOM) : slot.zoom,
        offsetX: Number.isFinite(value.offsetX) ? clamp(value.offsetX, -MAX_OFFSET_X, MAX_OFFSET_X) : 0,
        offsetY: Number.isFinite(value.offsetY) ? clamp(value.offsetY, -MAX_OFFSET_Y, MAX_OFFSET_Y) : 0,
      };
    });
    return { placements, logoPlacement: validLogoPlacement(saved.logoPlacement), scene: validScene(saved.scene) };
  } catch {
    return null;
  }
}

function drawFighter(context, image, slot, placement) {
  if (!image) return;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const frame = fighterFrame(slot, placement, sourceWidth, sourceHeight);
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height);
}

function drawBackdrop(context, image, scene = DEFAULT_SCENE) {
  if (scene.backdrop === "band") {
    context.fillStyle = validColor(scene.bandColor, DEFAULT_SCENE.bandColor);
    context.fillRect(0, 0, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT);
    const width = scene.dividerWidth ?? DEFAULT_SCENE.dividerWidth;
    if (width > 0) {
      context.fillStyle = "#000";
      context.fillRect((scene.dividerX ?? DEFAULT_SCENE.dividerX) - width / 2, 0, width, OG_IMAGE_HEIGHT);
    }
    return;
  }
  context.fillStyle = "#9ccde6";
  context.fillRect(0, 0, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT);

  if (image) {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const scale = Math.max(OG_IMAGE_WIDTH / sourceWidth, OG_IMAGE_HEIGHT / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(image, (OG_IMAGE_WIDTH - width) / 2, (OG_IMAGE_HEIGHT - height) / 2, width, height);
    context.restore();
  }

}

function logoFrame(placement) {
  const width = placement?.width || DEFAULT_LOGO_PLACEMENT.width;
  return {
    x: placement?.x ?? DEFAULT_LOGO_PLACEMENT.x,
    y: placement?.y ?? DEFAULT_LOGO_PLACEMENT.y,
    width,
    height: width * OG_LOGO_RENDER_HEIGHT / OG_LOGO_RENDER_WIDTH,
  };
}

function pointInFrame(x, y, frame) {
  return x >= frame.x && x <= frame.x + frame.width &&
    y >= frame.y && y <= frame.y + frame.height;
}

function frameResizeHandleAtPoint(x, y, frame, radius = 18) {
  const handles = {
    nw: [frame.x, frame.y],
    ne: [frame.x + frame.width, frame.y],
    se: [frame.x + frame.width, frame.y + frame.height],
    sw: [frame.x, frame.y + frame.height],
  };
  for (const [name, [handleX, handleY]] of Object.entries(handles)) {
    if (Math.abs(x - handleX) <= radius && Math.abs(y - handleY) <= radius) return name;
  }
  return null;
}

function drawLogo(context, image, placement) {
  if (!image) return;
  const frame = logoFrame(placement);
  context.save();
  context.shadowColor = "rgba(50,20,0,.48)";
  context.shadowBlur = 11;
  context.shadowOffsetY = 5;
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height);
  context.restore();
}

function drawSelection(context, frame) {
  const handleSize = 16;
  const corners = [
    [frame.x, frame.y],
    [frame.x + frame.width, frame.y],
    [frame.x + frame.width, frame.y + frame.height],
    [frame.x, frame.y + frame.height],
  ];
  context.save();
  context.strokeStyle = "#ffe45b";
  context.lineWidth = 3;
  context.setLineDash([9, 7]);
  context.strokeRect(frame.x, frame.y, frame.width, frame.height);
  context.setLineDash([]);
  for (const [x, y] of corners) {
    context.fillStyle = "#fffbe7";
    context.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
    context.strokeStyle = "#d59c00";
    context.lineWidth = 3;
    context.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
  }
  context.restore();
}

function fighterImage(character, fkind, scene) {
  const preview = () => renderInGameFighter({ ...character, fkind }).catch(() => null);
  if (scene.renderer !== "engine") return preview();
  // Native VS-card capture (pipeline/og_sprite.py via the dev server): real
  // pose and light rig. Anything that can't render that way (production,
  // no native build) quietly falls back to the three.js preview.
  const url = `/api/og-sprite?slug=${encodeURIComponent(character.slug)}&fkind=${fkind}`;
  return loadImage(url).catch(preview);
}

async function renderArtwork(canvas, {
  placements,
  charactersBySlug,
  logoPlacement,
  scene = DEFAULT_SCENE,
  selectedIndex = -1,
  selectedTarget = null,
  onProgress = null,
}) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT);
  // Engine cutouts are 2x the drawn size; resample them properly.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  let ready = 0;
  const fighterPromises = placements.map((placement) => {
    const character = charactersBySlug.get(placement.slug);
    if (!character) return null;
    const fkind = placement.fkind ?? character.fkind;
    return fighterImage(character, fkind, scene).then((image) => {
      ready += 1;
      onProgress?.(ready);
      return image;
    });
  });
  const [background, logo, ...fighters] = await Promise.all([
    loadImage(prebattleSkyUrl).catch(() => null),
    renderGameLogo().catch(() => loadImage(logoFallbackUrl).catch(() => null)),
    ...fighterPromises,
  ]);
  drawBackdrop(context, background, scene);
  placements.forEach((placement, index) => {
    drawFighter(context, fighters[index], OG_ROSTER_SLOTS[index], placement);
  });
  drawLogo(context, logo, logoPlacement);
  if (selectedTarget === "fighter" && selectedIndex >= 0 && placements[selectedIndex]) {
    drawSelection(context, fighterFrame(OG_ROSTER_SLOTS[selectedIndex], placements[selectedIndex]));
  } else if (selectedTarget === "logo") {
    drawSelection(context, logoFrame(logoPlacement));
  }
}

function downloadCanvas(canvas) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `smash-fun-og-${new Date().toISOString().slice(0, 10)}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function pointOnCanvas(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * OG_IMAGE_WIDTH / bounds.width,
    y: (event.clientY - bounds.top) * OG_IMAGE_HEIGHT / bounds.height,
  };
}

function resizeCursor(handle) {
  return handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";
}

function oppositeCorner(frame, handle) {
  return {
    x: handle.includes("w") ? frame.x + frame.width : frame.x,
    y: handle.includes("n") ? frame.y + frame.height : frame.y,
  };
}


export default function OgStudio() {
  const canvasRef = useRef(null);
  const interactionRef = useRef(null);
  const renderVersionRef = useRef(0);
  const [characters, setCharacters] = useState([]);
  const [placements, setPlacements] = useState([]);
  const [logoPlacement, setLogoPlacement] = useState({ ...DEFAULT_LOGO_PLACEMENT });
  const [scene, setScene] = useState({ ...DEFAULT_SCENE });
  const [renderProgress, setRenderProgress] = useState(0);
  const [pickerOpenToken, setPickerOpenToken] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(OG_ROSTER_SLOTS.length - 1);
  const [selectedTarget, setSelectedTarget] = useState("fighter");
  const [status, setStatus] = useState("Loading your roster…");
  const [exporting, setExporting] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const charactersBySlug = useMemo(
    () => new Map(characters.map((character) => [character.slug, character])),
    [characters],
  );
  const selectedPlacement = placements[selectedIndex];
  const selectedCharacter = charactersBySlug.get(selectedPlacement?.slug);
  const selectedBodyModels = useMemo(
    () => availableBodyModels(selectedCharacter),
    [selectedCharacter],
  );

  useEffect(() => {
    document.title = "Open Graph Studio · Smash.fun";
    let cancelled = false;
    fetch("/api/characters", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the fighter roster");
        return response.json();
      })
      .then(({ characters: loaded }) => {
        if (cancelled) return;
        const roster = Array.isArray(loaded) ? loaded : [];
        const restored = restoreComposition(roster);
        setCharacters(roster);
        // A new draft starts empty; positions fill as fighters are added.
        setPlacements(restored?.placements || emptyPlacements());
        setLogoPlacement(restored?.logoPlacement || { ...DEFAULT_LOGO_PLACEMENT });
        setScene(restored?.scene || { ...DEFAULT_SCENE });
        setStatus(roster.length ? "" : "No generated fighters are available yet.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!placements.length || !canvasRef.current) return;
    const version = ++renderVersionRef.current;
    setModelsLoading(true);
    setRenderProgress(0);
    Promise.resolve(document.fonts?.ready).then(async () => {
      if (version !== renderVersionRef.current) return;
      const buffer = document.createElement("canvas");
      buffer.width = OG_IMAGE_WIDTH;
      buffer.height = OG_IMAGE_HEIGHT;
      await renderArtwork(buffer, {
        placements,
        charactersBySlug,
        logoPlacement,
        scene,
        selectedIndex,
        selectedTarget,
        onProgress: (ready) => {
          if (version === renderVersionRef.current) setRenderProgress(ready);
        },
      });
      if (version !== renderVersionRef.current || !canvasRef.current) return;
      const context = canvasRef.current.getContext("2d");
      context.clearRect(0, 0, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT);
      context.drawImage(buffer, 0, 0);
      setModelsLoading(false);
    }).catch((error) => {
      if (version !== renderVersionRef.current) return;
      setModelsLoading(false);
      setStatus(error.message || "Could not render the in-game fighters.");
    });
  }, [placements, charactersBySlug, logoPlacement, scene, selectedIndex, selectedTarget]);

  useEffect(() => {
    if (!placements.length) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ placements, logoPlacement, scene }));
  }, [placements, logoPlacement, scene]);

  function updateSelected(changes) {
    setPlacements((current) => current.map((placement, index) => (
      index === selectedIndex ? { ...placement, ...changes } : placement
    )));
  }

  function randomizeAll() {
    setPlacements(freshPlacements(characters));
    setStatus("A fresh, non-repeating roster is on stage.");
  }

  function clearAll() {
    setPlacements(emptyPlacements());
    setSelectedTarget("fighter");
    setSelectedIndex(0);
    setStatus("Stage cleared.");
  }

  const placedCount = placements.filter((placement) => placement.slug).length;
  const firstEmptyIndex = placements.findIndex((placement) => !placement.slug);

  // Select the next free position and open the picker there.
  function addFighter() {
    if (firstEmptyIndex < 0) return;
    setSelectedTarget("fighter");
    setSelectedIndex(firstEmptyIndex);
    setPickerOpenToken((token) => token + 1);
  }

  function removeSelected() {
    if (!selectedPlacement?.slug) return;
    setPlacements((current) => current.map((placement, index) => (
      index === selectedIndex ? blankPlacement(OG_ROSTER_SLOTS[index]) : placement
    )));
  }

  function chooseSelectedCharacter(character) {
    updateSelected({ slug: character.slug, fkind: character.fkind });
  }

  async function exportPng() {
    setExporting(true);
    setStatus("Rendering full-resolution PNG…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OG_IMAGE_WIDTH;
      canvas.height = OG_IMAGE_HEIGHT;
      await renderArtwork(canvas, { placements, charactersBySlug, logoPlacement, scene });
      downloadCanvas(canvas);
      setStatus("Downloaded a 1200 × 630 PNG.");
    } catch (error) {
      setStatus(`${error.message}. Check fighter-bundle CORS settings if this only fails in production.`);
    } finally {
      setExporting(false);
    }
  }

  function beginCanvasInteraction(event) {
    if (event.button !== 0) return;
    const canvas = event.currentTarget;
    const point = pointOnCanvas(canvas, event);
    const selectedSlot = OG_ROSTER_SLOTS[selectedIndex];
    const currentFrame = selectedTarget === "logo"
      ? logoFrame(logoPlacement)
      : selectedPlacement && selectedSlot
        ? fighterFrame(selectedSlot, selectedPlacement)
        : null;
    const selectedHandle = currentFrame
      ? frameResizeHandleAtPoint(point.x, point.y, currentFrame)
      : null;

    let target = selectedHandle ? selectedTarget : null;
    let index = selectedIndex;
    if (!target && pointInFrame(point.x, point.y, logoFrame(logoPlacement))) {
      target = "logo";
    } else if (!target) {
      index = fighterSlotAtPoint(point.x, point.y, placements);
      if (index >= 0) target = "fighter";
    }
    if (!target || (target === "fighter" && index < 0)) return;

    event.preventDefault();
    const placement = target === "logo" ? logoPlacement : placements[index];
    const frame = target === "logo"
      ? logoFrame(placement)
      : fighterFrame(OG_ROSTER_SLOTS[index], placement);
    interactionRef.current = {
      anchor: selectedHandle ? oppositeCorner(frame, selectedHandle) : null,
      frame,
      handle: selectedHandle,
      index,
      placement: { ...placement },
      pointerId: event.pointerId,
      start: point,
      target,
    };
    setSelectedTarget(target);
    if (target === "fighter") setSelectedIndex(index);
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = selectedHandle ? resizeCursor(selectedHandle) : "grabbing";
  }

  function moveCanvasPointer(event) {
    const canvas = event.currentTarget;
    const point = pointOnCanvas(canvas, event);
    const interaction = interactionRef.current;

    if (!interaction || interaction.pointerId !== event.pointerId) {
      const slot = OG_ROSTER_SLOTS[selectedIndex];
      const frame = selectedTarget === "logo"
        ? logoFrame(logoPlacement)
        : selectedPlacement && slot
          ? fighterFrame(slot, selectedPlacement)
          : null;
      const handle = frame
        ? frameResizeHandleAtPoint(point.x, point.y, frame)
        : null;
      canvas.style.cursor = handle
        ? resizeCursor(handle)
        : pointInFrame(point.x, point.y, logoFrame(logoPlacement)) ||
            fighterSlotAtPoint(point.x, point.y, placements) >= 0
          ? "grab"
          : "default";
      return;
    }

    event.preventDefault();
    if (interaction.target === "logo") {
      if (!interaction.handle) {
        setLogoPlacement({
          ...interaction.placement,
          x: interaction.placement.x + point.x - interaction.start.x,
          y: interaction.placement.y + point.y - interaction.start.y,
        });
        return;
      }

      const { anchor, frame, handle, placement } = interaction;
      const startDistance = Math.hypot(frame.width, frame.height);
      const pointerDistance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
      const width = clamp(
        placement.width * pointerDistance / startDistance,
        LOGO_MIN_WIDTH,
        LOGO_MAX_WIDTH,
      );
      const height = width * OG_LOGO_RENDER_HEIGHT / OG_LOGO_RENDER_WIDTH;
      setLogoPlacement({
        width,
        x: handle.includes("w") ? anchor.x - width : anchor.x,
        y: handle.includes("n") ? anchor.y - height : anchor.y,
      });
      return;
    }

    const slot = OG_ROSTER_SLOTS[interaction.index];
    if (!interaction.handle) {
      const offsetX = clamp(
        interaction.placement.offsetX + (point.x - interaction.start.x) / (slot.width * .16),
        -MAX_OFFSET_X,
        MAX_OFFSET_X,
      );
      const offsetY = clamp(
        interaction.placement.offsetY + (point.y - interaction.start.y) / (slot.height * .1),
        -MAX_OFFSET_Y,
        MAX_OFFSET_Y,
      );
      setPlacements((current) => current.map((placement, index) => (
        index === interaction.index ? { ...placement, offsetX, offsetY } : placement
      )));
      return;
    }

    const { anchor, frame, handle, placement } = interaction;
    const startDistance = Math.hypot(frame.width, frame.height);
    const pointerDistance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    const zoom = clamp(placement.zoom * pointerDistance / startDistance, OG_MIN_ZOOM, OG_MAX_ZOOM);
    const width = slot.height * .75 * zoom;
    const height = slot.height * zoom;
    const x = handle.includes("w") ? anchor.x - width : anchor.x;
    const y = handle.includes("n") ? anchor.y - height : anchor.y;
    const baseX = slot.x + (slot.width - width) / 2;
    const baseY = slot.y + (slot.height - height) / 2;
    const offsetX = clamp((x - baseX) / (slot.width * .16), -MAX_OFFSET_X, MAX_OFFSET_X);
    const offsetY = clamp((y - baseY) / (slot.height * .1), -MAX_OFFSET_Y, MAX_OFFSET_Y);
    setPlacements((current) => current.map((currentPlacement, index) => (
      index === interaction.index ? { ...currentPlacement, zoom, offsetX, offsetY } : currentPlacement
    )));
  }

  function endCanvasInteraction(event) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.style.cursor = "grab";
  }

  return (
    <main className="og-studio">
      <header className="og-studio-header">
        <div>
          <a href="/" className="og-studio-wordmark">SMASH<span>.FUN</span></a>
          <span className="og-studio-slash">/</span>
          <p>Open Graph Studio</p>
        </div>
        <div className="og-studio-header-actions">
          <button className="og-button og-button-muted" type="button" onClick={addFighter} disabled={!characters.length || firstEmptyIndex < 0}>
            Add fighter
          </button>
          <button className="og-button og-button-muted" type="button" onClick={randomizeAll} disabled={!characters.length}>
            Fill randomly
          </button>
          <button className="og-button og-button-muted" type="button" onClick={clearAll} disabled={!placedCount}>
            Clear
          </button>
          <button className="og-button og-button-primary" type="button" onClick={exportPng} disabled={!placements.length || exporting}>
            {exporting ? "Rendering…" : "Download PNG"}
          </button>
        </div>
      </header>

      <section className="og-studio-intro">
        <div>
          <p className="og-eyebrow">Social artwork · 1200 × 630</p>
          <h1>Build the whole crew.</h1>
        </div>
        <p>Choose a fighter and body model, or select the 3D logo. Drag and resize every object directly on the canvas; your draft saves automatically.</p>
      </section>

      <div className="og-studio-layout">
        <section className="og-stage-panel" aria-label="Open Graph image preview">
          <div className="og-stage-toolbar">
            <div><i className={modelsLoading ? "is-loading" : undefined} /> {modelsLoading
              ? (scene.renderer === "engine"
                ? `Rendering in engine · ${renderProgress}/${placements.filter((placement) => placement.slug).length}`
                : "Rendering game models")
              : "Live composition"}</div>
            <span>Drag to move · drag a corner to resize</span>
          </div>
          <div className="og-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={OG_IMAGE_WIDTH}
              height={OG_IMAGE_HEIGHT}
              onPointerDown={beginCanvasInteraction}
              onPointerMove={moveCanvasPointer}
              onPointerUp={endCanvasInteraction}
              onPointerCancel={endCanvasInteraction}
              onPointerLeave={(event) => {
                if (!interactionRef.current) event.currentTarget.style.cursor = "default";
              }}
              aria-label="Editable Open Graph roster preview"
            />
          </div>
          <div className="og-stage-meta">
            <span>{characters.length ? `${placedCount}/${OG_ROSTER_SLOTS.length} positions filled · ${characters.length.toLocaleString()} fighters available` : status}</span>
            {status && characters.length ? <output aria-live="polite">{status}</output> : null}
          </div>
        </section>

        <aside className="og-control-panel">
          <section className="og-control-section">
            <div className="og-target-tabs" role="tablist" aria-label="Canvas object type">
              <button
                className={selectedTarget === "fighter" ? "is-active" : undefined}
                type="button"
                role="tab"
                aria-selected={selectedTarget === "fighter"}
                onClick={() => setSelectedTarget("fighter")}
              >Fighter</button>
              <button
                className={selectedTarget === "logo" ? "is-active" : undefined}
                type="button"
                role="tab"
                aria-selected={selectedTarget === "logo"}
                onClick={() => setSelectedTarget("logo")}
              >3D logo</button>
            </div>
            <div className="og-section-title">
              <div>
                <span>Selected object</span>
                <h2>{selectedTarget === "logo" ? "Smash.fun logo" : OG_ROSTER_SLOTS[selectedIndex]?.label}</h2>
              </div>
              {selectedTarget === "fighter" ? (
                <div className="og-stepper">
                  <button type="button" aria-label="Previous position" onClick={() => setSelectedIndex((selectedIndex - 1 + OG_ROSTER_SLOTS.length) % OG_ROSTER_SLOTS.length)}>←</button>
                  <b>{selectedIndex + 1}/{OG_ROSTER_SLOTS.length}</b>
                  <button type="button" aria-label="Next position" onClick={() => setSelectedIndex((selectedIndex + 1) % OG_ROSTER_SLOTS.length)}>→</button>
                </div>
              ) : null}
            </div>
            {selectedTarget === "fighter" ? (
              <>
                <div className="og-model-controls">
                  <SearchableFighterSelect
                    characters={characters}
                    selected={selectedCharacter}
                    onSelect={chooseSelectedCharacter}
                    openToken={pickerOpenToken}
                  />
                  <label className="og-field og-body-select">
                    <span>Body model</span>
                    <select
                      value={selectedPlacement?.fkind ?? selectedCharacter?.fkind ?? ""}
                      disabled={!selectedBodyModels.length}
                      onChange={(event) => updateSelected({ fkind: Number(event.target.value) })}
                    >
                      {selectedBodyModels.map((body) => (
                        <option value={body.fkind} key={body.value}>{body.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="og-range-grid">
                  <label>
                    <span>Zoom <output>{selectedPlacement?.zoom?.toFixed(2) || "—"}×</output></span>
                    <input type="range" min={OG_MIN_ZOOM} max={OG_MAX_ZOOM} step=".01" value={selectedPlacement?.zoom || 1} onChange={(event) => updateSelected({ zoom: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>Horizontal <output>{Math.round((selectedPlacement?.offsetX || 0) * (OG_ROSTER_SLOTS[selectedIndex]?.width || 0) * .16)} px</output></span>
                    <input type="range" min={-MAX_OFFSET_X} max={MAX_OFFSET_X} step=".01" value={selectedPlacement?.offsetX || 0} onChange={(event) => updateSelected({ offsetX: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>Vertical <output>{Math.round((selectedPlacement?.offsetY || 0) * (OG_ROSTER_SLOTS[selectedIndex]?.height || 0) * .1)} px</output></span>
                    <input type="range" min={-MAX_OFFSET_Y} max={MAX_OFFSET_Y} step=".01" value={selectedPlacement?.offsetY || 0} onChange={(event) => updateSelected({ offsetY: Number(event.target.value) })} />
                  </label>
                </div>
                <div className="og-slot-actions">
                  <button className="og-reset-framing" type="button" onClick={() => updateSelected({
                    zoom: OG_ROSTER_SLOTS[selectedIndex].zoom,
                    offsetX: 0,
                    offsetY: 0,
                  })}>
                    Reset framing
                  </button>
                  <button className="og-reset-framing og-remove-fighter" type="button" onClick={removeSelected} disabled={!selectedPlacement?.slug}>
                    Remove from stage
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="og-logo-help">Drag the logo on the canvas or pull any corner to resize it proportionally.</p>
                <div className="og-range-grid">
                  <label>
                    <span>Width <output>{Math.round(logoPlacement.width)} px</output></span>
                    <input type="range" min={LOGO_MIN_WIDTH} max={LOGO_MAX_WIDTH} step="1" value={logoPlacement.width} onChange={(event) => setLogoPlacement((current) => ({ ...current, width: Number(event.target.value) }))} />
                  </label>
                  <label>
                    <span>Horizontal <output>{Math.round(logoPlacement.x)} px</output></span>
                    <input type="range" min={-LOGO_MAX_WIDTH} max={OG_IMAGE_WIDTH} step="1" value={logoPlacement.x} onChange={(event) => setLogoPlacement((current) => ({ ...current, x: Number(event.target.value) }))} />
                  </label>
                  <label>
                    <span>Vertical <output>{Math.round(logoPlacement.y)} px</output></span>
                    <input type="range" min={-OG_IMAGE_HEIGHT} max={OG_IMAGE_HEIGHT} step="1" value={logoPlacement.y} onChange={(event) => setLogoPlacement((current) => ({ ...current, y: Number(event.target.value) }))} />
                  </label>
                </div>
                <button className="og-reset-framing" type="button" onClick={() => setLogoPlacement({ ...DEFAULT_LOGO_PLACEMENT })}>
                  Reset logo
                </button>
              </>
            )}
          </section>

          <section className="og-control-section">
            <div className="og-section-kicker">Scene</div>
            <div className="og-scene-controls">
              <label className="og-field og-body-select">
                <span>Backdrop</span>
                <select value={scene.backdrop} onChange={(event) => setScene((current) => ({ ...current, backdrop: event.target.value }))}>
                  {BACKDROPS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="og-field og-body-select">
                <span>Fighters</span>
                <select value={scene.renderer} onChange={(event) => setScene((current) => ({ ...current, renderer: event.target.value }))}>
                  {RENDERERS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            {scene.backdrop === "band" ? (
              <div className="og-band-colour" role="group" aria-label="Band colour">
                {BAND_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.value}
                    type="button"
                    className={scene.bandColor === swatch.value ? "is-active" : undefined}
                    style={{ background: swatch.value }}
                    title={swatch.label}
                    aria-label={swatch.label}
                    aria-pressed={scene.bandColor === swatch.value}
                    onClick={() => setScene((current) => ({ ...current, bandColor: swatch.value }))}
                  />
                ))}
                <label>
                  <input
                    type="color"
                    value={scene.bandColor}
                    onChange={(event) => setScene((current) => ({ ...current, bandColor: event.target.value }))}
                  />
                  <span>{scene.bandColor}</span>
                </label>
              </div>
            ) : null}
            {scene.backdrop === "band" ? (
              <div className="og-range-grid">
                <label>
                  <span>Divider position <output>{Math.round(scene.dividerX)} px</output></span>
                  <input type="range" min="0" max={OG_IMAGE_WIDTH} step="1" value={scene.dividerX} onChange={(event) => setScene((current) => ({ ...current, dividerX: Number(event.target.value) }))} />
                </label>
                <label>
                  <span>Divider width <output>{Math.round(scene.dividerWidth)} px</output></span>
                  <input type="range" min={DIVIDER_MIN_WIDTH} max={DIVIDER_MAX_WIDTH} step="1" value={scene.dividerWidth} onChange={(event) => setScene((current) => ({ ...current, dividerWidth: Number(event.target.value) }))} />
                </label>
              </div>
            ) : null}
            <p className="og-scene-help">In-engine renders boot the native game once per fighter (~15 s each, cached); anything it can't render falls back to the quick preview.</p>
          </section>

          <section className="og-control-section og-export-controls">
            <div>
              <div className="og-section-kicker">Open Graph export</div>
              <p>Exact 1200 × 630 PNG. Selection handles are never included.</p>
            </div>
            <button
              className="og-button og-button-primary og-save-button"
              type="button"
              onClick={exportPng}
              disabled={!placements.length || exporting}
            >
              {exporting ? "Rendering 1200 × 630…" : "Save PNG · 1200 × 630"}
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
