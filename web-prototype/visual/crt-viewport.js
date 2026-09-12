import { compileProgramAsync } from '../shared/shader-compilation.js';

const canvas = document.getElementById('crt-viewport-canvas');
const tuner = document.getElementById('crt-tuner');
const requestedPreset = new URLSearchParams(location.search).get('crt') ?? window.__opensmashCrt ?? null;
const storageKey = 'opensmash.crt-tuning.v1';

const strongPreset = Object.freeze({
  enabled: true,
  intensity: 1.08,
  compositeBlur: 0.52,
  saturation: 1.18,
  contrast: 1.07,
  brightness: 1.04,
  scanlineStrength: 0.138,
  scanlineSpacing: 4,
  grilleStrength: 0.04,
  vignetteStrength: 0.22,
  bezelStrength: 0.96,
  cornerRadius: 0.042,
  noiseStrength: 0.032,
  flickerStrength: 0.018,
  rollingStrength: 0.038,
  motionSpeed: 1,
});

const softPreset = Object.freeze({
  enabled: true,
  intensity: 0.72,
  compositeBlur: 0,
  saturation: 1.08,
  contrast: 1.03,
  brightness: 1.02,
  scanlineStrength: 0.074,
  scanlineSpacing: 4,
  grilleStrength: 0.02,
  vignetteStrength: 0.135,
  bezelStrength: 0.76,
  cornerRadius: 0.032,
  noiseStrength: 0.014,
  flickerStrength: 0.007,
  rollingStrength: 0.016,
  motionSpeed: 0.72,
});

const ranges = Object.freeze({
  intensity: [0, 1.5],
  compositeBlur: [0, 1.5],
  saturation: [0.5, 1.8],
  contrast: [0.6, 1.6],
  brightness: [0.6, 1.5],
  scanlineStrength: [0, 0.32],
  scanlineSpacing: [2, 9],
  grilleStrength: [0, 0.12],
  vignetteStrength: [0, 0.9],
  bezelStrength: [0, 1],
  cornerRadius: [0.005, 0.16],
  noiseStrength: [0, 0.1],
  flickerStrength: [0, 0.08],
  rollingStrength: [0, 0.12],
  motionSpeed: [0, 2],
});

const valueFormatters = {
  intensity: (value) => `${value.toFixed(2)}x`,
  compositeBlur: (value) => `${value.toFixed(2)}px`,
  saturation: (value) => `${value.toFixed(2)}x`,
  contrast: (value) => `${value.toFixed(2)}x`,
  brightness: (value) => `${value.toFixed(2)}x`,
  scanlineSpacing: (value) => `${value.toFixed(1)}px`,
  motionSpeed: (value) => `${value.toFixed(2)}x`,
};

function clampSetting(key, value) {
  if (key === 'enabled') return Boolean(value);
  if (!ranges[key]) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(ranges[key][1], Math.max(ranges[key][0], number));
}

function sanitizeSettings(candidate) {
  if (!candidate || typeof candidate !== 'object') return {};
  const safe = {};
  Object.keys(strongPreset).forEach((key) => {
    if (!Object.hasOwn(candidate, key)) return;
    const value = clampSetting(key, candidate[key]);
    if (value !== undefined) safe[key] = value;
  });
  return safe;
}

function loadStoredSettings() {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(storageKey) || 'null'));
  } catch {
    return {};
  }
}

let activePreset = requestedPreset === 'soft' ? 'soft' : 'strong';
let settings = requestedPreset === 'soft'
  ? { ...softPreset }
  : requestedPreset === 'strong'
    ? { ...strongPreset }
    : { ...strongPreset, ...loadStoredSettings() };

// `?demo=1` (App sets the global before this module loads): filter off for
// the session without touching the stored preference; `?crt=` still wins.
const demoSession = window.__opensmashDemo === true && requestedPreset == null;
if (requestedPreset === 'off' || demoSession) settings.enabled = false;

function persistSettings() {
  if (demoSession) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // The shader remains fully usable when storage is unavailable.
  }
}

function formatValue(key, value) {
  if (valueFormatters[key]) return valueFormatters[key](value);
  if (value < 0.1) return value.toFixed(3);
  return value.toFixed(2);
}

function syncTuner() {
  if (!tuner) return;
  tuner.querySelectorAll('[data-crt-setting]').forEach((input) => {
    const key = input.dataset.crtSetting;
    if (!(key in settings)) return;
    if (input.type === 'checkbox') input.checked = settings[key];
    else input.value = settings[key];
  });
  tuner.querySelectorAll('[data-crt-value]').forEach((output) => {
    const key = output.dataset.crtValue;
    if (typeof settings[key] === 'number') {
      output.value = formatValue(key, settings[key]);
    }
  });
  tuner.dataset.crtPreset = activePreset;
}

if (!canvas) {
  if (tuner) tuner.hidden = true;
} else {
  let gl = null;
  let uniforms = null;
  let ready = false;
  let initialization = null;
  let unavailable = false;
  canvas.hidden = true;
  canvas.style.display = 'none';
  canvas.dataset.crtPreset = activePreset;

  function ensureRenderer() {
    if (initialization) return initialization;
    canvas.dataset.crtState = 'compiling';
    initialization = initializeRenderer().then(() => {
      ready = true;
      canvas.dataset.crtActive = 'true';
      canvas.dataset.crtState = 'ready';
      // The user may have disabled the effect while compilation was pending.
      setEnabled(settings.enabled);
    }).catch(error => {
      unavailable = true;
      canvas.dataset.crtState = 'failed';
      canvas.hidden = true;
      canvas.style.display = 'none';
      if (tuner) {
        tuner.dataset.crtUnavailable = 'true';
        tuner.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
      }
      console.error('Could not prepare CRT viewport shaders', error);
    });
    return initialization;
  }

  async function initializeRenderer() {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // Safari and Chromium disagree when a transparent WebGL canvas with
      // straight-alpha color is promoted into a backdrop-filtered compositor
      // layer. Keep the default framebuffer premultiplied and write matching
      // premultiplied color below so the phosphor mask blends identically.
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
    if (!gl) throw new Error('WebGL is unavailable');
    const vertexSource = `
      attribute vec2 position;
      varying vec2 vUv;

      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fragmentSource = `
      precision highp float;

      uniform float pixelRatio;
      uniform float time;
      uniform float intensity;
      uniform float scanlineStrength;
      uniform float scanlineSpacing;
      uniform float grilleStrength;
      uniform float vignetteStrength;
      uniform float bezelStrength;
      uniform float cornerRadius;
      uniform float noiseStrength;
      uniform float flickerStrength;
      uniform float rollingStrength;
      uniform float motionSpeed;
      varying vec2 vUv;

      float hash21(vec2 point) {
        point = fract(point * vec2(123.34, 456.21));
        point += dot(point, point + 45.32);
        return fract(point.x * point.y);
      }

      float roundedBoxDistance(vec2 point, vec2 bounds, float radius) {
        vec2 offset = abs(point) - bounds + radius;
        return min(max(offset.x, offset.y), 0.0) +
          length(max(offset, 0.0)) - radius;
      }

      void main() {
        vec2 pixel = gl_FragCoord.xy / pixelRatio;
        vec2 centered = vUv * 2.0 - 1.0;

        // Convex-glass falloff gets heavier toward the tube corners.
        vec2 glassPoint = centered * vec2(0.82, 1.0);
        float radius2 = dot(glassPoint, glassPoint);
        float vignette = smoothstep(0.34, 1.14, radius2);
        vignette *= vignette;

        // The mask is calculated in CSS pixels so it stays visible on Retina.
        float spacing = max(2.0, scanlineSpacing);
        float scanPhase = mod(pixel.y, spacing);
        float scanWidth = max(0.35, spacing * 0.13);
        float rasterLine = exp(-pow((scanPhase - 0.5) / scanWidth, 2.0));
        float fineLine = 0.5 + 0.5 * sin(pixel.y * 3.14159265);
        float scanline = max(rasterLine, fineLine * 0.24);

        // Three-column aperture-grille mask.
        float triad = mod(floor(pixel.x), 3.0);
        vec3 phosphor = triad < 1.0
          ? vec3(0.65, 0.08, 0.04)
          : triad < 2.0
            ? vec3(0.05, 0.58, 0.06)
            : vec3(0.06, 0.12, 0.72);

        float animatedTime = time * motionSpeed;
        float rollingBand = exp(-pow(
          fract(vUv.y + animatedTime * 0.055) - 0.5, 2.0
        ) / 0.0055);
        float noise = hash21(
          floor(pixel * vec2(0.55, 1.0)) + floor(animatedTime * 28.0)
        ) - 0.5;
        float flicker = 1.0 + sin(animatedTime * 43.0) * flickerStrength;

        // Animation only touches the picture signal. Glass and bezel darkness
        // are added afterward, so the corners do not pulse with the flicker.
        float signalDarkness = 0.018 + scanline * scanlineStrength;
        signalDarkness += noise * noiseStrength;
        signalDarkness -= rollingBand * rollingStrength;
        signalDarkness *= flicker;
        float darkness = signalDarkness + vignette * vignetteStrength;

        float tubeDistance = roundedBoxDistance(
          centered, vec2(0.994, 0.988), cornerRadius
        );
        float bezel = smoothstep(-0.006, 0.005, tubeDistance);
        darkness = mix(darkness, bezelStrength, bezel);

        float phosphorAmount = grilleStrength * (0.9 + fineLine * 0.2);
        vec3 overlayColor = phosphor * phosphorAmount /
          max(0.001, darkness + phosphorAmount);
        float overlayAlpha = clamp(
          (darkness + phosphorAmount) * intensity, 0.0, 0.98
        );

        gl_FragColor = vec4(overlayColor * overlayAlpha, overlayAlpha);
      }
    `;

    const program = await compileProgramAsync(gl, vertexSource, fragmentSource);
    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    gl.useProgram(program);
    const positionLocation = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const uniformKeys = [
      'pixelRatio',
      'time',
      'intensity',
      'scanlineStrength',
      'scanlineSpacing',
      'grilleStrength',
      'vignetteStrength',
      'bezelStrength',
      'cornerRadius',
      'noiseStrength',
      'flickerStrength',
      'rollingStrength',
      'motionSpeed',
    ];
    uniforms = Object.fromEntries(
      uniformKeys.map((key) => [key, gl.getUniformLocation(program, key)]),
    );
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animationFrame = 0;
  // The last drawn frame is final (no animated noise/flicker/roll, the
  // engine focused, or reduced motion): keep it until the viewport changes.
  let renderedStill = false;
  let lastDrawAt = -Infinity;
  // Noise and flicker read the same at 30fps; every redraw makes the
  // compositor re-run the full-viewport backdrop-filter, so halve them.
  const FRAME_INTERVAL_MS = 30;
  let appliedFilter = null;

  function applyCompositeFilter(focusedGame = false) {
    const filter = focusedGame ? 'none' : [
      `blur(${settings.compositeBlur.toFixed(3)}px)`,
      `saturate(${settings.saturation.toFixed(3)})`,
      `contrast(${settings.contrast.toFixed(3)})`,
      `brightness(${settings.brightness.toFixed(3)})`,
    ].join(' ');
    if (filter === appliedFilter) return;
    appliedFilter = filter;
    canvas.style.webkitBackdropFilter = filter;
    canvas.style.backdropFilter = filter;
  }

  function resize() {
    // One shader pixel per CSS pixel keeps the phosphor lattice crisp and
    // avoids a high-DPI full-screen fragment pass becoming needlessly hot.
    const ratio = 1;
    const width = Math.max(1, Math.round(innerWidth * ratio));
    const height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.uniform1f(uniforms.pixelRatio, ratio);
  }

  function render(milliseconds) {
    animationFrame = 0;
    if (!settings.enabled || !ready || unavailable) return;
    const focusedGame = document.body.classList.contains('is-game-running');
    const stillImage = focusedGame || reducedMotion ||
      (settings.noiseStrength <= 0 && settings.flickerStrength <= 0 && settings.rollingStrength <= 0);
    const matchesViewport = canvas.width === Math.max(1, Math.round(innerWidth)) &&
      canvas.height === Math.max(1, Math.round(innerHeight));
    // Focus can change while reduced motion keeps the shader image still.
    // Update compositor state before the still-image early return so a
    // running game never retains the menu's full-screen backdrop filter.
    applyCompositeFilter(focusedGame);
    if (stillImage && renderedStill && matchesViewport) return;
    if (!stillImage && milliseconds - lastDrawAt < FRAME_INTERVAL_MS) {
      animationFrame = requestAnimationFrame(render);
      return;
    }
    lastDrawAt = milliseconds;
    renderedStill = stillImage;
    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uniforms.time, milliseconds * 0.001);
    gl.uniform1f(uniforms.intensity, settings.intensity);
    gl.uniform1f(uniforms.scanlineStrength, settings.scanlineStrength);
    gl.uniform1f(uniforms.scanlineSpacing, settings.scanlineSpacing);
    gl.uniform1f(uniforms.grilleStrength, settings.grilleStrength);
    gl.uniform1f(uniforms.vignetteStrength, settings.vignetteStrength);
    gl.uniform1f(uniforms.bezelStrength, settings.bezelStrength);
    gl.uniform1f(uniforms.cornerRadius, settings.cornerRadius);
    gl.uniform1f(uniforms.noiseStrength, settings.noiseStrength);
    gl.uniform1f(uniforms.flickerStrength, settings.flickerStrength);
    gl.uniform1f(uniforms.rollingStrength, settings.rollingStrength);
    gl.uniform1f(
      uniforms.motionSpeed,
      reducedMotion || focusedGame ? 0 : settings.motionSpeed,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!stillImage) animationFrame = requestAnimationFrame(render);
  }

  function setEnabled(enabled) {
    settings.enabled = Boolean(enabled);
    const visible = settings.enabled && ready && !unavailable;
    canvas.hidden = !visible;
    canvas.style.display = visible ? 'block' : 'none';
    if (visible && !animationFrame) {
      renderedStill = false;
      animationFrame = requestAnimationFrame(render);
    } else if (!visible && animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (settings.enabled && !ready && !unavailable) void ensureRenderer();
  }

  function applySettings(nextSettings, options = {}) {
    settings = { ...settings, ...sanitizeSettings(nextSettings) };
    renderedStill = false;
    if (options.preset) activePreset = options.preset;
    else activePreset = 'custom';
    canvas.dataset.crtPreset = activePreset;
    applyCompositeFilter();
    setEnabled(settings.enabled);
    syncTuner();
    if (options.persist !== false) persistSettings();
  }

  function applyPreset(name, persist = true) {
    const nextPreset = name === 'soft' ? softPreset : strongPreset;
    applySettings(nextPreset, { preset: name, persist });
  }

  if (tuner) {
    tuner.addEventListener('input', (event) => {
      const input = event.target.closest('[data-crt-setting]');
      if (!input) return;
      const key = input.dataset.crtSetting;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      applySettings({ [key]: value });
    });

    tuner.querySelectorAll('[data-crt-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        applyPreset(button.dataset.crtPreset);
      });
    });

    tuner.querySelector('[data-crt-reset]')?.addEventListener('click', () => {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Ignore storage restrictions; in-memory reset still succeeds.
      }
      applyPreset('strong', false);
    });
  }

  window.__crtViewport = {
    canvas,
    presets: { strong: strongPreset, soft: softPreset },
    get preset() { return activePreset; },
    get settings() { return { ...settings }; },
    set settings(value) { applySettings(value); },
    applyPreset,
    reset() {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Ignore storage restrictions; in-memory reset still succeeds.
      }
      applyPreset('strong', false);
    },
    get intensity() { return settings.intensity; },
    set intensity(value) { applySettings({ intensity: value }); },
    get enabled() { return settings.enabled; },
    set enabled(value) { applySettings({ enabled: value }); },
  };

  // A still overlay does not need a display-rate polling loop. Wake it only
  // when its dimensions or game mode change; settings already call setEnabled.
  function invalidateStillImage() {
    renderedStill = false;
    setEnabled(settings.enabled);
  }
  window.addEventListener('resize', invalidateStillImage);
  let observedGameRunning = document.body.classList.contains('is-game-running');
  new MutationObserver(() => {
    const running = document.body.classList.contains('is-game-running');
    if (running === observedGameRunning) return;
    observedGameRunning = running;
    invalidateStillImage();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // The animation loop owns drawing-buffer resizes. Resizing it directly in
  // the DOM resize event clears WebGL before the focused-game frame can be
  // redrawn, and can make the frozen CRT treatment disappear permanently.
  applyCompositeFilter();
  setEnabled(settings.enabled);
  syncTuner();
}
