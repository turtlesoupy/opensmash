// Canonical hardware and background runtime for the production React site.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import cartridgeLabelUrl from './assets/cartridge-label-art.webp?url';
import cartridgeModelUrl from './assets/n64-cartridge-tripo.glb?url';
import consoleModelUrl from './assets/hybrid-four-port-console-fitted.glb?url';
import cursorModelUrl from './assets/hand-cursor-meshy.glb?url';
import tvModelUrl from './assets/tripo-crt-tv.glb?url';
import { controlEmbeddedTrailer } from '../src/embedded-trailer.js';
import stoneBackgroundUrl from './assets/stone-background.png?url';

const CARTRIDGE_INTRO_ENABLED =
  document.documentElement.classList.contains('is-cartridge-intro');
// The launch flow (game-launcher.js) loads the same cartridge/console/label
// files through its own loaders; share one in-memory copy instead of
// racing the HTTP cache for a second download of each.
THREE.Cache.enabled = true;
function ensureStoneBackground() {
  // Baked by scripts/generate-stone-background.mjs from the same fixed seed.
  // Ranking 96 procedural candidates here blocked input during every startup.
  document.body.style.setProperty('--stone-background-image', `url("${stoneBackgroundUrl}")`);
}

// ---------------------------------------------------------------------------
// Renderer / scene — transparent overlay canvas above the page.
// ---------------------------------------------------------------------------
const canvas = document.getElementById('glove-canvas');
const customCursorQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
let customCursorMeshReady = false;
let customCursorHasPosition = false;
let webglContextAvailable = false;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
webglContextAvailable = true;
renderer.setPixelRatio(1);

const godRayLayer = document.getElementById('hardware-god-ray');
const godRayOuter = document.getElementById('god-ray-outer');
const godRayMiddle = document.getElementById('god-ray-middle');
const godRayCore = document.getElementById('god-ray-core');
const godRayCartridgeHalo = document.getElementById('god-ray-cartridge-halo');
const godRayConsoleHaze = document.getElementById('god-ray-console-haze');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 16);
const cameraRestPosition = camera.position.clone();
const cameraRestQuaternion = camera.quaternion.clone();

scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9aa8, 0.4));

// The embedded trailer is the main-page hero. The optional pre-boot hardware
// CRT uses a dark placeholder because cross-origin embeds cannot be WebGL textures.
const mainHardwareTvRig = new THREE.Group();
const mainHardwareTvVisual = new THREE.Group();
const starterTvDisplay = new THREE.Group();
starterTvDisplay.rotation.set(-0.025, -0.065, 0);
mainHardwareTvVisual.add(starterTvDisplay);
mainHardwareTvRig.add(mainHardwareTvVisual);
scene.add(mainHardwareTvRig);
mainHardwareTvRig.visible = CARTRIDGE_INTRO_ENABLED;
let mainHardwareTvUnitH = 0;

// ---------------------------------------------------------------------------
// Starter-screen Trinitron: a Tripo-generated cabinet with a curved CRT surface.
// ---------------------------------------------------------------------------
const introVideo = document.getElementById('intro-video');
const soundToggle = document.getElementById('sound-toggle');
const soundToggleState = document.getElementById('sound-toggle-state');
const advancedControl = document.getElementById('advanced-control');
const crtTuner = document.getElementById('crt-tuner');
const embeddedGameFrame = document.getElementById('intro-game-frame');
const SOUND_STORAGE_KEY = 'opensmash-sound';
let soundOn = true;

try { soundOn = localStorage.getItem(SOUND_STORAGE_KEY) !== 'off'; }
catch { /* Sound remains on when preferences cannot be persisted. */ }

function syncEmbeddedGameAudio(attempt = 0) {
  try {
    const audioContext = embeddedGameFrame?.contentWindow?.Module?.SDL2?.audioContext;
    if (audioContext) {
      const update = soundOn ? audioContext.resume() : audioContext.suspend();
      update?.catch(() => {});
      return;
    }
  } catch { /* The frame may still be navigating. */ }
  if (attempt < 40 && embeddedGameFrame?.src !== 'about:blank') {
    window.setTimeout(() => syncEmbeddedGameAudio(attempt + 1), 250);
  }
}

function applySoundPreference() {
  controlEmbeddedTrailer(introVideo, soundOn ? 'unMute' : 'mute');
  window.openSmashSoundOn = soundOn;
  if (soundToggle) soundToggle.setAttribute('aria-pressed', String(soundOn));
  if (soundToggleState) soundToggleState.textContent = soundOn ? 'On' : 'Off';
  syncEmbeddedGameAudio();
}

soundToggle?.addEventListener('click', () => {
  soundOn = !soundOn;
  try { localStorage.setItem(SOUND_STORAGE_KEY, soundOn ? 'on' : 'off'); }
  catch { /* The current preference still applies for this session. */ }
  applySoundPreference();
  if (soundOn) controlEmbeddedTrailer(introVideo, 'playVideo');
});
embeddedGameFrame?.addEventListener('load', () => syncEmbeddedGameAudio());
applySoundPreference();

function syncAdvancedControl() {
  advancedControl?.setAttribute(
    'aria-expanded', String(Boolean(crtTuner && !crtTuner.hidden && crtTuner.open))
  );
}

advancedControl?.addEventListener('click', () => {
  if (!crtTuner) return;
  const willOpen = crtTuner.hidden || !crtTuner.open;
  crtTuner.hidden = !willOpen;
  crtTuner.open = willOpen;
  syncAdvancedControl();
  if (willOpen) crtTuner.querySelector('summary')?.focus();
});
crtTuner?.addEventListener('toggle', () => {
  if (!crtTuner.open) crtTuner.hidden = true;
  syncAdvancedControl();
});
syncAdvancedControl();

const tvCabinetMaterial = new THREE.MeshStandardMaterial({
  color: 0x444748,
  roughness: 0.68,
  metalness: 0.08,
});
const introVideoTexture = new THREE.DataTexture(
  new Uint8Array([2, 2, 2, 255]),
  1,
  1,
  THREE.RGBAFormat,
);
introVideoTexture.colorSpace = THREE.SRGBColorSpace;
introVideoTexture.minFilter = THREE.LinearFilter;
introVideoTexture.magFilter = THREE.LinearFilter;
introVideoTexture.generateMipmaps = false;
introVideoTexture.needsUpdate = true;

const crtScreenMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: true,
  toneMapped: false,
  uniforms: {
    videoMap: { value: introVideoTexture },
    time: { value: 0 },
    videoResolution: { value: new THREE.Vector2(1280, 960) },
    screenAspect: { value: 1.48 },
    videoAspect: { value: 4 / 3 },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormalView;
    void main() {
      vUv = uv;
      vNormalView = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D videoMap;
    uniform float time;
    uniform vec2 videoResolution;
    uniform float screenAspect;
    uniform float videoAspect;
    varying vec2 vUv;
    varying vec3 vNormalView;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 centered = vUv * 2.0 - 1.0;
      vec2 rounded = abs(centered) - vec2(0.925, 0.89);
      float roundedDistance = length(max(rounded, 0.0)) +
        min(max(rounded.x, rounded.y), 0.0) - 0.075;
      float edgeAlpha = 1.0 - smoothstep(-0.012, 0.006, roundedDistance);
      if (edgeAlpha <= 0.001) discard;

      float radius2 = dot(centered, centered);
      vec2 curved = centered * (1.0 + radius2 * 0.055);
      vec2 uv = curved * 0.5 + 0.5;

      float aspectScale = screenAspect / videoAspect;
      uv.y = (uv.y - 0.5) * aspectScale + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(vec3(0.003), edgeAlpha);
        return;
      }

      float aberration = 0.0013 + radius2 * 0.0011;
      float red = texture2D(videoMap, uv + vec2(aberration, 0.0)).r;
      float green = texture2D(videoMap, uv).g;
      float blue = texture2D(videoMap, uv - vec2(aberration, 0.0)).b;
      vec3 color = vec3(red, green, blue);

      float sourceLine = uv.y * videoResolution.y;
      float scanline = 0.86 + 0.14 * sin(sourceLine * 3.14159265);
      float fineLine = 0.96 + 0.04 * sin(sourceLine * 6.2831853 + time * 0.7);
      float triad = mod(gl_FragCoord.x, 3.0);
      vec3 phosphorMask = triad < 1.0 ? vec3(1.0, 0.82, 0.78)
        : triad < 2.0 ? vec3(0.80, 1.0, 0.80)
        : vec3(0.80, 0.84, 1.0);
      float rollingBand = 1.0 + 0.035 * exp(-pow(
        fract(uv.y - time * 0.085) - 0.5, 2.0) / 0.0045);
      float vignette = pow(clamp(
        16.0 * vUv.x * vUv.y * (1.0 - vUv.x) * (1.0 - vUv.y), 0.0, 1.0
      ), 0.23);
      float noise = (hash21(gl_FragCoord.xy + floor(time * 30.0)) - 0.5) * 0.025;
      float flicker = 0.985 + 0.015 * sin(time * 47.0);
      float glassFacing = 0.90 + 0.10 * abs(vNormalView.z);

      color *= scanline * fineLine * phosphorMask * rollingBand;
      color = color * (0.90 + 0.14 * vignette) * flicker * glassFacing + noise;
      color += vec3(0.018, 0.028, 0.040) * (1.0 - vignette);
      gl_FragColor = vec4(max(color, 0.0), edgeAlpha);
      #include <colorspace_fragment>
    }
  `,
});

function curvedScreenGeometry(width, height, depth) {
  const geometry = new THREE.PlaneGeometry(width, height, 48, 36);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const nx = position.getX(index) / (width * 0.5);
    const ny = position.getY(index) / (height * 0.5);
    const dome = Math.max(0, 1 - nx * nx) * Math.max(0, 1 - ny * ny);
    position.setZ(index, depth * dome);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

new GLTFLoader().load(tvModelUrl, gltf => {
  const orientedModel = new THREE.Group();
  const tvModel = gltf.scene;
  orientedModel.add(tvModel);

  // Tripo object models use +X as front, +Y as up, and +Z as width.
  // Present those axes as +Z front, +Y up, and -X width for Three.js.
  orientedModel.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-1, 0, 0)
    )
  );
  orientedModel.updateMatrixWorld(true);

  const initialBounds = new THREE.Box3().setFromObject(orientedModel);
  const center = initialBounds.getCenter(new THREE.Vector3());
  const size = initialBounds.getSize(new THREE.Vector3());
  orientedModel.position.sub(center);
  tvModel.traverse(object => {
    if (!object.isMesh) return;
    object.frustumCulled = false;
    object.material = tvCabinetMaterial;
  });
  starterTvDisplay.add(orientedModel);

  const screenWidth = size.x * 0.81;
  const screenHeight = size.y * 0.60;
  const screenDepth = Math.min(screenWidth, screenHeight) * 0.028;
  const screen = new THREE.Mesh(
    curvedScreenGeometry(screenWidth, screenHeight, screenDepth),
    crtScreenMaterial
  );
  screen.name = 'LiveCrtVideoScreen';
  screen.position.set(0, size.y * 0.095, size.z * 0.505);
  screen.renderOrder = 3;
  starterTvDisplay.add(screen);

  const targetHeight = 2.30;
  starterTvDisplay.name = 'StarterCrtTelevision';
  starterTvDisplay.scale.setScalar(targetHeight / size.y);
  starterTvDisplay.position.y = -0.02;
  mainHardwareTvUnitH = targetHeight;
  resize();
}, undefined, error => console.error('Could not load Tripo CRT television', error));

// ---------------------------------------------------------------------------
// N64 retro pipeline: render tiny -> nearest-neighbor upscale, posterized
// grays, Bayer-dithered alpha edge, and a 1-texel dark outline.
// ---------------------------------------------------------------------------
const SHADER_DEFAULTS = Object.freeze({
  enabled: true,
  pixelSize: 2,
  colorSteps: 12,
  posterize: 0.5,
  dither: 1,
  outlineWidth: 1,
  outlineStrength: 0.7,
  outlineColor: '#383838',
  gamma: 2.5,
});
const SHADER_STORAGE_KEY = 'opensmash.shader-tuning.v3';

function loadShaderSettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(SHADER_STORAGE_KEY) || '{}'); }
  catch (_) { /* Ignore malformed or unavailable local storage. */ }
  const settings = { ...SHADER_DEFAULTS };
  for (const key of ['pixelSize', 'colorSteps', 'posterize', 'dither',
                     'outlineWidth', 'outlineStrength', 'gamma']) {
    if (Number.isFinite(Number(stored[key]))) settings[key] = Number(stored[key]);
  }
  if (typeof stored.enabled === 'boolean') settings.enabled = stored.enabled;
  if (/^#[0-9a-f]{6}$/i.test(stored.outlineColor || '')) {
    settings.outlineColor = stored.outlineColor;
  }
  return settings;
}

function shaderColor(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return new THREE.Vector3(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  );
}

const shaderSettings = loadShaderSettings();
const rt = new THREE.WebGLRenderTarget(4, 4, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  generateMipmaps: false,
});
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: {
    tex: { value: rt.texture },
    res: { value: new THREE.Vector2(4, 4) },
    colorSteps: { value: shaderSettings.colorSteps },
    posterize: { value: shaderSettings.posterize },
    dither: { value: shaderSettings.dither },
    outlineWidth: { value: shaderSettings.outlineWidth },
    outlineStrength: { value: shaderSettings.outlineStrength },
    outlineColor: { value: shaderColor(shaderSettings.outlineColor) },
    gamma: { value: shaderSettings.gamma },
  },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tex; uniform vec2 res; varying vec2 vUv;
    uniform float colorSteps, posterize, dither, outlineWidth, outlineStrength, gamma;
    uniform vec3 outlineColor;
    float bayer4(vec2 p) {
      int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
      int m[16]; m[0]=0; m[1]=8; m[2]=2; m[3]=10; m[4]=12; m[5]=4; m[6]=14; m[7]=6;
      m[8]=3; m[9]=11; m[10]=1; m[11]=9; m[12]=15; m[13]=7; m[14]=13; m[15]=5;
      return (float(m[y*4+x]) + 0.5) / 16.0;
    }
    bool solidAt(vec2 t) {
      float threshold = mix(0.5, bayer4(t), dither);
      return texture2D(tex, (t + 0.5) / res).a >= threshold;
    }
    void main() {
      vec2 texel = floor(vUv * res);
      if (!solidAt(texel)) discard;
      vec4 c = texture2D(tex, (texel + 0.5) / res);
      vec3 col = pow(clamp(c.rgb, 0.0, 1.0), vec3(1.0 / gamma));
      vec3 stepped = floor(col * colorSteps + 0.5) / colorSteps;
      col = mix(col, stepped, posterize);
      bool edge = false;
      if (outlineWidth >= 0.5) {
        edge = !solidAt(texel + vec2(1.0, 0.0)) || !solidAt(texel - vec2(1.0, 0.0))
            || !solidAt(texel + vec2(0.0, 1.0)) || !solidAt(texel - vec2(0.0, 1.0));
      }
      if (outlineWidth >= 1.5) {
        edge = edge || !solidAt(texel + vec2(2.0, 0.0)) || !solidAt(texel - vec2(2.0, 0.0))
            || !solidAt(texel + vec2(0.0, 2.0)) || !solidAt(texel - vec2(0.0, 2.0));
      }
      if (outlineWidth >= 2.5) {
        edge = edge || !solidAt(texel + vec2(3.0, 0.0)) || !solidAt(texel - vec2(3.0, 0.0))
            || !solidAt(texel + vec2(0.0, 3.0)) || !solidAt(texel - vec2(0.0, 3.0));
      }
      if (edge) col = mix(col, min(col, outlineColor), outlineStrength);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

// World-space height visible at the z=0 plane (glove plane).
const VIEW_H = 2 * Math.tan(THREE.MathUtils.degToRad(35 / 2)) * 16;
const GLOVE_PX = 32;   // tuned so the rendered silhouette spans the sprite's 36 rows
let handUnitH = 0;     // hand height in world units; set once the mesh is built
let gloveBaseScale = 0; // viewport-fitted glove scale before the poof presence spring
const CONSOLE_PX = 150;
const MAIN_HARDWARE_TV_PX = 124;
const CARTRIDGE_FIT_SCALE = 0.44;
const CARTRIDGE_IDLE_Z = 1.55;
const CARTRIDGE_DRAG_Z = -0.48;
const CONSOLE_PRESS_CUE = 0.20;
const CARTRIDGE_MAGNET_MAX = 0.88;
const CARTRIDGE_ROUTE_SPEED = 6.0;
const CARTRIDGE_IDLE_SPIN_SPEED = 0.22;
const CARTRIDGE_FRONT_YAW = Math.PI * 1.5 - 0.28;
let cartridgeUnitH = 0;
let cartridgeUnitW = 0;
let cartridgeUnitD = 0;
let consoleUnitW = 0;
let consoleScaleValue = 0;

function applyGloveScale(viewportPixelH, targetScreenPx = GLOVE_PX * SHADER_DEFAULTS.pixelSize) {
  if (!handUnitH) return;
  let s = targetScreenPx * (VIEW_H / viewportPixelH) / handUnitH;
  if (location.hash.includes('big')) s *= 4;
  gloveBaseScale = s;
  glove.scale.setScalar(s * glovePresence);
  keyLight.intensity = 24 * s * s;   // inverse-square compensation
}

function applyHardwareScale(viewportPixelH) {
  if (!consoleUnitW) return;
  const responsivePx = window.innerWidth < 640 ? CONSOLE_PX * 0.76 : CONSOLE_PX;
  consoleScaleValue = responsivePx * SHADER_DEFAULTS.pixelSize
    * (VIEW_H / viewportPixelH) / consoleUnitW;
  consoleVisual.scale.setScalar(consoleScaleValue);
  if (cartridgeUnitH) {
    cartridgeVisual.scale.setScalar(consoleScaleValue * CARTRIDGE_FIT_SCALE);
  }
  if (mainHardwareTvUnitH) {
    const widthResponsivePx = window.innerWidth < 640
      ? MAIN_HARDWARE_TV_PX * 0.84
      : MAIN_HARDWARE_TV_PX;
    const tvResponsivePx = Math.min(
      widthResponsivePx,
      viewportPixelH * 0.44 / SHADER_DEFAULTS.pixelSize
    );
    const tvScale = tvResponsivePx * SHADER_DEFAULTS.pixelSize
      * (VIEW_H / viewportPixelH) / mainHardwareTvUnitH;
    mainHardwareTvVisual.scale.setScalar(tvScale);
  }
}

function resize() {
  if (!window.innerWidth || !window.innerHeight) return;  // pane hidden: keep old size
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  godRayLayer.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = 35;
  camera.updateProjectionMatrix();
  const w = Math.max(4, Math.round(window.innerWidth / shaderSettings.pixelSize));
  const h = Math.max(4, Math.round(window.innerHeight / shaderSettings.pixelSize));
  rt.setSize(w, h);
  postMat.uniforms.res.value.set(w, h);
  applyGloveScale(window.innerHeight);
  applyHardwareScale(window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

const shaderTuner = document.getElementById('shader-tuner');
const shaderControls = [...shaderTuner.querySelectorAll('[data-shader]')];

function shaderValueLabel(key, value) {
  if (['posterize', 'dither', 'outlineStrength'].includes(key)) {
    return `${Math.round(value * 100)}%`;
  }
  if (key === 'pixelSize') return `${value}×`;
  if (key === 'outlineWidth') return `${value} px`;
  if (key === 'gamma') return Number(value).toFixed(2);
  return String(value);
}

function syncShaderTuner() {
  for (const control of shaderControls) {
    const key = control.dataset.shader;
    if (control.type === 'checkbox') control.checked = shaderSettings[key];
    else control.value = shaderSettings[key];
    const output = shaderTuner.querySelector(`[data-value-for="${key}"]`);
    if (output) output.value = shaderValueLabel(key, shaderSettings[key]);
  }
}

function applyShaderSettings(pixelSizeChanged = false) {
  postMat.uniforms.colorSteps.value = shaderSettings.colorSteps;
  postMat.uniforms.posterize.value = shaderSettings.posterize;
  postMat.uniforms.dither.value = shaderSettings.dither;
  postMat.uniforms.outlineWidth.value = shaderSettings.outlineWidth;
  postMat.uniforms.outlineStrength.value = shaderSettings.outlineStrength;
  postMat.uniforms.outlineColor.value.copy(shaderColor(shaderSettings.outlineColor));
  postMat.uniforms.gamma.value = shaderSettings.gamma;
  try { localStorage.setItem(SHADER_STORAGE_KEY, JSON.stringify(shaderSettings)); }
  catch (_) { /* Settings still work for this session. */ }
  if (pixelSizeChanged) resize();
  syncShaderTuner();
}

for (const control of shaderControls) {
  control.addEventListener('input', () => {
    const key = control.dataset.shader;
    const previousPixelSize = shaderSettings.pixelSize;
    shaderSettings[key] = control.type === 'checkbox' ? control.checked
      : control.type === 'color' ? control.value : Number(control.value);
    applyShaderSettings(key === 'pixelSize' && shaderSettings.pixelSize !== previousPixelSize);
  });
}
document.getElementById('shader-reset').addEventListener('click', () => {
  Object.assign(shaderSettings, SHADER_DEFAULTS);
  applyShaderSettings(true);
});
shaderTuner.addEventListener('pointerdown', event => event.stopPropagation());
syncShaderTuner();
window.__shaderSettings = shaderSettings;

// ---------------------------------------------------------------------------
// Rig: bone skeleton retargeted onto the Meshy GLB's anatomy (hand-local
// space at the GLB_ALIGN transform below). Rest pose IS the point pose.
// ---------------------------------------------------------------------------
const fingerDefs = [
  { x: -1.15, y: 0.35, z: -0.1,  r: 0.34, l1: 0.55, l2: 0.45, curl: 1.0, name: 'pinky'  },
  { x: -0.55, y: 0.45, z: -0.05, r: 0.36, l1: 0.6,  l2: 0.5,  curl: 1.0, name: 'ring'   },
  { x:  0.05, y: 0.5,  z: 0,     r: 0.38, l1: 0.65, l2: 0.5,  curl: 1.0, name: 'middle' },
  { x:  0.7,  y: 0.55, z: 0.1,   r: 0.36, l1: 0.9,  l2: 0.65, curl: 0.0, name: 'index'  },
];
const INDEX_REST_Z = -0.95;   // index lean (rad clockwise from vertical)

const rootBone = new THREE.Bone();           // palm + cuff
const bones = [rootBone];
const rigs = [];
for (const d of fingerDefs) {
  const base = new THREE.Bone();
  base.position.set(d.x, d.y, d.z);
  const knuckle = new THREE.Bone();
  knuckle.position.set(0, d.l1, 0);
  base.add(knuckle);
  rootBone.add(base);
  bones.push(base, knuckle);
  rigs.push({ def: d, base, knuckle, jig: { a: 0, v: 0, phase: Math.random() * Math.PI * 2 } });
}
const thumbDef = { r: 0.3, l1: 0.6, l2: 0.45, curl: 0, name: 'thumb' };
{
  const base = new THREE.Bone();
  base.position.set(0.25, 0.75, -0.2);
  const knuckle = new THREE.Bone();
  knuckle.position.set(0, thumbDef.l1, 0);
  base.add(knuckle);
  rootBone.add(base);
  bones.push(base, knuckle);
  rigs.push({ def: thumbDef, base, knuckle, jig: { a: 0, v: 0, phase: Math.random() * Math.PI * 2 } });
}

// Extra curl applied on top of the rest pose (tucks the GLB's authored
// up-thumb etc.; zeroed while binding so it acts as a live delta).
const poseTweak = { pinky: 0, ring: 0, middle: 0, thumb: 0 };

// Grip (closed-fist) parameters, tuned against assets/hand_grab.png with the
// capture/compare loop — an orientation sweep plus per-joint refinement.
const GRIP = {
  indexCurl: 1.25, indexKnuckle: 1.25, indexZ: -0.10,
  fistTighten: 0.22,
  thumbX: -1.15, thumbY: 0.15, thumbZ: -1.15, thumbKnuckle: 0.55,
  scale: 0.90,
};
window.__grip = GRIP;

// Default-pose scale, tuned the same way against assets/hand_point.png.
const POINT = { scale: 1.00 };
window.__point = POINT;

// Pose the skeleton across three poses that share one rig:
//   tap  0..1  the click gesture — whole-hand tilt into the page, fingers
//              barely move (this is what pointerdown drives)
//   grip 0..1  a real closed fist matching the game's grab sprite, available
//              via setGrip() for pick-up style interactions
function poseFingers(tap, grip) {
  grip = grip || 0;
  for (const f of rigs) {
    const d = f.def, jig = f.jig;
    if (d.name === 'thumb') {
      // rest = the GLB's authored up-thumb (bind capsule lies along it);
      // poseTweak.thumb is the live fold that tucks it against the fist
      const x = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.35, -0.3, tap), GRIP.thumbX, grip);
      const y = THREE.MathUtils.lerp(0, GRIP.thumbY, grip);
      const z = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.05, -0.02, tap), GRIP.thumbZ, grip);
      f.base.rotation.set(x + poseTweak.thumb + jig.a * 0.5, y, z);
      f.knuckle.rotation.x =
        THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.1, 0.15, tap), GRIP.thumbKnuckle, grip)
        + poseTweak.thumb * 0.25 + jig.a;
    } else if (d.name === 'index') {
      // tap: a whisper of compression. grip: folds down into the fist
      // (negative X is inward on this rig; positive splays the tip out).
      const tapCurl = THREE.MathUtils.lerp(0, 0.18, tap);
      f.base.rotation.x = THREE.MathUtils.lerp(tapCurl * 1.15, -GRIP.indexCurl, grip) + jig.a;
      f.base.rotation.z = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(INDEX_REST_Z, INDEX_REST_Z - 0.08, tap), GRIP.indexZ, grip);
      f.knuckle.rotation.x =
        THREE.MathUtils.lerp(tapCurl * 1.35, -GRIP.indexCurl * GRIP.indexKnuckle, grip);
    } else {
      const curl = THREE.MathUtils.lerp(1.05, 1.07, tap) + GRIP.fistTighten * grip
                 + jig.a + poseTweak[d.name];
      f.base.rotation.x = curl * 1.15;
      f.knuckle.rotation.x = curl * 1.35;
    }
  }
}
poseFingers(0, 0);
rootBone.updateMatrixWorld(true);

// ---------------------------------------------------------------------------
// Skinning shapes: capsules from the posed bones + palm/cuff root shapes,
// used for distance-based vertex weights on the GLB mesh.
// ---------------------------------------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const capsules = [];
for (const f of rigs) {
  const d = f.def;
  const a1 = f.base.getWorldPosition(new THREE.Vector3());
  const b1 = f.knuckle.getWorldPosition(new THREE.Vector3());
  const b2 = f.knuckle.localToWorld(V(0, d.l2, 0));
  capsules.push({ a: a1, b: b1, r: d.r, bone: bones.indexOf(f.base) });
  capsules.push({ a: b1.clone(), b: b2, r: d.r * (d.name === 'index' ? 0.62 : 0.85), bone: bones.indexOf(f.knuckle) });
}

function sdCapsule(p, a, b, r) {
  const pax = p.x - a.x, pay = p.y - a.y, paz = p.z - a.z;
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const h = Math.max(0, Math.min(1,
    (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
function sdEllipsoid(p, cx, cy, cz, rx, ry, rz) {
  const ox = p.x - cx, oy = p.y - cy, oz = p.z - cz;
  const x = ox / rx, y = oy / ry, z = oz / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt(x / rx * (x / rx) + y / ry * (y / ry) + z / rz * (z / rz));
  return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
const CUFF_ROT = 0.45, CUFF_C = V(-1.0, -1.35, 0), CUFF_R = 0.8, CUFF_r = 0.45;
function sdCuffTorus(p) {
  const qx0 = p.x - CUFF_C.x, qy0 = p.y - CUFF_C.y, qz = p.z - CUFF_C.z;
  const c = Math.cos(CUFF_ROT), s = Math.sin(CUFF_ROT);
  const qx = qx0 * c + qy0 * s, qy = -qx0 * s + qy0 * c;
  const lxz = Math.sqrt(qx * qx + qz * qz) - CUFF_R;
  return Math.sqrt(lxz * lxz + qy * qy) - CUFF_r;
}
const cuffCapA = V(-1.0, -1.6, 0), cuffCapB = V(-1.0, -1.3, 0);
function sdRoot(p) {
  return Math.min(
    sdEllipsoid(p, 0, -0.3, 0, 1.9, 1.2, 1.0),
    sdCuffTorus(p),
    sdCapsule(p, cuffCapA, cuffCapB, 0.7));
}

const gloveMat = new THREE.MeshStandardMaterial({
  color: 0xe9e9ec, roughness: 0.9, metalness: 0.0,
  transparent: true, opacity: 1, depthTest: false, depthWrite: false,
});

// ---------------------------------------------------------------------------
// Assembly: glove(pointer position) -> wrist(rotation springs) -> hand(pose)
// ---------------------------------------------------------------------------
const glove = new THREE.Group();
const wrist = new THREE.Group();
const hand = new THREE.Group();
glove.visible = false;
glove.add(wrist);
wrist.add(hand);
hand.scale.setScalar(0.62);

// Point: character-select cursor. Down/press: same pose tilted forward a
// touch (fingertip pressing into the page); squash is applied in tick.
const qPoint = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, -0.58, 0.48));
const qTap = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.95, -0.4, 0.35));
const qGrip = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, -0.1, 0.1));
const qGrab = qTap;   // click still drives the tap, per the interaction spec
hand.quaternion.copy(qPoint);
const keyLight = new THREE.PointLight(0xffffff, 18, 0, 2);
keyLight.position.set(-1.6, -0.4, 2.6);
glove.add(keyLight);
scene.add(glove);

// ---------------------------------------------------------------------------
// Poof: the glove is a page-owned cursor, so it cannot follow the pointer into
// a pointer-receiving iframe (the native cursor takes over there) and it only
// gets in the way over the running game. Rather than freezing at the edge, it
// vanishes in a little puff of smoke when the pointer crosses in and pops back
// with another puff on the way out.
// ---------------------------------------------------------------------------
let glovePresence = 1;        // 0 = poofed away, 1 = fully present
let glovePresenceVel = 0;
let glovePresenceTarget = 1;
let gloveHidden = false;
const PRESENCE_FLOOR = 0.002;
const PUFF_COUNT = 7;
const PUFF_LIFE = 0.42;
const puffGeometry = new THREE.CircleGeometry(1, 10);
const puffs = Array.from({ length: PUFF_COUNT }, () => {
  const mesh = new THREE.Mesh(puffGeometry, new THREE.MeshBasicMaterial({
    color: 0xf2efe8, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
  }));
  mesh.visible = false;
  mesh.renderOrder = 5;
  scene.add(mesh);
  return { mesh, age: PUFF_LIFE, dx: 0, dy: 0, size: 1 };
});

function spawnPoof(x, y) {
  const radius = Math.max(0.02, gloveBaseScale * handUnitH * 0.28);
  for (let i = 0; i < puffs.length; i++) {
    const puff = puffs[i];
    const angle = (i / puffs.length) * Math.PI * 2 + Math.random() * 0.6;
    const dist = radius * (0.9 + Math.random() * 0.7);
    puff.age = -Math.random() * 0.05;
    puff.dx = Math.cos(angle) * dist;
    puff.dy = Math.sin(angle) * dist;
    puff.size = radius * (0.55 + Math.random() * 0.45);
    puff.mesh.position.set(x, y, GLOVE_DEPTH + 0.01);
    puff.mesh.visible = true;
  }
}

function updatePoof(dt) {
  for (const puff of puffs) {
    if (!puff.mesh.visible) continue;
    puff.age += dt;
    if (puff.age >= PUFF_LIFE) { puff.mesh.visible = false; continue; }
    const k = Math.max(0, puff.age / PUFF_LIFE);
    const out = 1 - (1 - k) * (1 - k);        // ease-out drift
    puff.mesh.position.x = mouse.x + puff.dx * (0.35 + out * 0.65);
    puff.mesh.position.y = mouse.y + puff.dy * (0.35 + out * 0.65) + k * puff.size * 0.4;
    puff.mesh.scale.setScalar(puff.size * (0.5 + out * 0.9) * (1 - k * 0.35));
    puff.mesh.material.opacity = (1 - k) * (1 - k) * 0.95;
  }
  // Underdamped spring so the return overshoots a touch (cartoon pop).
  const K = 320, D = gloveHidden ? 34 : 22;
  glovePresenceVel += ((glovePresenceTarget - glovePresence) * K - glovePresenceVel * D) * dt;
  glovePresence = Math.max(0, glovePresence + glovePresenceVel * dt);
  // Never let the glove's world scale approach zero asymptotically. The
  // skinned hand re-inverts its world matrix every frame, and a denormal
  // determinant overflows that inverse into NaN, which then feeds the
  // fingertip pin and poisons the rig permanently. Snap to exactly zero
  // once the poof is done, hide the hand, and keep the scale off zero.
  if (glovePresenceTarget === 0 && glovePresence < PRESENCE_FLOOR) {
    glovePresence = 0;
    glovePresenceVel = 0;
  }
  hand.visible = glovePresence > 0;
  if (gloveBaseScale) {
    glove.scale.setScalar(gloveBaseScale * Math.max(glovePresence, PRESENCE_FLOOR));
  }
}

// Ring buffer of the last hidden/shown transitions with their trigger, for
// field diagnosis: dump window.__dbg.gloveLog when the cursor goes missing.
const gloveLog = [];
function logGloveTransition(hidden, reason) {
  gloveLog.push({
    t: Math.round(performance.now()), hidden, reason,
    x: lastPointer.x, y: lastPointer.y, inside: lastPointer.inside,
    scrollY: window.scrollY, body: document.body.className,
    presence: Number(glovePresence.toFixed(2)),
  });
  if (gloveLog.length > 40) gloveLog.shift();
}

// While the glove is poofed away the user still needs a cursor. The
// stylesheet hides the native one everywhere (static rules, see
// site-shell.css), so the fallback is an inline override on just the element
// under the pointer: one style write, no document-wide recalc.
let fallbackCursorEl = null;
function setFallbackCursor(el) {
  if (el === fallbackCursorEl) return;
  if (fallbackCursorEl) fallbackCursorEl.style.removeProperty('cursor');
  fallbackCursorEl = el instanceof HTMLElement || el instanceof SVGElement ? el : null;
  if (fallbackCursorEl) fallbackCursorEl.style.setProperty('cursor', 'auto', 'important');
}
function syncFallbackCursor(target) {
  if (!gloveHidden || !lastPointer.inside) { setFallbackCursor(null); return; }
  if (target === undefined && Number.isFinite(lastPointer.x)) {
    target = document.elementFromPoint(lastPointer.x, lastPointer.y);
  }
  setFallbackCursor(target || null);
}

function setGloveHidden(hidden, { silent = false, reason = 'unspecified', target } = {}) {
  if (hidden === gloveHidden) return;
  logGloveTransition(hidden, reason);
  gloveHidden = hidden;
  glovePresenceTarget = hidden ? 0 : 1;
  syncFallbackCursor(target);
  const snap = prefersReducedMotion || silent;
  if (glove.visible && !snap) spawnPoof(mouse.x, mouse.y);
  if (snap) { glovePresence = glovePresenceTarget; glovePresenceVel = 0; }
}

const heroFrame = document.querySelector('.intro-video-frame');
function pointerShouldPoof(target, clientX, clientY) {
  if (target instanceof HTMLIFrameElement) return true;
  if (!heroFrame?.classList.contains('is-game-running')) return false;
  const r = heroFrame.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

// The hidden state is derived from the last known pointer, not only from
// whichever pointer event happened to fire last. A tab switch, a focus change,
// the game starting or stopping, a resize, or the pointer leaving the window
// all change the answer without producing a pointer move, so each of those
// re-runs the same decision against the last position.
const lastPointer = { x: NaN, y: NaN, inside: false };
function syncGloveHidden(reason = 'sync') {
  const present = lastPointer.inside &&
    Number.isFinite(lastPointer.x) && Number.isFinite(lastPointer.y);
  if (!present) { setGloveHidden(true, { reason: `${reason}:pointer-outside` }); return; }
  const target = document.elementFromPoint(lastPointer.x, lastPointer.y);
  const label = target ? `${target.tagName.toLowerCase()}${target.id ? '#' + target.id : ''}` : 'null';
  setGloveHidden(pointerShouldPoof(target, lastPointer.x, lastPointer.y),
    { reason: `${reason}:${label}`, target });
  syncFallbackCursor(target);
}
let gloveSyncQueued = false;
let gloveSyncReason = 'sync';
function scheduleGloveSync(eventOrReason) {
  gloveSyncReason = typeof eventOrReason === 'string' ? eventOrReason
    : eventOrReason?.type || (Array.isArray(eventOrReason) ? 'mutation' : 'sync');
  if (gloveSyncQueued) return;
  gloveSyncQueued = true;
  requestAnimationFrame(() => { gloveSyncQueued = false; syncGloveHidden(gloveSyncReason); });
}

function syncCustomCursorAvailability() {
  const available = customCursorQuery.matches && customCursorMeshReady &&
    customCursorHasPosition && webglContextAvailable;
  document.documentElement.classList.toggle('is-custom-cursor-ready', available);
  glove.visible = available;
}

customCursorQuery.addEventListener('change', syncCustomCursorAvailability);
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  webglContextAvailable = false;
  syncCustomCursorAvailability();
});
canvas.addEventListener('webglcontextrestored', () => {
  webglContextAvailable = true;
  syncCustomCursorAvailability();
});

// ---------------------------------------------------------------------------
// Original retro cartridge: loaded as a real GLB and kept in this same scene,
// so it receives the glove's low-res, posterized, dithered-outline pass.
// ---------------------------------------------------------------------------
const cartridgeControl = document.getElementById('cartridge-control');
const consoleControl = document.getElementById('console-control');
const tvControl = document.getElementById('tv-control');
const hardwareInset = document.getElementById('hardware-inset');

function updateHardwareThirdsLayout() {
  const inset = hardwareInset.getBoundingClientRect();
  const insetY = fraction => THREE.MathUtils.clamp(
    window.innerHeight * fraction - inset.top, 0, inset.height
  );
  hardwareInset.style.setProperty('--tv-home-top', `${insetY(1 / 6)}px`);
  hardwareInset.style.setProperty('--cartridge-home-top', `${insetY(1 / 2)}px`);
  hardwareInset.style.setProperty('--console-home-top', `${insetY(5 / 6)}px`);
}
updateHardwareThirdsLayout();
window.addEventListener('resize', updateHardwareThirdsLayout);

const cartridgeRig = new THREE.Group();
const cartridgeVisual = new THREE.Group();
const cartridgeLight = new THREE.DirectionalLight(0xfff0d4, 2.65);
cartridgeLight.position.set(-0.45, 3.2, 1.35);
cartridgeLight.target.position.set(0, 0, 0);
const cartridgeFillLight = new THREE.DirectionalLight(0xa5b9e6, 0.48);
cartridgeFillLight.position.set(1.35, -0.15, 1.6);
cartridgeFillLight.target = cartridgeLight.target;
cartridgeRig.add(
  cartridgeVisual, cartridgeLight, cartridgeFillLight, cartridgeLight.target
);
scene.add(cartridgeRig);
cartridgeRig.visible = CARTRIDGE_INTRO_ENABLED;

const consoleRig = new THREE.Group();
const consoleVisual = new THREE.Group();
const consoleRestQuaternion = new THREE.Quaternion();
const consoleInviteQuaternion = new THREE.Quaternion();
const consoleBaseQuaternion = new THREE.Quaternion();
const consoleIdleQuaternion = new THREE.Quaternion();
const consoleIdleEuler = new THREE.Euler();
const consoleLight = new THREE.DirectionalLight(0xffead0, 2.2);
consoleLight.position.set(-1.2, 3.5, 2.8);
consoleLight.target.position.set(0, 0, 0);
const consoleFillLight = new THREE.DirectionalLight(0x9db7e8, 0.42);
consoleFillLight.position.set(2.2, 0.4, 2.1);
consoleFillLight.target = consoleLight.target;
consoleRig.add(consoleVisual, consoleLight, consoleFillLight, consoleLight.target);
scene.add(consoleRig);
consoleRig.visible = CARTRIDGE_INTRO_ENABLED;

const cartridgeMaterial = new THREE.MeshStandardMaterial({
  color: 0xb8b5ba,
  emissive: 0x121116,
  emissiveIntensity: 0.16,
  roughness: 0.84,
  metalness: 0,
});
const cartridgeLabelTexture = new THREE.TextureLoader().load(
  cartridgeLabelUrl
);
cartridgeLabelTexture.colorSpace = THREE.SRGBColorSpace;
cartridgeLabelTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const cartridgeLabelMaterial = new THREE.MeshBasicMaterial({
  map: cartridgeLabelTexture,
  transparent: true,
  alphaTest: 0.02,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});
const CARTRIDGE_LABEL_PANEL = Object.freeze({
  width: 0.48046875,
  height: 0.587890625,
  frontX: 0.0876,
  centerY: 0.015625,
  centerZ: 0.0087890625,
});
const funLetterMaterials = {
  FUN_F: new THREE.MeshStandardMaterial({
    color: 0x111824, emissive: 0x1687ff, emissiveIntensity: 0,
    roughness: 0.48, metalness: 0,
  }),
  FUN_U: new THREE.MeshStandardMaterial({
    color: 0x211d0c, emissive: 0xffcf20, emissiveIntensity: 0,
    roughness: 0.48, metalness: 0,
  }),
  FUN_N: new THREE.MeshStandardMaterial({
    color: 0x251012, emissive: 0xff2d24, emissiveIntensity: 0,
    roughness: 0.48, metalness: 0,
  }),
};

const CARTRIDGE_STATE = Object.freeze({
  FREE: 'free',
  DRAGGING: 'dragging',
  INSERTING: 'inserting',
  BOOTING: 'booting',
  RUNNING: 'running',
  EJECTING: 'ejecting',
});
const HARDWARE_EXIT_DURATION = 0.9;
const CREDIT_REVEAL_DELAY = HARDWARE_EXIT_DURATION;
const SITE_REVEAL_DELAY = CREDIT_REVEAL_DELAY + 2.0;
const CARTRIDGE_DRAG_THRESHOLD = 6;
const CARTRIDGE_FACE_TURN_SPRING = 125;
const CARTRIDGE_FACE_TURN_DAMPING = 20.5;
const CARTRIDGE_FACE_TURN_LAUNCH_SPEED = 4.0;
const CARTRIDGE_FACE_TURN_DIRECTION = 1;
const CARTRIDGE_LOCK_ROUTE_PROGRESS = 0.82;
const CARTRIDGE_LOCK_SHAKE_DURATION = 0.18;
const CARTRIDGE_LOCK_SHAKE_STRENGTH = 0.055;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let cartridgeLockShakeStartedAt = -Infinity;
let cartridgeAudioContext = null;

function triggerCartridgeLockShake() {
  if (prefersReducedMotion) return;
  cartridgeLockShakeStartedAt = clock.elapsedTime;
}

function applyCartridgeLockShake(now) {
  camera.position.copy(cameraRestPosition);
  camera.quaternion.copy(cameraRestQuaternion);
  const elapsed = now - cartridgeLockShakeStartedAt;
  if (elapsed < 0 || elapsed >= CARTRIDGE_LOCK_SHAKE_DURATION) return;

  const progress = elapsed / CARTRIDGE_LOCK_SHAKE_DURATION;
  const envelope = (1 - progress) * (1 - progress);
  const strength = CARTRIDGE_LOCK_SHAKE_STRENGTH * envelope;
  camera.position.x += Math.sin(elapsed * 114) * strength;
  camera.position.y += Math.sin(elapsed * 151 + 0.8) * strength * 0.65;
  camera.position.z += Math.sin(elapsed * 97 + 1.7) * strength * 0.16;
  camera.rotation.z += Math.sin(elapsed * 128 + 0.35) * strength * 0.14;
  camera.updateMatrixWorld(true);
}

function resetCameraAfterShake() {
  camera.position.copy(cameraRestPosition);
  camera.quaternion.copy(cameraRestQuaternion);
  camera.updateMatrixWorld(true);
}

function playCartridgeSound(kind) {
  if (!soundOn) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    cartridgeAudioContext ||= new AudioContextClass();
    const play = () => {
      const context = cartridgeAudioContext;
      const now = context.currentTime;
      const profile = {
        press: {
          volume: 0.075, from: 520, to: 330, duration: 0.035,
          noise: 0.24, noiseDuration: 0.016, filter: 3200,
        },
        release: {
          volume: 0.065, from: 350, to: 480, duration: 0.04,
          noise: 0.17, noiseDuration: 0.014, filter: 2800,
        },
        lock: {
          volume: 0.18, from: 210, to: 82, duration: 0.09,
          noise: 0.5, noiseDuration: 0.04, filter: 1500,
        },
      }[kind];
      if (!profile) return;

      const master = context.createGain();
      master.gain.setValueAtTime(profile.volume, now);
      master.connect(context.destination);

      // A pitched impact supplies the body of each plastic/mechanical cue.
      const impact = context.createOscillator();
      const impactGain = context.createGain();
      impact.type = 'triangle';
      impact.frequency.setValueAtTime(profile.from, now);
      impact.frequency.exponentialRampToValueAtTime(
        profile.to, now + profile.duration
      );
      impactGain.gain.setValueAtTime(0.7, now);
      impactGain.gain.exponentialRampToValueAtTime(
        0.0001, now + profile.duration
      );
      impact.connect(impactGain).connect(master);
      impact.start(now);
      impact.stop(now + profile.duration + 0.005);

      // A filtered noise transient adds the crisp contact at the start.
      const noiseBuffer = context.createBuffer(
        1, Math.ceil(context.sampleRate * profile.noiseDuration), context.sampleRate
      );
      const noise = noiseBuffer.getChannelData(0);
      for (let index = 0; index < noise.length; index += 1) {
        noise[index] = Math.random() * 2 - 1;
      }
      const click = context.createBufferSource();
      const clickFilter = context.createBiquadFilter();
      const clickGain = context.createGain();
      click.buffer = noiseBuffer;
      clickFilter.type = 'bandpass';
      clickFilter.frequency.setValueAtTime(profile.filter, now);
      clickFilter.Q.setValueAtTime(0.8, now);
      clickGain.gain.setValueAtTime(profile.noise, now);
      clickGain.gain.exponentialRampToValueAtTime(
        0.0001, now + profile.noiseDuration
      );
      click.connect(clickFilter).connect(clickGain).connect(master);
      click.start(now);
      click.stop(now + profile.noiseDuration + 0.002);
    };

    if (cartridgeAudioContext.state === 'suspended') {
      cartridgeAudioContext.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch (_) {
    // Audio is optional feedback; keep the click interaction working if the
    // browser or device cannot create an audio context.
  }
}

let cartridgeModel = null;
let cartridgeHovered = false;
let cartridgePressed = false;
let cartridgeHoverAmount = 0;
let cartridgePressAmount = 0;
let cartridgeDragging = false;
let cartridgeDragPointerId = null;
let cartridgeDragDistance = 0;
let cartridgeLastPointerTime = 0;
let cartridgePhysicsReady = false;
let cartridgeState = CARTRIDGE_STATE.FREE;
let cartridgeSnapAmount = 0;
let cartridgeEntryTarget = 0;
let cartridgeEntryAmount = 0;
let consoleApproachTarget = 0;
let consoleApproachAmount = 0;
let cartridgeRouteActive = false;
let cartridgeRouteProgress = 0;
let cartridgeRouteDuration = 0.75;
let cartridgeRouteKind = 'none';
let cartridgeLockFeedbackPlayed = false;
let cartridgeEjectDrag = false;
let cartridgeInsertionTime = -1;
let cartridgePointerStartX = 0;
let cartridgePointerStartY = 0;
let cartridgeYaw = CARTRIDGE_FRONT_YAW;
let cartridgeYawVelocity = CARTRIDGE_IDLE_SPIN_SPEED;
let cartridgeFaceTurnActive = false;
let cartridgeFaceTurnTarget = CARTRIDGE_FRONT_YAW;
const cartridgePhysicsPosition = new THREE.Vector3();
const cartridgeVelocity = new THREE.Vector3();
const cartridgeDragTarget = new THREE.Vector3();
const cartridgeDragOffset = new THREE.Vector3();
const cartridgePointerWorld = new THREE.Vector3();
const cartridgePreviousPointerWorld = new THREE.Vector3();
const cartridgePointerVelocity = new THREE.Vector3();
const cartridgeCollisionScreen = new THREE.Vector2();
const cartridgeRouteScreen = new THREE.Vector2();
const cartridgeRouteTarget = new THREE.Vector3();
const cartridgeRoutePoints = [];
const cartridgeEjectHoldWorld = new THREE.Vector3();
let cartridgePointerClientX = 0;
let cartridgePointerClientY = 0;
const cartridgeTilt = { x: 0, z: 0, vx: 0, vz: 0 };
const cartridgeFreeQuaternion = new THREE.Quaternion();
const cartridgeSocketQuaternion = new THREE.Quaternion();
const cartridgeSocketWorld = new THREE.Vector3();
const cartridgeMouthWorld = new THREE.Vector3();
const cartridgeMouthScreen = new THREE.Vector2();
let consoleModel = null;
let consoleSnapAnchor = null;
let consoleMouthAnchor = null;

// ---------------------------------------------------------------------------
// Cartridge light wisps. Each strand is rebuilt in world space so its source
// stays on the cartridge's spinning front plane while its tail can curl toward
// the console without inheriting that rotation all the way down.
// ---------------------------------------------------------------------------
const CARTRIDGE_WISP_COUNT = 14;
const CARTRIDGE_WISP_TRAIL_SEGMENTS = 5;
const cartridgeWispSeeds = Array.from({ length: CARTRIDGE_WISP_COUNT }, (_, index) => {
  const hash = value => {
    const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    phase: index / CARTRIDGE_WISP_COUNT + hash(index + 1) * 0.045,
    speed: 0.13 + hash(index + 7) * 0.055,
    across: hash(index + 13) * 2 - 1,
    curl: hash(index + 23) * 2 - 1,
    hue: hash(index + 31),
  };
});

const cartridgeWispLinePositions = new Float32Array(
  CARTRIDGE_WISP_COUNT * CARTRIDGE_WISP_TRAIL_SEGMENTS * 2 * 3
);
const cartridgeWispLineColors = new Float32Array(cartridgeWispLinePositions.length);
const cartridgeWispLineAlphas = new Float32Array(
  CARTRIDGE_WISP_COUNT * CARTRIDGE_WISP_TRAIL_SEGMENTS * 2
);
const cartridgeWispPointPositions = new Float32Array(CARTRIDGE_WISP_COUNT * 3);
const cartridgeWispPointColors = new Float32Array(CARTRIDGE_WISP_COUNT * 3);
const cartridgeWispPointAlphas = new Float32Array(CARTRIDGE_WISP_COUNT);

const cartridgeWispLineGeometry = new THREE.BufferGeometry();
cartridgeWispLineGeometry.setAttribute(
  'position', new THREE.BufferAttribute(cartridgeWispLinePositions, 3).setUsage(THREE.DynamicDrawUsage)
);
cartridgeWispLineGeometry.setAttribute(
  'color', new THREE.BufferAttribute(cartridgeWispLineColors, 3).setUsage(THREE.DynamicDrawUsage)
);
cartridgeWispLineGeometry.setAttribute(
  'alpha', new THREE.BufferAttribute(cartridgeWispLineAlphas, 1).setUsage(THREE.DynamicDrawUsage)
);

const cartridgeWispPointGeometry = new THREE.BufferGeometry();
cartridgeWispPointGeometry.setAttribute(
  'position', new THREE.BufferAttribute(cartridgeWispPointPositions, 3).setUsage(THREE.DynamicDrawUsage)
);
cartridgeWispPointGeometry.setAttribute(
  'color', new THREE.BufferAttribute(cartridgeWispPointColors, 3).setUsage(THREE.DynamicDrawUsage)
);
cartridgeWispPointGeometry.setAttribute(
  'alpha', new THREE.BufferAttribute(cartridgeWispPointAlphas, 1).setUsage(THREE.DynamicDrawUsage)
);

const cartridgeWispVertexShader = `
  attribute vec3 color;
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const cartridgeWispMaterialOptions = {
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
};
const cartridgeWispLineMaterial = new THREE.ShaderMaterial({
  ...cartridgeWispMaterialOptions,
  vertexShader: cartridgeWispVertexShader,
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      if (vAlpha < 0.01) discard;
      gl_FragColor = vec4(vColor, vAlpha);
    }
  `,
});
const cartridgeWispPointMaterial = new THREE.ShaderMaterial({
  ...cartridgeWispMaterialOptions,
  vertexShader: cartridgeWispVertexShader.replace(
    'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    `vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
     gl_Position = projectionMatrix * viewPosition;
     gl_PointSize = mix(2.2, 3.7, alpha);`
  ),
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float radius = length(gl_PointCoord - vec2(0.5));
      float glow = 1.0 - smoothstep(0.08, 0.5, radius);
      float alpha = vAlpha * glow;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(vColor * (1.0 + glow * 0.35), alpha);
    }
  `,
});
const cartridgeWispLines = new THREE.LineSegments(
  cartridgeWispLineGeometry, cartridgeWispLineMaterial
);
const cartridgeWispPoints = new THREE.Points(
  cartridgeWispPointGeometry, cartridgeWispPointMaterial
);
cartridgeWispLines.frustumCulled = false;
cartridgeWispPoints.frustumCulled = false;
cartridgeWispLines.renderOrder = 3;
cartridgeWispPoints.renderOrder = 4;
scene.add(cartridgeWispLines, cartridgeWispPoints);

let cartridgeWispVisibility = 0;
let cartridgeWispRouteLength = 0;
const cartridgeWispSource = new THREE.Vector3();
const cartridgeWispTarget = new THREE.Vector3();
const cartridgeWispControlA = new THREE.Vector3();
const cartridgeWispControlB = new THREE.Vector3();
const cartridgeWispAcross = new THREE.Vector3();
const cartridgeWispDown = new THREE.Vector3();
const cartridgeWispSlotAcross = new THREE.Vector3();
const cartridgeWispRoute = new THREE.Vector3();
const cartridgeWispTwirlA = new THREE.Vector3();
const cartridgeWispTwirlB = new THREE.Vector3();
const cartridgeWispScale = new THREE.Vector3();
const cartridgeWispSampleA = new THREE.Vector3();
const cartridgeWispSampleB = new THREE.Vector3();
const cartridgeWispColor = new THREE.Color();
const cartridgeWispWarm = new THREE.Color(0xfff1c7);
const cartridgeWispCool = new THREE.Color(0xa9dfff);
const cartridgeWispLocal = new THREE.Vector3();

function cartridgeWispSmoothstep(edge0, edge1, value) {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function writeCartridgeWispVector(array, offset, vector) {
  array[offset] = vector.x;
  array[offset + 1] = vector.y;
  array[offset + 2] = vector.z;
}

function sampleCartridgeWisp(progress, seed, target) {
  const inverse = 1 - progress;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * progress;
  const c = 3 * inverse * progress * progress;
  const d = progress * progress * progress;
  target.set(
    cartridgeWispSource.x * a + cartridgeWispControlA.x * b +
      cartridgeWispControlB.x * c + cartridgeWispTarget.x * d,
    cartridgeWispSource.y * a + cartridgeWispControlA.y * b +
      cartridgeWispControlB.y * c + cartridgeWispTarget.y * d,
    cartridgeWispSource.z * a + cartridgeWispControlA.z * b +
      cartridgeWispControlB.z * c + cartridgeWispTarget.z * d
  );

  // Begin flat in the cartridge's face plane, then wind that plane around the
  // source-to-slot route. The radius closes completely at the slot mouth.
  const radius = cartridgeWispRouteLength * (0.018 + Math.abs(seed.curl) * 0.014) *
    Math.sin(Math.PI * progress) * cartridgeWispSmoothstep(0, 0.28, progress);
  const angle = seed.curl * 1.35 + progress * progress * Math.PI * 3.2;
  target.addScaledVector(cartridgeWispTwirlA, Math.cos(angle) * radius);
  target.addScaledVector(cartridgeWispTwirlB, Math.sin(angle) * radius);
  return target;
}

function updateCartridgeWisps(now, dt) {
  const hasHardware = cartridgeModel && consoleModel && cartridgeUnitH && cartridgeUnitW;
  if (!hasHardware) return;

  cartridgeRig.updateMatrixWorld(true);
  cartridgeVisual.getWorldScale(cartridgeWispScale);
  cartridgeWispTarget.copy(cartridgeSocketWorld);

  cartridgeWispLocal.set(0, -cartridgeUnitH * 0.52, 0);
  cartridgeWispSource.copy(cartridgeWispLocal);
  cartridgeVisual.localToWorld(cartridgeWispSource);
  const distanceVisibility = cartridgeWispSmoothstep(
    0.16, 0.72, cartridgeWispSource.distanceTo(cartridgeWispTarget)
  );
  const cartridgeRestingAtHome = cartridgeState === CARTRIDGE_STATE.FREE &&
    !cartridgePressed && !cartridgeDragging && !cartridgeRouteActive &&
    cartridgePhysicsReady &&
    cartridgePhysicsPosition.distanceToSquared(cartridgeTarget) < 0.0016 &&
    cartridgeVelocity.lengthSq() < 0.0225;
  const visibilityGoal = prefersReducedMotion || !cartridgeRestingAtHome
    ? 0
    : distanceVisibility;
  const visibilityRate = visibilityGoal < cartridgeWispVisibility ? 12 : 3.4;
  cartridgeWispVisibility += (visibilityGoal - cartridgeWispVisibility) *
    Math.min(1, dt * visibilityRate);
  cartridgeWispLines.visible = cartridgeWispVisibility > 0.01;
  cartridgeWispPoints.visible = cartridgeWispVisibility > 0.01;

  // Transform the cartridge's emitter plane and the console slot width without
  // translation. The fitted assets use local +Z as their horizontal axis.
  cartridgeWispAcross.set(0, 0, 1).transformDirection(cartridgeVisual.matrixWorld);
  cartridgeWispDown.set(0, -1, 0).transformDirection(cartridgeVisual.matrixWorld);
  cartridgeWispSlotAcross.set(0, 0, 1).transformDirection(consoleVisual.matrixWorld);

  const emitterHalfWidth = cartridgeUnitW * cartridgeWispScale.z * 0.36;
  const slotHalfWidth = cartridgeUnitW * cartridgeWispScale.z * 0.42;
  let lineVertex = 0;
  for (let index = 0; index < CARTRIDGE_WISP_COUNT; index += 1) {
    const seed = cartridgeWispSeeds[index];
    const progress = (now * seed.speed + seed.phase) % 1;

    cartridgeWispLocal.set(
      cartridgeUnitD * 0.51,
      -cartridgeUnitH * 0.52,
      cartridgeUnitW * seed.across * 0.34
    );
    cartridgeWispSource.copy(cartridgeWispLocal);
    cartridgeVisual.localToWorld(cartridgeWispSource);

    // Preserve each particle's place across the emitter and deliver it to the
    // corresponding place across the cartridge aperture, rather than pulling
    // every strand into the socket's center point.
    cartridgeWispTarget.copy(cartridgeSocketWorld)
      .addScaledVector(cartridgeWispSlotAcross, slotHalfWidth * seed.across);
    cartridgeWispRoute.subVectors(cartridgeWispTarget, cartridgeWispSource);
    cartridgeWispRouteLength = Math.max(0.001, cartridgeWispRoute.length());
    cartridgeWispRoute.divideScalar(cartridgeWispRouteLength);
    cartridgeWispTwirlA.copy(cartridgeWispAcross)
      .addScaledVector(cartridgeWispRoute, -cartridgeWispAcross.dot(cartridgeWispRoute));
    if (cartridgeWispTwirlA.lengthSq() < 0.0001) {
      cartridgeWispTwirlA.set(1, 0, 0)
        .addScaledVector(cartridgeWispRoute, -cartridgeWispRoute.x);
    }
    cartridgeWispTwirlA.normalize();
    cartridgeWispTwirlB.crossVectors(cartridgeWispRoute, cartridgeWispTwirlA).normalize();

    const launchDistance = Math.min(cartridgeWispRouteLength * 0.24, 0.62);
    const arrivalLift = Math.min(cartridgeWispRouteLength * 0.18, 0.48);
    cartridgeWispControlA.copy(cartridgeWispSource)
      .addScaledVector(cartridgeWispDown, launchDistance)
      .addScaledVector(cartridgeWispAcross, emitterHalfWidth * seed.curl * 0.26);
    cartridgeWispControlB.copy(cartridgeWispTarget)
      .addScaledVector(cartridgeWispRoute, -arrivalLift);

    cartridgeWispColor.copy(cartridgeWispCool).lerp(cartridgeWispWarm, seed.hue);
    const pointAlpha = cartridgeWispVisibility *
      cartridgeWispSmoothstep(0.015, 0.12, progress) *
      (1 - cartridgeWispSmoothstep(0.72, 0.995, progress));
    sampleCartridgeWisp(progress, seed, cartridgeWispSampleA);
    writeCartridgeWispVector(cartridgeWispPointPositions, index * 3, cartridgeWispSampleA);
    writeCartridgeWispVector(cartridgeWispPointColors, index * 3, cartridgeWispColor);
    cartridgeWispPointAlphas[index] = pointAlpha;

    for (let segment = 0; segment < CARTRIDGE_WISP_TRAIL_SEGMENTS; segment += 1) {
      const frontProgress = progress - segment * 0.018;
      const backProgress = progress - (segment + 1) * 0.018;
      const frontValid = frontProgress >= 0;
      const backValid = backProgress >= 0;
      sampleCartridgeWisp(Math.max(0, frontProgress), seed, cartridgeWispSampleA);
      sampleCartridgeWisp(Math.max(0, backProgress), seed, cartridgeWispSampleB);
      const trailFade = 1 - segment / CARTRIDGE_WISP_TRAIL_SEGMENTS;
      const frontAlpha = frontValid ? cartridgeWispVisibility * trailFade *
        cartridgeWispSmoothstep(0.015, 0.12, frontProgress) *
        (1 - cartridgeWispSmoothstep(0.68, 0.995, frontProgress)) : 0;
      const backAlpha = backValid ? cartridgeWispVisibility * trailFade * 0.72 *
        cartridgeWispSmoothstep(0.015, 0.12, backProgress) *
        (1 - cartridgeWispSmoothstep(0.68, 0.995, backProgress)) : 0;
      writeCartridgeWispVector(
        cartridgeWispLinePositions, lineVertex * 3, cartridgeWispSampleA
      );
      writeCartridgeWispVector(
        cartridgeWispLineColors, lineVertex * 3, cartridgeWispColor
      );
      cartridgeWispLineAlphas[lineVertex] = frontAlpha;
      lineVertex += 1;
      writeCartridgeWispVector(
        cartridgeWispLinePositions, lineVertex * 3, cartridgeWispSampleB
      );
      writeCartridgeWispVector(
        cartridgeWispLineColors, lineVertex * 3, cartridgeWispColor
      );
      cartridgeWispLineAlphas[lineVertex] = backAlpha;
      lineVertex += 1;
    }
  }

  cartridgeWispLineGeometry.attributes.position.needsUpdate = true;
  cartridgeWispLineGeometry.attributes.color.needsUpdate = true;
  cartridgeWispLineGeometry.attributes.alpha.needsUpdate = true;
  cartridgeWispPointGeometry.attributes.position.needsUpdate = true;
  cartridgeWispPointGeometry.attributes.color.needsUpdate = true;
  cartridgeWispPointGeometry.attributes.alpha.needsUpdate = true;
}

cartridgeControl.addEventListener('pointerenter', () => { cartridgeHovered = true; });
cartridgeControl.addEventListener('pointerleave', () => {
  cartridgeHovered = false;
  if (!cartridgeDragging) cartridgePressed = false;
});

function getConsoleCollisionGeometry(receiver) {
  let centerX = receiver.left + receiver.width * 0.5;
  let slotY = receiver.top + receiver.height * 0.32;
  if (consoleMouthAnchor) {
    consoleMouthAnchor.getWorldPosition(cartridgeMouthWorld);
    cartridgeWorldToScreen(cartridgeMouthWorld, cartridgeMouthScreen);
    centerX = cartridgeMouthScreen.x;
    slotY = cartridgeMouthScreen.y;
  }
  const cartridgeHalfWidth = receiver.width * 0.21;
  const cartridgeHalfHeight = receiver.width * 0.14;
  const shellInsetX = receiver.width * 0.065;
  const shellInsetTop = receiver.height * 0.24;
  const shellInsetBottom = receiver.height * 0.04;
  const clearance = Math.max(5, receiver.width * 0.014);
  const obstacleLeft = receiver.left + shellInsetX - cartridgeHalfWidth - clearance;
  const obstacleRight = receiver.right - shellInsetX + cartridgeHalfWidth + clearance;
  const obstacleTop = receiver.top + shellInsetTop - cartridgeHalfHeight - clearance;
  const obstacleBottom = receiver.bottom - shellInsetBottom + cartridgeHalfHeight + clearance;
  return {
    centerX,
    slotY,
    slotCaptureHalfWidth: Math.max(10, receiver.width * 0.05),
    slotEntryY: slotY - receiver.height * 0.11,
    slotCaptureY: slotY - receiver.height * 0.025,
    slotExitY: slotY + receiver.height * 0.075,
    obstacleLeft,
    obstacleRight,
    obstacleTop,
    obstacleBottom,
    cornerRadius: Math.max(42, receiver.width * 0.15),
    safeY: obstacleTop - Math.max(10, receiver.width * 0.025),
    leftLaneX: obstacleLeft - Math.max(12, receiver.width * 0.035),
    rightLaneX: obstacleRight + Math.max(12, receiver.width * 0.035),
    belowLaneY: obstacleBottom + Math.max(12, receiver.width * 0.035),
  };
}

function consoleColliderSdf(clientX, clientY, collision) {
  const centerX = (collision.obstacleLeft + collision.obstacleRight) * 0.5;
  const centerY = (collision.obstacleTop + collision.obstacleBottom) * 0.5;
  const halfWidth = (collision.obstacleRight - collision.obstacleLeft) * 0.5;
  const halfHeight = (collision.obstacleBottom - collision.obstacleTop) * 0.5;
  const radius = Math.min(collision.cornerRadius, halfWidth - 1, halfHeight - 1);
  const qx = Math.abs(clientX - centerX) - (halfWidth - radius);
  const qy = Math.abs(clientY - centerY) - (halfHeight - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) - radius;
}

function cartridgeFitsSlotPassage(clientX, clientY, collision) {
  return Math.abs(clientX - collision.centerX) <= collision.slotCaptureHalfWidth &&
    clientY >= collision.obstacleTop - 2 && clientY <= collision.slotExitY;
}

function resolveCartridgeConsoleCollision(receiver) {
  if (cartridgeState !== CARTRIDGE_STATE.DRAGGING || cartridgeRouteActive) return;
  const collision = getConsoleCollisionGeometry(receiver);
  cartridgeWorldToScreen(cartridgePhysicsPosition, cartridgeCollisionScreen);
  if (cartridgeFitsSlotPassage(
    cartridgeCollisionScreen.x, cartridgeCollisionScreen.y, collision
  )) {
    hardwareInset.dataset.collision = 'slot-clear';
    return;
  }

  const distance = consoleColliderSdf(
    cartridgeCollisionScreen.x, cartridgeCollisionScreen.y, collision
  );
  if (distance >= 0) {
    hardwareInset.dataset.collision = 'clear';
    return;
  }

  const epsilon = 1;
  let normalX = consoleColliderSdf(
    cartridgeCollisionScreen.x + epsilon, cartridgeCollisionScreen.y, collision
  ) - consoleColliderSdf(
    cartridgeCollisionScreen.x - epsilon, cartridgeCollisionScreen.y, collision
  );
  let normalY = consoleColliderSdf(
    cartridgeCollisionScreen.x, cartridgeCollisionScreen.y + epsilon, collision
  ) - consoleColliderSdf(
    cartridgeCollisionScreen.x, cartridgeCollisionScreen.y - epsilon, collision
  );
  const normalLength = Math.hypot(normalX, normalY) || 1;
  normalX /= normalLength;
  normalY /= normalLength;
  const correction = -distance + 0.8;
  cartridgeCollisionScreen.x += normalX * correction;
  cartridgeCollisionScreen.y += normalY * correction;
  screenToCartridgeWorld(
    cartridgeCollisionScreen.x,
    cartridgeCollisionScreen.y,
    cartridgePhysicsPosition,
    cartridgePhysicsPosition.z
  );

  // The console is the fixed rigid body. Remove the cartridge's inward normal
  // velocity, retain a little tangential motion, and add a tiny restitution so
  // a miss feels like a solid catch rather than a positional clamp.
  const normalWorldX = normalX;
  const normalWorldY = -normalY;
  const inwardVelocity = cartridgeVelocity.x * normalWorldX +
    cartridgeVelocity.y * normalWorldY;
  if (inwardVelocity < 0) {
    cartridgeVelocity.x -= inwardVelocity * 1.08 * normalWorldX;
    cartridgeVelocity.y -= inwardVelocity * 1.08 * normalWorldY;
  }
  cartridgeVelocity.x *= 0.74;
  cartridgeVelocity.y *= 0.74;
  hardwareInset.dataset.collision = 'contact';
}

function updateCartridgeDrag(e, trackVelocity = true) {
  cartridgePointerClientX = e.clientX;
  cartridgePointerClientY = e.clientY;
  screenToCartridgeWorld(e.clientX, e.clientY, cartridgePointerWorld);
  const now = e.timeStamp || performance.now();
  if (trackVelocity && cartridgeLastPointerTime) {
    const sampleDt = Math.max((now - cartridgeLastPointerTime) / 1000, 1 / 240);
    const blend = Math.min(1, sampleDt * 18);
    cartridgePointerVelocity.lerp(
      cartridgePointerWorld.clone().sub(cartridgePreviousPointerWorld).divideScalar(sampleDt),
      blend
    );
  }
  cartridgePreviousPointerWorld.copy(cartridgePointerWorld);
  cartridgeLastPointerTime = now;
  cartridgeDragTarget.copy(cartridgePointerWorld).add(cartridgeDragOffset);
  if (trackVelocity && consoleSnapAnchor) {
    const receiver = consoleControl.getBoundingClientRect();
    const collision = getConsoleCollisionGeometry(receiver);
    const receiverX = collision.centerX;
    const receiverY = collision.slotY;
    cartridgeWorldToScreen(cartridgeDragTarget, cartridgeCollisionScreen);
    if (!cartridgeEjectDrag) {
      const home = cartridgeControl.getBoundingClientRect();
      const homeY = home.top + home.height * 0.5;
      const travel = Math.max(1, receiverY - homeY);
      const verticalProgress = THREE.MathUtils.clamp(
        (cartridgeCollisionScreen.y - homeY) / travel, 0, 1
      );
      const rawSlotOffsetX = cartridgeCollisionScreen.x - receiverX;
      const coneHalfWidth = THREE.MathUtils.lerp(
        receiver.width * 0.55,
        receiver.width * 0.19,
        verticalProgress
      );
      const coneRatio = Math.abs(rawSlotOffsetX) / Math.max(1, coneHalfWidth);
      let magneticStrength = 0;
      if (cartridgeCollisionScreen.y <= collision.slotExitY && coneRatio < 1) {
        const proximity = THREE.MathUtils.clamp(
          (verticalProgress - 0.22) / 0.78, 0, 1
        );
        const proximityEase = proximity * proximity * (3 - 2 * proximity);
        const edgeWeight = 1 - THREE.MathUtils.clamp(
          (coneRatio - 0.68) / 0.32, 0, 1
        );
        magneticStrength = CARTRIDGE_MAGNET_MAX * proximityEase * proximityEase * edgeWeight;
        if (magneticStrength > 0) {
          cartridgeCollisionScreen.x = THREE.MathUtils.lerp(
            cartridgeCollisionScreen.x, receiverX, magneticStrength
          );
          const dragDepth = cartridgeDragTarget.z;
          screenToCartridgeWorld(
            cartridgeCollisionScreen.x,
            cartridgeCollisionScreen.y,
            cartridgeDragTarget,
            dragDepth
          );
        }
      }
      hardwareInset.dataset.magnetism = magneticStrength.toFixed(3);
      const slotOffsetX = cartridgeCollisionScreen.x - receiverX;
      const horizontalAlignment = 1 - THREE.MathUtils.clamp(
        Math.abs(slotOffsetX) / (receiver.width * 0.85), 0, 1
      );
      const approach = verticalProgress * verticalProgress * (3 - 2 * verticalProgress);
      const entryProgress = THREE.MathUtils.clamp((verticalProgress - 0.04) / 0.44, 0, 1);
      const entryEase = entryProgress * entryProgress * (3 - 2 * entryProgress);
      const slotAlignment = entryEase * horizontalAlignment;
      const continuousApproach = CONSOLE_PRESS_CUE +
        (1 - CONSOLE_PRESS_CUE) * approach;
      consoleApproachTarget = continuousApproach * horizontalAlignment;
      cartridgeEntryTarget = slotAlignment;
      // The cursor continues to own X/Y, while the approach easing moves the
      // cartridge onto the receiver's authored depth plane. This keeps a
      // straight-down drag physically coplanar with the slot at entry instead
      // of leaving the cartridge slightly closer to the camera.
      alignCartridgeDragDepth(slotAlignment);
    }
  }
}

function tryBeginPhysicalCartridgeInsertion(receiver, allowGuidedTarget = false) {
  if (cartridgeState !== CARTRIDGE_STATE.DRAGGING || cartridgeEjectDrag ||
      cartridgeRouteActive) return false;
  const collision = getConsoleCollisionGeometry(receiver);
  cartridgeWorldToScreen(cartridgePhysicsPosition, cartridgeRouteScreen);
  let insideCapture =
    Math.abs(cartridgeRouteScreen.x - collision.centerX) <=
      collision.slotCaptureHalfWidth &&
    cartridgeRouteScreen.y >= collision.slotCaptureY;
  const bodyIsAtMouth =
    Math.abs(cartridgeRouteScreen.x - collision.centerX) <=
      collision.slotCaptureHalfWidth * 1.35 &&
    cartridgeRouteScreen.y >= collision.slotCaptureY - receiver.height * 0.035;
  if (!insideCapture && (bodyIsAtMouth || allowGuidedTarget)) {
    // The spring-driven body can trail the pointer during a fast pull. Treat
    // the guided target as a swept collision only once the visible cartridge
    // is already beside the mouth. This prevents it from leaving the cursor
    // early while still catching a last-frame threshold crossing.
    cartridgeWorldToScreen(cartridgeDragTarget, cartridgeCollisionScreen);
    insideCapture =
      Math.abs(cartridgeCollisionScreen.x - collision.centerX) <=
        collision.slotCaptureHalfWidth &&
      cartridgeCollisionScreen.y >= collision.slotCaptureY;
  }
  if (!insideCapture) return false;

  // Commit at the visually seated point. Clamp to the slot mouth before the
  // short insertion route so a fast downward frame can never penetrate the
  // console or make the route reverse upward from an overshot position.
  screenToCartridgeWorld(
    collision.centerX,
    collision.slotCaptureY,
    cartridgePhysicsPosition,
    cartridgeSocketWorld.z
  );
  cartridgeVelocity.set(0, 0, 0);

  beginCartridgeInsertionRoute(receiver, collision);
  setCartridgeState(CARTRIDGE_STATE.INSERTING);
  consoleApproachTarget = 1;
  cartridgeEntryTarget = 1;
  return true;
}

function startCartridgeFaceTurn() {
  let frontDelta = Math.atan2(
    Math.sin(CARTRIDGE_FRONT_YAW - cartridgeYaw),
    Math.cos(CARTRIDGE_FRONT_YAW - cartridgeYaw)
  );
  // Positive yaw matches the authored clockwise idle direction. Keep adding a
  // winding until the clockwise route is longer than half a turn.
  if (CARTRIDGE_FACE_TURN_DIRECTION > 0) {
    while (frontDelta <= Math.PI) frontDelta += Math.PI * 2;
  } else {
    while (frontDelta >= -Math.PI) frontDelta -= Math.PI * 2;
  }
  cartridgeFaceTurnTarget = cartridgeYaw + frontDelta;
  cartridgeFaceTurnActive = true;
  cartridgeYawVelocity = Math.sign(frontDelta) * Math.max(
    Math.abs(cartridgeYawVelocity), CARTRIDGE_FACE_TURN_LAUNCH_SPEED
  );
}

function finishCartridgeDrag(e, cancelled = false) {
  if (e.pointerId !== cartridgeDragPointerId) return;
  if (!cancelled) playCartridgeSound('release');
  if (!cartridgeDragging) {
    cartridgePressed = false;
    if (!cancelled && cartridgeState === CARTRIDGE_STATE.FREE) {
      startCartridgeFaceTurn();
    }
    if (cartridgeControl.hasPointerCapture(e.pointerId)) {
      cartridgeControl.releasePointerCapture(e.pointerId);
    }
    cartridgeDragPointerId = null;
    return;
  }
  const pulledFromConsole = cartridgeEjectDrag;
  if (!cancelled) updateCartridgeDrag(e);
  if (!cancelled && cartridgeState === CARTRIDGE_STATE.DRAGGING && consoleSnapAnchor) {
    const receiver = consoleControl.getBoundingClientRect();
    // On release, honor the guided pointer target even if the spring-driven
    // shell is still catching up to a quick downward drag.
    tryBeginPhysicalCartridgeInsertion(receiver, true);
  }
  if (cancelled) {
    setCartridgeState(CARTRIDGE_STATE.FREE);
  } else if (cartridgeState === CARTRIDGE_STATE.INSERTING) {
    startCartridgeBoot(clock.elapsedTime);
  } else {
    setCartridgeState(CARTRIDGE_STATE.FREE);
  }
  cartridgeDragging = false;
  cartridgeEjectDrag = false;
  hardwareInset.dataset.collision = 'idle';
  hardwareInset.dataset.magnetism = '0.000';
  consoleApproachTarget = 0;
  if (cartridgeState !== CARTRIDGE_STATE.BOOTING &&
      cartridgeState !== CARTRIDGE_STATE.RUNNING) cartridgeEntryTarget = 0;
  cartridgePressed = false;
  if (!cancelled && !pulledFromConsole) {
    cartridgeVelocity.addScaledVector(cartridgePointerVelocity, 0.24);
  }
  if (!cancelled && !pulledFromConsole && cartridgeState === CARTRIDGE_STATE.FREE) {
    startCartridgeFaceTurn();
  }
  if (cartridgeControl.hasPointerCapture(e.pointerId)) {
    cartridgeControl.releasePointerCapture(e.pointerId);
  }
  cartridgeDragPointerId = null;
}

function beginCartridgeDrag(e) {
  if (cartridgeDragging || e.pointerId !== cartridgeDragPointerId) return;
  cartridgeDragging = true;
  cartridgeLastPointerTime = 0;
  cartridgePointerVelocity.set(0, 0, 0);
  const pullingFromConsole = cartridgeState === CARTRIDGE_STATE.BOOTING ||
    cartridgeState === CARTRIDGE_STATE.RUNNING;
  cartridgeEjectDrag = pullingFromConsole;
  hardwareInset.dataset.collision = pullingFromConsole ? 'ejecting' : 'clear';
  hardwareInset.dataset.magnetism = '0.000';
  consoleApproachTarget = pullingFromConsole ? 0 : CONSOLE_PRESS_CUE;
  cartridgeEntryTarget = pullingFromConsole ? 1 : 0;
  setCartridgeState(pullingFromConsole
    ? CARTRIDGE_STATE.EJECTING
    : CARTRIDGE_STATE.DRAGGING);
  screenToCartridgeWorld(e.clientX, e.clientY, cartridgePointerWorld);
  cartridgeDragOffset.copy(cartridgePhysicsPosition).sub(cartridgePointerWorld);
  cartridgeDragOffset.z = 0;
  cartridgeDragTarget.copy(cartridgePointerWorld).add(cartridgeDragOffset);
  cartridgePreviousPointerWorld.copy(cartridgePointerWorld);
  cartridgePointerClientX = e.clientX;
  cartridgePointerClientY = e.clientY;
  if (pullingFromConsole && consoleSnapAnchor) {
    const receiver = consoleControl.getBoundingClientRect();
    beginCartridgeEjectionRoute(receiver, getConsoleCollisionGeometry(receiver));
  }
}

function trackCartridgePointer(e) {
  if (e.pointerId !== cartridgeDragPointerId) return;
  cartridgeDragDistance = Math.max(
    cartridgeDragDistance,
    Math.hypot(e.clientX - cartridgePointerStartX, e.clientY - cartridgePointerStartY)
  );
  if (!cartridgeDragging && cartridgeDragDistance >= CARTRIDGE_DRAG_THRESHOLD) {
    beginCartridgeDrag(e);
  }
  if (cartridgeDragging) updateCartridgeDrag(e);
}

cartridgeControl.addEventListener('pointerdown', e => {
  cartridgePressed = true;
  cartridgeDragPointerId = e.pointerId;
  cartridgeDragDistance = 0;
  cartridgePointerStartX = e.clientX;
  cartridgePointerStartY = e.clientY;
  screenToCartridgeWorld(e.clientX, e.clientY, cartridgePointerWorld);
  cartridgeDragOffset.copy(cartridgePhysicsPosition).sub(cartridgePointerWorld);
  cartridgeDragOffset.z = 0;
  cartridgeDragTarget.copy(cartridgePointerWorld).add(cartridgeDragOffset);
  cartridgePreviousPointerWorld.copy(cartridgePointerWorld);
  cartridgePointerClientX = e.clientX;
  cartridgePointerClientY = e.clientY;
  playCartridgeSound('press');
  cartridgeControl.setPointerCapture(e.pointerId);
  // A press stays a click until the pointer crosses the drag threshold. This
  // prevents a normal click from briefly entering the insertion physics.
  e.preventDefault();
});
cartridgeControl.addEventListener('pointermove', e => {
  trackCartridgePointer(e);
});
window.addEventListener('pointermove', e => {
  if (e.target === cartridgeControl) return;
  trackCartridgePointer(e);
});
cartridgeControl.addEventListener('pointerup', e => finishCartridgeDrag(e));
cartridgeControl.addEventListener('pointercancel', e => finishCartridgeDrag(e, true));
window.addEventListener('pointerup', e => {
  finishCartridgeDrag(e);
  cartridgePressed = false;
});
cartridgeControl.addEventListener('click', e => {
  // Pointer releases are handled above. Keep keyboard activation equivalent.
  if (e.detail === 0 && cartridgeState === CARTRIDGE_STATE.FREE) {
    startCartridgeFaceTurn();
  }
});
let cartridgeKeyboardPressed = false;
cartridgeControl.addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat &&
      cartridgeState === CARTRIDGE_STATE.FREE) {
    cartridgeKeyboardPressed = true;
    playCartridgeSound('press');
  }
});
cartridgeControl.addEventListener('keyup', e => {
  if ((e.key === ' ' || e.key === 'Enter') && cartridgeKeyboardPressed) {
    cartridgeKeyboardPressed = false;
    playCartridgeSound('release');
  }
});

new GLTFLoader().load(cartridgeModelUrl, (gltf) => {
  cartridgeModel = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(cartridgeModel);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  cartridgeModel.position.sub(center);
  cartridgeModel.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.material = cartridgeMaterial;
  });
  const labelArtwork = new THREE.Mesh(
    new THREE.PlaneGeometry(CARTRIDGE_LABEL_PANEL.width, CARTRIDGE_LABEL_PANEL.height),
    cartridgeLabelMaterial
  );
  labelArtwork.name = 'CartridgeLabelArtwork';
  labelArtwork.position.set(
    CARTRIDGE_LABEL_PANEL.frontX,
    CARTRIDGE_LABEL_PANEL.centerY,
    CARTRIDGE_LABEL_PANEL.centerZ
  );
  labelArtwork.rotation.y = Math.PI * 0.5;
  labelArtwork.renderOrder = 1;
  cartridgeModel.add(labelArtwork);
  cartridgeVisual.add(cartridgeModel);
  cartridgeUnitH = size.y;
  cartridgeUnitW = size.z;
  cartridgeUnitD = size.x;
  resize();
}, undefined, error => console.error('Could not load cartridge GLB', error));

new GLTFLoader().load(consoleModelUrl, (gltf) => {
  consoleModel = gltf.scene;
  consoleSnapAnchor = consoleModel.getObjectByName('CartridgeSnapAnchor');
  consoleMouthAnchor = consoleModel.getObjectByName('CartridgeMouthAnchor');
  hardwareInset.dataset.snapAnchor = consoleSnapAnchor && consoleMouthAnchor
    ? 'ready'
    : 'missing';
  const bounds = new THREE.Box3().setFromObject(consoleModel);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  consoleModel.position.sub(center);
  consoleModel.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const letterKey = Object.keys(funLetterMaterials).find(key => o.name.startsWith(key));
    if (letterKey) o.material = funLetterMaterials[letterKey];
  });
  consoleVisual.add(consoleModel);
  // In glTF/Three.js the fitted asset is +X front, +Y up, and +Z width.
  // Map those axes to a slightly elevated front view: the top faces the
  // camera while the controller ports remain readable along the lower edge.
  const consoleFront = new THREE.Vector3(0, -0.42, 0.907).normalize();
  const consoleUp = new THREE.Vector3(0, 0.907, 0.42).normalize();
  const consoleWidth = new THREE.Vector3(-1, 0, 0);
  consoleVisual.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(consoleFront, consoleUp, consoleWidth)
  );
  consoleRestQuaternion.copy(consoleVisual.quaternion);
  const consoleInviteFront = new THREE.Vector3(0, -0.30, 0.954).normalize();
  const consoleInviteUp = new THREE.Vector3(0, 0.954, 0.30).normalize();
  consoleInviteQuaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(consoleInviteFront, consoleInviteUp, consoleWidth)
  );
  consoleUnitW = size.z;
  resize();
}, undefined, error => console.error('Could not load fitted console GLB', error));

let mesh = null;   // set when the GLB loads
let pointerTipIndex = -1;
const pointerTipLocal = new THREE.Vector3();

function pinPointerTip() {
  if (!mesh || pointerTipIndex < 0) return;
  // Keep the skinned fingertip at the hand pivot. Every wrist/hand transform
  // then rotates or scales around the pointer instead of dragging it away.
  mesh.updateMatrixWorld(true);
  mesh.getVertexPosition(pointerTipIndex, pointerTipLocal);
  mesh.position.copy(pointerTipLocal).negate();
}

// ---------------------------------------------------------------------------
// GLB hand (Meshy): welded, lightly smoothed, aligned into hand-local space,
// distance-skinned to the retargeted skeleton.
// ---------------------------------------------------------------------------
const GLB_ALIGN = {
  scale: 2.4,
  rotX: 0, rotY: 0, rotZ: -0.55,
  offX: 0, offY: 0, offZ: 0,
  tweak: { thumb: 2.2, middle: 0.2, ring: 0.15, pinky: 0.1 },
};
window.__glbAlign = GLB_ALIGN;

new GLTFLoader().load(cursorModelUrl, (gltf) => {
  let src = null;
  gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
  if (!src) return;
  let g = src.geometry.clone();
  for (const name of ['tangent', 'uv', 'normal', 'uv1', 'uv2', 'color'])
    if (g.getAttribute(name)) g.deleteAttribute(name);
  g = mergeVertices(g, 1e-4);

  // Light Laplacian smoothing — a touch, to match our soft blob style.
  {
    const posAttr = g.getAttribute('position');
    const idx = g.getIndex().array;
    const n = posAttr.count;
    const pts = posAttr.array;
    const neighbors = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      neighbors[a].add(b).add(c); neighbors[b].add(a).add(c); neighbors[c].add(a).add(b);
    }
    for (let iter = 0; iter < 2; iter++) {
      const next = pts.slice();
      for (let vi = 0; vi < n; vi++) {
        let sx = 0, sy = 0, sz = 0;
        const nb = neighbors[vi];
        for (const nn of nb) { sx += pts[nn * 3]; sy += pts[nn * 3 + 1]; sz += pts[nn * 3 + 2]; }
        const inv = 1 / nb.size, L = 0.45;
        next[vi * 3]     += (sx * inv - pts[vi * 3]) * L;
        next[vi * 3 + 1] += (sy * inv - pts[vi * 3 + 1]) * L;
        next[vi * 3 + 2] += (sz * inv - pts[vi * 3 + 2]) * L;
      }
      pts.set(next);
    }
    posAttr.needsUpdate = true;
  }

  window.__applyGlb = () => {
    const A = window.__glbAlign;
    const g2 = g.clone();
    const m = new THREE.Matrix4()
      .makeTranslation(A.offX, A.offY, A.offZ)
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(A.rotX, A.rotY, A.rotZ)))
      .multiply(new THREE.Matrix4().makeScale(A.scale, A.scale, A.scale));
    g2.applyMatrix4(m);
    g2.computeVertexNormals();

    // Distance-skin to our bones with capsule weighting.
    const posAttr = g2.getAttribute('position');
    const n = posAttr.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const p = new THREE.Vector3();
    const dists = new Array(bones.length);
    for (let vi = 0; vi < n; vi++) {
      p.fromBufferAttribute(posAttr, vi);
      dists.fill(Infinity);
      dists[0] = sdRoot(p);
      for (const c of capsules) {
        const d = sdCapsule(p, c.a, c.b, c.r);
        if (d < dists[c.bone]) dists[c.bone] = d;
      }
      const scored = dists.map((d, bi) => ({ bi, w: Math.pow(Math.max(d + 0.05, 0.01), -4) }));
      scored.sort((a, b) => b.w - a.w);
      let total = 0;
      for (let k = 0; k < 4; k++) total += scored[k].w;
      for (let k = 0; k < 4; k++) {
        si[vi * 4 + k] = scored[k].bi;
        sw[vi * 4 + k] = scored[k].w / total;
      }
    }
    g2.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g2.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));

    // Rest pose (tweaks zeroed: the GLB's authored pose IS the bind pose;
    // tweaks then act as live deltas that tuck thumb + tighten fingers).
    poseTweak.pinky = poseTweak.ring = poseTweak.middle = poseTweak.thumb = 0;
    for (const f of rigs) { f.jig.a = 0; f.jig.v = 0; }
    poseFingers(0);
    const newMesh = new THREE.SkinnedMesh(g2, gloveMat);
    newMesh.frustumCulled = false;
    newMesh.renderOrder = 1000;
    newMesh.add(rootBone);
    newMesh.updateMatrixWorld(true);
    newMesh.bind(new THREE.Skeleton(bones));
    if (mesh) hand.remove(mesh);
    mesh = newMesh;
    hand.add(mesh);
    Object.assign(poseTweak, A.tweak || {});

    g2.computeBoundingBox();
    handUnitH = (g2.boundingBox.max.y - g2.boundingBox.min.y) * hand.scale.y;

    // Hotspot: extreme vertex along the index direction (up-right). Measure
    // the live skinned point rather than the undeformed geometry, then move
    // the mesh itself so every outer transform pivots around the fingertip.
    {
      const posAttr2 = g2.getAttribute('position');
      const dirX = Math.sin(-INDEX_REST_Z), dirY = Math.cos(-INDEX_REST_Z);
      let bestS = -1e9;
      pointerTipIndex = 0;
      for (let vi = 0; vi < posAttr2.count; vi++) {
        const x = posAttr2.getX(vi), y = posAttr2.getY(vi);
        const sscore = x * dirX + y * dirY;
        if (sscore > bestS) { bestS = sscore; pointerTipIndex = vi; }
      }
      for (const f of rigs) { f.jig.a = 0; f.jig.v = 0; }
      poseFingers(0, 0);
      hand.position.set(0, 0, 0);
      pinPointerTip();
    }
    resize();
    customCursorMeshReady = true;
    syncCustomCursorAvailability();
  };
  window.__applyGlb();
}, undefined, error => {
  console.error('Could not load hand cursor GLB', error);
  customCursorMeshReady = false;
  syncCustomCursorAvailability();
});

window.__dbg = { scene, camera, rt, renderer, bones, rigs, hand, wrist, glove, gloveLog,
  gloveState: () => ({ hidden: gloveHidden, presence: glovePresence, inside: lastPointer.inside,
    fallback: fallbackCursorEl?.tagName }),
  qPoint, qGrab, capsules, cartridgeRig, cartridgeVisual,
  consoleRig, consoleVisual, funLetterMaterials };

// ---------------------------------------------------------------------------
// Springy physics
// ---------------------------------------------------------------------------
const mouse = new THREE.Vector2(0, 0);
const pos = new THREE.Vector3(0, 0, 0);
const vel = new THREE.Vector3();
const accelSmooth = new THREE.Vector3();
const prevVel = new THREE.Vector3();
const rot = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
let grabAmount = 0;
let grabbing = false;
let gripTarget = 0, gripAmount = 0;   // closed-fist pose, see setGrip()
// Open/close the fist independently of the click gesture. Animates through
// the same rig and springs, so it waggles and jiggles like everything else.
window.setGrip = v => { gripTarget = THREE.MathUtils.clamp(v, 0, 1); };

function setHandCursorPressed(pressed, root = document.documentElement) {
  root.classList.toggle('is-hand-cursor-pressed', pressed);
  grabbing = pressed;
}

const ndc = new THREE.Vector2();
const GLOVE_DEPTH = 0.55;
const rayPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -GLOVE_DEPTH);
const raycaster = new THREE.Raycaster();
const worldPt = new THREE.Vector3();
const cartridgeTarget = new THREE.Vector3();
const consoleTarget = new THREE.Vector3();
const mainHardwareTvTarget = new THREE.Vector3();

function screenToSceneWorld(clientX, clientY, z, target) {
  const planeViewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) *
    Math.abs(camera.position.z - z);
  return target.set(
    ((clientX / window.innerWidth) * 2 - 1) * planeViewHeight * camera.aspect * 0.5,
    (1 - (clientY / window.innerHeight) * 2) * planeViewHeight * 0.5,
    z
  );
}

function screenToCartridgeWorld(clientX, clientY, target, z = CARTRIDGE_DRAG_Z) {
  return screenToSceneWorld(clientX, clientY, z, target);
}

function cartridgeWorldToScreen(world, target) {
  const planeViewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) *
    Math.abs(camera.position.z - world.z);
  return target.set(
    (world.x / (planeViewHeight * camera.aspect * 0.5) + 1) * window.innerWidth * 0.5,
    (1 - world.y / (planeViewHeight * 0.5)) * window.innerHeight * 0.5
  );
}

let godRayVisibility = 0;
const godRayCartridgeWorld = new THREE.Vector3();
const godRayCartridgeScreen = new THREE.Vector2();

function godRayPath(sourceX, focusX, focusY, consoleX, bottomY,
                    sourceHalfWidth, focusHalfWidth, bottomHalfWidth) {
  const lowerSpan = Math.max(1, bottomY - focusY);
  return [
    `M ${sourceX - sourceHalfWidth} -40`,
    `C ${sourceX - sourceHalfWidth * 0.78} ${focusY * 0.3}`,
    `${focusX - focusHalfWidth * 0.88} ${focusY * 0.78}`,
    `${focusX - focusHalfWidth} ${focusY}`,
    `C ${focusX - focusHalfWidth * 1.08} ${focusY + lowerSpan * 0.24}`,
    `${consoleX - bottomHalfWidth * 0.84} ${bottomY - lowerSpan * 0.2}`,
    `${consoleX - bottomHalfWidth} ${bottomY}`,
    `L ${consoleX + bottomHalfWidth} ${bottomY}`,
    `C ${consoleX + bottomHalfWidth * 0.84} ${bottomY - lowerSpan * 0.2}`,
    `${focusX + focusHalfWidth * 1.08} ${focusY + lowerSpan * 0.24}`,
    `${focusX + focusHalfWidth} ${focusY}`,
    `C ${focusX + focusHalfWidth * 0.88} ${focusY * 0.78}`,
    `${sourceX + sourceHalfWidth * 0.78} ${focusY * 0.3}`,
    `${sourceX + sourceHalfWidth} -40 Z`,
  ].join(' ');
}

function updateGodRay(now, dt) {
  const beamAvailable = cartridgeModel && consoleModel && cartridgePhysicsReady;
  const beamActive = beamAvailable &&
    cartridgeState !== CARTRIDGE_STATE.BOOTING &&
    cartridgeState !== CARTRIDGE_STATE.RUNNING;
  const visibilityGoal = beamActive ? 1 : 0;
  const visibilityRate = visibilityGoal > godRayVisibility ? 2.4 : 8.5;
  godRayVisibility += (visibilityGoal - godRayVisibility) *
    Math.min(1, dt * visibilityRate);

  if (godRayVisibility < 0.002) {
    godRayLayer.style.opacity = '0';
    return;
  }

  cartridgeRig.updateMatrixWorld(true);
  cartridgeVisual.getWorldPosition(godRayCartridgeWorld);
  cartridgeWorldToScreen(godRayCartridgeWorld, godRayCartridgeScreen);

  const cartridgeRect = cartridgeControl.getBoundingClientRect();
  const consoleRect = consoleControl.getBoundingClientRect();
  const focusX = godRayCartridgeScreen.x;
  const focusY = godRayCartridgeScreen.y;
  const consoleX = consoleRect.left + consoleRect.width * 0.5;
  const consoleY = consoleRect.top + consoleRect.height * 0.42;
  const bottomY = Math.min(
    window.innerHeight + 70,
    consoleRect.bottom + consoleRect.height * 0.2
  );
  const sourceX = window.innerWidth * 0.5 +
    (focusX - window.innerWidth * 0.5) * 0.14;
  const cartridgeHalfWidth = THREE.MathUtils.clamp(
    cartridgeRect.width * 0.52, 56, 104
  );
  const consoleHalfWidth = THREE.MathUtils.clamp(
    consoleRect.width * 0.84, 180, 340
  );
  const shimmer = prefersReducedMotion ? 1 : 0.985 + Math.sin(now * 1.1) * 0.015;

  godRayOuter.setAttribute('d', godRayPath(
    sourceX, focusX, focusY, consoleX, bottomY,
    Math.max(32, window.innerWidth * 0.026),
    cartridgeHalfWidth * 1.35,
    consoleHalfWidth
  ));
  godRayMiddle.setAttribute('d', godRayPath(
    sourceX + 8, focusX, focusY, consoleX, bottomY,
    Math.max(16, window.innerWidth * 0.012),
    cartridgeHalfWidth * 0.82,
    consoleHalfWidth * 0.64
  ));
  godRayCore.setAttribute('d', godRayPath(
    sourceX - 5, focusX, focusY, consoleX, bottomY - consoleRect.height * 0.1,
    Math.max(7, window.innerWidth * 0.005),
    cartridgeHalfWidth * 0.34,
    consoleHalfWidth * 0.31
  ));

  godRayCartridgeHalo.setAttribute('cx', focusX);
  godRayCartridgeHalo.setAttribute('cy', focusY);
  godRayCartridgeHalo.setAttribute('rx', cartridgeHalfWidth * 1.42);
  godRayCartridgeHalo.setAttribute('ry', cartridgeHalfWidth * 0.86);
  godRayConsoleHaze.setAttribute('cx', consoleX);
  godRayConsoleHaze.setAttribute('cy', consoleY);
  godRayConsoleHaze.setAttribute('rx', consoleHalfWidth * 0.96);
  godRayConsoleHaze.setAttribute('ry', consoleRect.height * 0.55);
  godRayLayer.style.opacity = String(godRayVisibility * shimmer);
}

function alignCartridgeDragDepth(amount) {
  // Preserve the exact pointer-space X/Y while changing depth. Simply editing
  // world Z would shift the cartridge on screen under perspective projection.
  cartridgeWorldToScreen(cartridgeDragTarget, cartridgeCollisionScreen);
  const alignedZ = THREE.MathUtils.lerp(
    CARTRIDGE_DRAG_Z, cartridgeSocketWorld.z, amount
  );
  screenToCartridgeWorld(
    cartridgeCollisionScreen.x,
    cartridgeCollisionScreen.y,
    cartridgeDragTarget,
    alignedZ
  );
}

function pushCartridgeRouteScreenPoint(clientX, clientY) {
  const point = screenToCartridgeWorld(
    clientX, clientY, new THREE.Vector3(), CARTRIDGE_DRAG_Z
  );
  const previous = cartridgeRoutePoints[cartridgeRoutePoints.length - 1];
  if (!previous || previous.distanceToSquared(point) > 0.0004) {
    cartridgeRoutePoints.push(point);
  }
}

function setCartridgeRoute(kind, minDuration, maxDuration) {
  let routeLength = 0;
  for (let index = 1; index < cartridgeRoutePoints.length; index += 1) {
    routeLength += cartridgeRoutePoints[index - 1].distanceTo(cartridgeRoutePoints[index]);
  }
  cartridgeRouteDuration = THREE.MathUtils.clamp(
    routeLength / CARTRIDGE_ROUTE_SPEED, minDuration, maxDuration
  );
  cartridgeRouteProgress = 0;
  cartridgeRouteKind = kind;
  cartridgeRouteActive = true;
  cartridgeVelocity.set(0, 0, 0);
  hardwareInset.dataset.cartridgeRoute = kind;
}

function beginCartridgeInsertionRoute(receiver, collision) {
  cartridgeRoutePoints.length = 0;
  cartridgeRoutePoints.push(cartridgePhysicsPosition.clone());
  cartridgeRoutePoints.push(cartridgeSocketWorld.clone());
  cartridgeLockFeedbackPlayed = false;
  setCartridgeRoute('insert', 0.18, 0.28);
  hardwareInset.dataset.collision = 'slot-entered';
}

function beginCartridgeEjectionRoute(receiver, collision) {
  cartridgeRoutePoints.length = 0;
  cartridgeRoutePoints.push(cartridgePhysicsPosition.clone());
  pushCartridgeRouteScreenPoint(collision.centerX, collision.safeY);
  cartridgeEjectHoldWorld.copy(cartridgeRoutePoints[cartridgeRoutePoints.length - 1]);
  setCartridgeRoute('eject-pop', 0.34, 0.62);
}

function sampleCartridgeRoute(progress, target) {
  const last = cartridgeRoutePoints.length - 1;
  if (last < 1) return target.copy(cartridgeSocketWorld);
  if (cartridgeRouteKind === 'insert') {
    cartridgeRoutePoints[last].copy(cartridgeSocketWorld);
  }

  const lengths = [];
  let total = 0;
  for (let index = 1; index <= last; index += 1) {
    const length = cartridgeRoutePoints[index - 1].distanceTo(cartridgeRoutePoints[index]);
    lengths.push(length);
    total += length;
  }
  if (total < 1e-5) return target.copy(cartridgeSocketWorld);

  const eased = cartridgeRouteKind === 'eject-pop'
    ? 1 - (1 - progress) ** 3
    : progress * progress * (3 - 2 * progress);
  let remaining = eased * total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (remaining <= length || index === lengths.length - 1) {
      const local = length > 1e-5 ? THREE.MathUtils.clamp(remaining / length, 0, 1) : 1;
      return target.lerpVectors(
        cartridgeRoutePoints[index], cartridgeRoutePoints[index + 1], local
      );
    }
    remaining -= length;
  }
  return target.copy(cartridgeRoutePoints[last]);
}

function updateHardwareTargets() {
  const tvRect = tvControl.getBoundingClientRect();
  screenToSceneWorld(
    tvRect.left + tvRect.width * 0.5,
    tvRect.top + tvRect.height * 0.5,
    -0.70,
    mainHardwareTvTarget
  );

  const rect = cartridgeControl.getBoundingClientRect();
  const cx = rect.left + rect.width * 0.5;
  const cy = rect.top + rect.height * 0.5;
  screenToCartridgeWorld(cx, cy, cartridgeTarget, CARTRIDGE_IDLE_Z);

  const consoleRect = consoleControl.getBoundingClientRect();
  const consoleX = consoleRect.left + consoleRect.width * 0.5;
  const consoleY = consoleRect.top + consoleRect.height * 0.5;
  screenToSceneWorld(consoleX, consoleY, -0.92, consoleTarget);
}

function updateTargetFromEvent(e) {
  // A synthetic event without coordinates would feed NaN into every spring
  // downstream and never recover; ignore it rather than poison the rig.
  if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return false;
  lastPointer.x = e.clientX;
  lastPointer.y = e.clientY;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.ray.intersectPlane(rayPlane, worldPt);
  mouse.set(worldPt.x, worldPt.y);
  customCursorHasPosition = true;
  syncCustomCursorAvailability();
  return true;
}

function updateTargetFromEmbeddedGame(event) {
  const data = event.data;
  if (event.origin !== window.location.origin ||
      event.source !== embeddedGameFrame?.contentWindow ||
      data?.type !== 'opensmash-game-pointer') return;

  if (data.kind === 'up' || data.kind === 'cancel') {
    setHandCursorPressed(false);
    return;
  }

  const frameRect = embeddedGameFrame.getBoundingClientRect();
  const sourceWidth = Math.max(1, Number(data.viewportWidth) || frameRect.width);
  const sourceHeight = Math.max(1, Number(data.viewportHeight) || frameRect.height);
  if (!updateTargetFromEvent({
    clientX: frameRect.left + Number(data.x || 0) * frameRect.width / sourceWidth,
    clientY: frameRect.top + Number(data.y || 0) * frameRect.height / sourceHeight,
  })) return;
  lastPointer.inside = true;
  if (data.kind === 'down') setHandCursorPressed(true);
  if (data.kind === 'move' && Number(data.buttons) === 0) setHandCursorPressed(false);
  setGloveHidden(true, { reason: `game-frame:${data.kind}` });
}

function updateCursorFromPageEvent(event) {
  if (!updateTargetFromEvent(event)) return;
  if (event.type === 'pointerout' || event.type === 'mouseout') {
    // No relatedTarget means the pointer left the window (or moved onto the
    // browser's own chrome): poof out rather than freezing at the edge.
    if (event.relatedTarget === null) {
      lastPointer.inside = false;
      setHandCursorPressed(false);
      syncGloveHidden(`${event.type}:${event.target?.tagName?.toLowerCase() || '?'}`);
    }
    return;
  }
  lastPointer.inside = true;
  if (event.type === 'pointerover' || event.type === 'pointermove' ||
      event.type === 'mouseover' || event.type === 'mousemove') {
    const target = event.target;
    setGloveHidden(pointerShouldPoof(target, event.clientX, event.clientY), {
      reason: `${event.type}:${target?.tagName?.toLowerCase() || '?'}${target?.id ? '#' + target.id : ''}`,
      target,
    });
    if (gloveHidden) syncFallbackCursor(target);
  }
  if (event.type === 'pointerdown' || event.type === 'mousedown') {
    setHandCursorPressed(true);
  }
  if (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'mouseup') {
    setHandCursorPressed(false);
  }
  // A move with no mouse button held is authoritative even if pointerup was
  // captured by an iframe, browser chrome, or a component's pointer capture.
  if ((event.type === 'mousemove' ||
       (event.type === 'pointermove' && event.pointerType === 'mouse')) &&
      event.buttons === 0) {
    setHandCursorPressed(false);
  }
}

for (const eventType of [
  'pointerover', 'pointerout', 'pointermove', 'pointerdown', 'pointerup', 'pointercancel',
  'mouseover', 'mouseout', 'mousemove', 'mousedown', 'mouseup',
]) {
  window.addEventListener(eventType, updateCursorFromPageEvent, {
    capture: true,
    passive: true,
  });
}
window.addEventListener('blur', () => { setHandCursorPressed(false); });
window.addEventListener('focus', scheduleGloveSync);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Frames stop while hidden, so snap away without a puff; the return
    // re-derives the state and pops the glove back in where the pointer is.
    setHandCursorPressed(false);
    setGloveHidden(true, { silent: true, reason: 'visibilitychange:hidden' });
  } else {
    syncGloveHidden('visibilitychange:visible');
  }
});
// Layout and mode changes move the "should poof" boundary under a still pointer.
document.addEventListener('fullscreenchange', scheduleGloveSync);
window.addEventListener('resize', scheduleGloveSync);
window.addEventListener('scroll', scheduleGloveSync, { passive: true });
const gloveModeObserver = new MutationObserver(scheduleGloveSync);
gloveModeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
if (heroFrame) {
  gloveModeObserver.observe(heroFrame, { attributes: true, attributeFilter: ['class'] });
}
window.addEventListener('message', updateTargetFromEmbeddedGame);

// The emulator does not use mouse input, but it still needs keyboard focus.
// Its iframe is pointer-transparent so the parent can keep tracking the glove;
// focus it only after release so the hand's held-click tilt is not interrupted
// by the parent window losing focus mid-gesture.
embeddedGameFrame?.closest('.intro-video-frame')?.addEventListener('click', event => {
  if (!event.currentTarget.classList.contains('is-game-running')) return;
  if (event.target instanceof Element && event.target.closest('.game-fullscreen-control')) return;
  embeddedGameFrame.contentWindow?.focus();
});

// ---------------------------------------------------------------------------
// Debug capture: freeze the pose, render through the retro pipeline into a
// fixed 128-texel target, return/upload the cropped raw RGBA.
// ---------------------------------------------------------------------------
const rtOut = new THREE.WebGLRenderTarget(4, 4, {
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
});
window.captureGlove = (mode = 0) => {
  for (const f of rigs) { f.jig.a = 0; f.jig.v = 0; }
  poseFingers(mode === 2 ? 1 : 0, mode === 1 ? 1 : 0);
  hand.quaternion.copy(mode === 1 ? qGrip : mode === 2 ? qTap : qPoint);
  hand.scale.setScalar(0.62 * (mode === 1 ? GRIP.scale
                            : mode === 2 ? POINT.scale * 0.92 : POINT.scale));
  wrist.rotation.set(0, 0, 0);
  wrist.position.set(0, 0, 0);
  glove.position.set(0, 0, 0);
  pinPointerTip();
  const w = 128, h = 128;
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  rt.setSize(w, h);
  postMat.uniforms.res.value.set(w, h);
  applyGloveScale(h, GLOVE_PX);
  scene.updateMatrixWorld(true);
  rtOut.setSize(w, h);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  postMat.blending = THREE.NoBlending;
  renderer.setRenderTarget(rtOut);
  renderer.clear();
  renderer.render(postScene, postCam);
  postMat.blending = THREE.NormalBlending;
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rtOut, 0, 0, w, h, buf);
  renderer.setRenderTarget(null);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (buf[(y * w + x) * 4 + 3] > 0) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { error: 'empty' };
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const raw = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const src = ((maxY - y) * w + minX + x) * 4;
    const dst = (y * cw + x) * 4;
    for (let k = 0; k < 4; k++) raw[dst + k] = buf[src + k];
  }
  resize();
  return { w: cw, h: ch, raw };
};
window.uploadCaptures = async () => {
  const p = window.captureGlove(0), g = window.captureGlove(1);   // point, grip
  await fetch(`http://127.0.0.1:8602/cap_point_${p.w}x${p.h}.raw`, { method: 'POST', body: p.raw });
  await fetch(`http://127.0.0.1:8602/cap_grab_${g.w}x${g.h}.raw`, { method: 'POST', body: g.raw });
  return { point: [p.w, p.h], grab: [g.w, g.h] };
};

function setCartridgeState(next) {
  if (cartridgeState === next) return;
  cartridgeState = next;
  hardwareInset.dataset.cartridgeState = next;
  if (next === CARTRIDGE_STATE.FREE || next === CARTRIDGE_STATE.DRAGGING ||
      next === CARTRIDGE_STATE.EJECTING) {
    cartridgeRouteActive = false;
    cartridgeRouteKind = 'none';
    hardwareInset.dataset.cartridgeRoute = 'idle';
  }
  if (next === CARTRIDGE_STATE.EJECTING) restartStarterVideoPlayback();
  const gameRunning = next === CARTRIDGE_STATE.RUNNING;
  if (gameRunning) ensureStoneBackground();
  document.body.classList.toggle('is-game-booted', gameRunning);
  if (gameRunning) document.body.classList.add('is-intro-credit-visible');
  if (next !== CARTRIDGE_STATE.BOOTING && !gameRunning) {
    document.body.classList.remove('is-intro-credit-visible');
  }
  cartridgeControl.disabled = next === CARTRIDGE_STATE.BOOTING || gameRunning;
  if (next !== CARTRIDGE_STATE.BOOTING && next !== CARTRIDGE_STATE.RUNNING) {
    cartridgeInsertionTime = -1;
  }
  const labels = {
    [CARTRIDGE_STATE.FREE]: 'Drag the cartridge into the console',
    [CARTRIDGE_STATE.DRAGGING]: 'Dragging cartridge',
    [CARTRIDGE_STATE.INSERTING]: 'Release to insert the cartridge',
    [CARTRIDGE_STATE.BOOTING]: 'Cartridge inserted. Game booting',
    [CARTRIDGE_STATE.RUNNING]: 'Game running. Drag the cartridge out to reset',
    [CARTRIDGE_STATE.EJECTING]: 'Cartridge lifting out of the console',
  };
  cartridgeControl.setAttribute('aria-label', labels[next]);
}

function startStarterVideoPlayback() {
  controlEmbeddedTrailer(introVideo, 'playVideo');
}

function restartStarterVideoPlayback() {
  controlEmbeddedTrailer(introVideo, 'seekTo', [0, true]);
  startStarterVideoPlayback();
}

startStarterVideoPlayback();

function startCartridgeBoot(now) {
  setCartridgeState(CARTRIDGE_STATE.BOOTING);
  // Auto-insert begins booting before its route is fully seated. Start the
  // reveal choreography only when the insert route has actually completed.
  cartridgeInsertionTime = cartridgeRouteActive ? -1 : now;
  if (!cartridgeRouteActive) startStarterVideoPlayback();
  cartridgeYawVelocity = 0;
  cartridgeVelocity.set(0, 0, 0);
}

function updateFunLights(now) {
  let f = 0, u = 0, n = 0;
  if ((cartridgeState === CARTRIDGE_STATE.BOOTING ||
       cartridgeState === CARTRIDGE_STATE.RUNNING) && cartridgeInsertionTime >= 0) {
    const elapsed = now - cartridgeInsertionTime;
    f = elapsed >= 0.16 ? 8.5 : 0;
    if (elapsed >= 0.46 && elapsed < 0.92) {
      u = Math.floor((elapsed - 0.46) * 22) % 2 ? 10.0 : 0.35;
    } else if (elapsed >= 0.92) {
      u = 9.0;
    }
    n = elapsed >= 1.12 ? 9.5 : 0;
  }
  funLetterMaterials.FUN_F.emissiveIntensity = f;
  funLetterMaterials.FUN_U.emissiveIntensity = u;
  funLetterMaterials.FUN_N.emissiveIntensity = n;
}

const clock = new THREE.Clock();

// Frames pause while the tab is hidden or the main thread stalls; the pointer
// can be anywhere by the time they resume. Restart the motion derivatives from
// the current position so the jump does not kick the wrist/finger springs.
function resetPointerMotion() {
  pos.set(mouse.x, mouse.y, 0);
  vel.set(0, 0, 0);
  prevVel.set(0, 0, 0);
  accelSmooth.set(0, 0, 0);
}

// Every spring here integrates its own previous state, so a single non-finite
// value (a NaN coordinate, an Infinity from a zero-size viewport) would stick
// forever and leave the hand invisible while the puffs keep working. Check
// once per frame and reset to rest rather than trust the state stays clean.
function healMotionState() {
  const values = [
    mouse.x, mouse.y, pos.x, pos.y, vel.x, vel.y, prevVel.x, prevVel.y,
    accelSmooth.x, accelSmooth.y, rot.x, rot.y, rot.z, rot.vx, rot.vy, rot.vz,
    grabAmount, gripAmount, glovePresence, glovePresenceVel, gloveBaseScale,
  ];
  let healthy = values.every(Number.isFinite);
  for (const f of rigs) {
    if (!Number.isFinite(f.jig.a) || !Number.isFinite(f.jig.v)) healthy = false;
  }
  // The skinned mesh carries its own state: the fingertip pin offset and the
  // per-frame inverse bind matrix. Either going non-finite hides the hand
  // while every other value looks fine.
  const rigPoisoned = Boolean(mesh) && (
    !Number.isFinite(mesh.position.x) || !Number.isFinite(mesh.position.y) ||
    !Number.isFinite(mesh.position.z) ||
    !mesh.bindMatrixInverse.elements.every(Number.isFinite) ||
    !glove.scale.x || !Number.isFinite(glove.scale.x));
  if (healthy && !rigPoisoned) return;
  console.warn('[hand-cursor] non-finite motion state; resetting the rig');
  if (mesh) {
    mesh.position.set(0, 0, 0);
    if (gloveBaseScale) {
      glove.scale.setScalar(gloveBaseScale * Math.max(glovePresenceTarget, PRESENCE_FLOOR));
    } else {
      glove.scale.setScalar(1);
    }
    glove.updateMatrixWorld(true);
    pinPointerTip();
  }
  if (!Number.isFinite(mouse.x) || !Number.isFinite(mouse.y)) mouse.set(0, 0);
  resetPointerMotion();
  rot.x = rot.y = rot.z = rot.vx = rot.vy = rot.vz = 0;
  grabAmount = grabbing ? 1 : 0;
  gripAmount = gripTarget;
  glovePresence = glovePresenceTarget;
  glovePresenceVel = 0;
  for (const f of rigs) { f.jig.a = 0; f.jig.v = 0; }
  if (!Number.isFinite(gloveBaseScale)) { gloveBaseScale = 0; resize(); }
}
const DBG = location.hash;
if (!CARTRIDGE_INTRO_ENABLED || DBG.includes('skipboot')) {
  startStarterVideoPlayback();
  setCartridgeState(CARTRIDGE_STATE.RUNNING);
  cartridgeInsertionTime = CARTRIDGE_INTRO_ENABLED
    ? clock.elapsedTime
    : clock.elapsedTime - HARDWARE_EXIT_DURATION;
}
let idleFrameCleared = false;
function tick() {
  requestAnimationFrame(tick);
  if (window.innerWidth && renderer.domElement.width !== window.innerWidth) resize();
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 1 / 30);
  if (rawDt > 0.25) resetPointerMotion();
  healMotionState();
  const gameRunning = document.body.classList.contains('is-game-running');
  const mobileGame = gameRunning &&
    document.body.classList.contains('uses-mobile-controls');
  if (mobileGame) return;
  // Nothing to draw: no custom cursor (touch devices, WebGL lost), the intro
  // rigs hidden, no live poof. Clear the last glove frame once and skip the
  // two-pass full-screen render instead of burning it at 60fps.
  if (!glove.visible && !CARTRIDGE_INTRO_ENABLED && !puffs.some(puff => puff.mesh.visible)) {
    if (!idleFrameCleared) {
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      idleFrameCleared = true;
    }
    return;
  }
  idleFrameCleared = false;
  const t = clock.elapsedTime;

  if (!gameRunning && CARTRIDGE_INTRO_ENABLED) {
  if (cartridgeState === CARTRIDGE_STATE.BOOTING && cartridgeInsertionTime >= 0) {
    const introElapsed = t - cartridgeInsertionTime;
    if (introElapsed >= CREDIT_REVEAL_DELAY) {
      document.body.classList.add('is-intro-credit-visible');
    }
    if (introElapsed >= SITE_REVEAL_DELAY) {
      setCartridgeState(CARTRIDGE_STATE.RUNNING);
    }
  }

  // --- fitted console receiver + cartridge rigid-body interaction ---
  const cartridgeDocked = cartridgeState === CARTRIDGE_STATE.INSERTING ||
    cartridgeState === CARTRIDGE_STATE.BOOTING ||
    cartridgeState === CARTRIDGE_STATE.RUNNING;
  const cartridgeConstrained = cartridgeDocked ||
    cartridgeState === CARTRIDGE_STATE.EJECTING || cartridgeRouteActive;
  if (!cartridgeDragging && !cartridgeDocked) {
    consoleApproachTarget = 0;
    cartridgeEntryTarget = 0;
  }
  consoleApproachAmount += (consoleApproachTarget - consoleApproachAmount)
    * Math.min(1, dt * 6.5);
  const entryGoal = cartridgeDocked ? 1 : cartridgeEntryTarget;
  cartridgeEntryAmount += (entryGoal - cartridgeEntryAmount) * Math.min(1, dt * 8.5);

  updateHardwareTargets();
  mainHardwareTvRig.position.copy(mainHardwareTvTarget);
  mainHardwareTvVisual.position.set(
    Math.sin(t * 0.31 + 0.7) * 0.010,
    Math.sin(t * 0.46 + 1.2) * 0.018,
    0
  );
  consoleRig.position.copy(consoleTarget);
  consoleIdleEuler.set(
    Math.sin(t * 0.58) * 0.012,
    Math.sin(t * 0.43 + 0.8) * 0.018,
    Math.sin(t * 0.51 + 1.7) * 0.009
  );
  consoleIdleQuaternion.setFromEuler(consoleIdleEuler);
  consoleBaseQuaternion.slerpQuaternions(
    consoleRestQuaternion, consoleInviteQuaternion, consoleApproachAmount
  );
  consoleVisual.quaternion.copy(consoleBaseQuaternion).multiply(consoleIdleQuaternion);
  consoleVisual.position.set(
    Math.sin(t * 0.37 + 0.4) * 0.014,
    Math.sin(t * 0.62) * 0.026 + consoleApproachAmount * 0.10,
    Math.sin(t * 0.48 + 1.1) * 0.012
  );
  consoleRig.updateMatrixWorld(true);
  if (consoleSnapAnchor) {
    consoleSnapAnchor.getWorldPosition(cartridgeSocketWorld);
    consoleVisual.getWorldQuaternion(cartridgeSocketQuaternion);
  } else {
    cartridgeSocketWorld.copy(consoleTarget).add(new THREE.Vector3(0, 0.45, 0.12));
    cartridgeSocketQuaternion.identity();
  }
  if (cartridgeDragging && !cartridgeEjectDrag && !cartridgeRouteActive) {
    // Follow the animated receiver depth every frame so console tilt/idle
    // motion cannot leave the drag target on a stale plane.
    alignCartridgeDragDepth(cartridgeEntryTarget);
  }

  cartridgeSnapAmount += (
    (cartridgeConstrained ? 1 : 0) - cartridgeSnapAmount
  ) * Math.min(1, dt * 7.5);
  const cartridgeSpringTarget = cartridgeDocked
    ? cartridgeSocketWorld
    : (cartridgeState === CARTRIDGE_STATE.EJECTING
      ? cartridgeEjectHoldWorld
      : (cartridgeDragging ? cartridgeDragTarget : cartridgeTarget));
  if (!cartridgePhysicsReady) {
    cartridgePhysicsPosition.copy(cartridgeSpringTarget);
    cartridgeRig.position.copy(cartridgePhysicsPosition);
    cartridgePhysicsReady = true;
  }
  if (cartridgeRouteActive) {
    cartridgeRouteProgress = Math.min(
      1, cartridgeRouteProgress + dt / cartridgeRouteDuration
    );
    sampleCartridgeRoute(cartridgeRouteProgress, cartridgeRouteTarget);
    cartridgePhysicsPosition.copy(cartridgeRouteTarget);
    cartridgeVelocity.set(0, 0, 0);
    if (cartridgeRouteKind === 'insert' && !cartridgeLockFeedbackPlayed &&
        cartridgeRouteProgress >= CARTRIDGE_LOCK_ROUTE_PROGRESS) {
      cartridgeLockFeedbackPlayed = true;
      triggerCartridgeLockShake();
      playCartridgeSound('lock');
    }
    if (cartridgeRouteProgress >= 1) {
      const completedRoute = cartridgeRouteKind;
      cartridgeRouteActive = false;
      cartridgeRouteKind = 'none';
      if (completedRoute === 'insert') {
        hardwareInset.dataset.cartridgeRoute = 'seated';
        if (cartridgeState === CARTRIDGE_STATE.BOOTING) {
          cartridgeInsertionTime = t;
          startStarterVideoPlayback();
        }
      } else if (completedRoute === 'eject-pop') {
        hardwareInset.dataset.cartridgeRoute = 'popped';
        if (cartridgeDragging) {
          cartridgeEjectDrag = false;
          cartridgeEntryTarget = 0;
          cartridgeDragOffset.set(0, 0, 0);
          screenToCartridgeWorld(
            cartridgePointerClientX, cartridgePointerClientY, cartridgePointerWorld
          );
          cartridgePreviousPointerWorld.copy(cartridgePointerWorld);
          cartridgeDragTarget.copy(cartridgePointerWorld);
          setCartridgeState(CARTRIDGE_STATE.DRAGGING);
          hardwareInset.dataset.collision = 'clear';
        }
      }
    }
  } else {
    const cartridgeSpeed = cartridgeVelocity.length();
    const cartridgeK = cartridgeDocked ? 138 : (cartridgeDragging ? 105 : 54);
    const cartridgeLinearDrag = cartridgeDocked ? 19 : (cartridgeDragging ? 15 : 6.5);
    const cartridgeAirDrag = cartridgeLinearDrag + cartridgeSpeed * 0.30;
    cartridgeVelocity.x += (
      (cartridgeSpringTarget.x - cartridgePhysicsPosition.x) * cartridgeK
      - cartridgeVelocity.x * cartridgeAirDrag
    ) * dt;
    cartridgeVelocity.y += (
      (cartridgeSpringTarget.y - cartridgePhysicsPosition.y) * cartridgeK
      - cartridgeVelocity.y * cartridgeAirDrag
    ) * dt;
    cartridgeVelocity.z += (
      (cartridgeSpringTarget.z - cartridgePhysicsPosition.z) * cartridgeK
      - cartridgeVelocity.z * cartridgeAirDrag
    ) * dt;
    cartridgePhysicsPosition.addScaledVector(cartridgeVelocity, dt);
  }
  if (!cartridgeRouteActive && cartridgeState === CARTRIDGE_STATE.DRAGGING) {
    const receiver = consoleControl.getBoundingClientRect();
    if (!tryBeginPhysicalCartridgeInsertion(receiver)) {
      resolveCartridgeConsoleCollision(receiver);
    }
  }
  cartridgeRig.position.copy(cartridgePhysicsPosition);
  updateFunLights(t);

  const cartridgeHovering = !cartridgeConstrained && (cartridgeHovered || cartridgeDragging);
  cartridgeHoverAmount += ((cartridgeHovering ? 1 : 0) - cartridgeHoverAmount) * Math.min(1, dt * 9);
  cartridgePressAmount += ((cartridgePressed ? 1 : 0) - cartridgePressAmount) * Math.min(1, dt * 14);

  // On release, a near-critically-damped spring drives the unwrapped clockwise
  // target immediately and settles with the authored front face visible.
  if (cartridgeFaceTurnActive) {
    const faceTurnError = cartridgeFaceTurnTarget - cartridgeYaw;
    cartridgeYawVelocity += (
      faceTurnError * CARTRIDGE_FACE_TURN_SPRING
      - cartridgeYawVelocity * CARTRIDGE_FACE_TURN_DAMPING
    ) * dt;
    cartridgeYaw += cartridgeYawVelocity * dt;
    if (Math.abs(faceTurnError) < 0.002 && Math.abs(cartridgeYawVelocity) < 0.025) {
      cartridgeYaw = cartridgeFaceTurnTarget;
      cartridgeYawVelocity = 0;
      cartridgeFaceTurnActive = false;
    }
  } else {
    if (cartridgeConstrained) {
      cartridgeYawVelocity *= Math.max(0, 1 - dt * 12);
    } else if (cartridgeHovering) {
      const yawError = Math.atan2(
        Math.sin(CARTRIDGE_FRONT_YAW - cartridgeYaw),
        Math.cos(CARTRIDGE_FRONT_YAW - cartridgeYaw)
      );
      cartridgeYawVelocity += (yawError * 46 - cartridgeYawVelocity * 9.2) * dt;
    } else {
      cartridgeYawVelocity += (
        CARTRIDGE_IDLE_SPIN_SPEED - cartridgeYawVelocity
      ) * Math.min(1, dt * 2.8);
    }
    cartridgeYaw += cartridgeYawVelocity * dt;
  }
  if (Math.abs(cartridgeYaw) > Math.PI * 200) {
    cartridgeYaw = CARTRIDGE_FRONT_YAW + Math.atan2(
      Math.sin(cartridgeYaw - CARTRIDGE_FRONT_YAW),
      Math.cos(cartridgeYaw - CARTRIDGE_FRONT_YAW)
    );
  }

  // Velocity leans the shell into the movement, with its own soft springs.
  const tiltTargetX = THREE.MathUtils.clamp(cartridgeVelocity.y * 0.085, -0.2, 0.2);
  const tiltTargetZ = THREE.MathUtils.clamp(-cartridgeVelocity.x * 0.11, -0.34, 0.34);
  cartridgeTilt.vx += ((tiltTargetX - cartridgeTilt.x) * 62 - cartridgeTilt.vx * 8.2) * dt;
  cartridgeTilt.vz += ((tiltTargetZ - cartridgeTilt.z) * 62 - cartridgeTilt.vz * 8.2) * dt;
  cartridgeTilt.x += cartridgeTilt.vx * dt;
  cartridgeTilt.z += cartridgeTilt.vz * dt;

  const snapEase = cartridgeSnapAmount * cartridgeSnapAmount * (3 - 2 * cartridgeSnapAmount);
  const entryEase = cartridgeEntryAmount * cartridgeEntryAmount * (3 - 2 * cartridgeEntryAmount);
  const orientationEase = Math.max(snapEase, entryEase);
  const freeMotion = 1 - snapEase;
  cartridgeVisual.position.set(
    0,
    (Math.sin(t * 1.7) * 0.055 + cartridgeHoverAmount * 0.09
      - cartridgePressAmount * 0.045) * freeMotion,
    (cartridgeHoverAmount * 0.12 - cartridgePressAmount * 0.08) * freeMotion
  );
  cartridgeVisual.rotation.set(
    -0.20 + cartridgeTilt.x - cartridgePressAmount * 0.12
      + Math.sin(t * 1.1) * 0.025,
    cartridgeYaw,
    0.08 + cartridgeTilt.z + Math.sin(t * 1.35) * 0.025
  );
  cartridgeFreeQuaternion.copy(cartridgeVisual.quaternion);
  cartridgeVisual.quaternion.slerpQuaternions(
    cartridgeFreeQuaternion, cartridgeSocketQuaternion, orientationEase
  );
  updateCartridgeWisps(t, dt);
  updateGodRay(t, dt);

  // Once the cartridge is fully seated, carry it and the console offscreen as
  // one unit. Their base positions are rebuilt every frame, so this visual
  // offset cannot feed back into the insertion physics.
  if ((cartridgeState === CARTRIDGE_STATE.BOOTING ||
       cartridgeState === CARTRIDGE_STATE.RUNNING) && cartridgeInsertionTime >= 0) {
    const exitProgress = prefersReducedMotion
      ? 1
      : THREE.MathUtils.clamp(
        (t - cartridgeInsertionTime) / HARDWARE_EXIT_DURATION, 0, 1
      );
    const exitEase = exitProgress * exitProgress * (3 - 2 * exitProgress);
    const hardwareExitOffset = exitEase * VIEW_H;
    mainHardwareTvRig.position.y -= hardwareExitOffset;
    consoleRig.position.y -= hardwareExitOffset;
    cartridgeRig.position.y -= hardwareExitOffset;
  }
  }

  // Keep the fingertip locked to the latest pointer coordinates. Velocity is
  // measured from the direct motion so the secondary wrist/finger animation
  // stays lively without adding positional lag.
  const pointerVelocityScale = 1 / Math.max(dt, 1e-4);
  vel.set(
    (mouse.x - pos.x) * pointerVelocityScale,
    (mouse.y - pos.y) * pointerVelocityScale,
    0
  );
  pos.set(mouse.x, mouse.y, 0);
  glove.position.set(mouse.x, mouse.y, GLOVE_DEPTH);

  accelSmooth.x += ((vel.x - prevVel.x) / Math.max(dt, 1e-4) - accelSmooth.x) * Math.min(1, dt * 12);
  accelSmooth.y += ((vel.y - prevVel.y) / Math.max(dt, 1e-4) - accelSmooth.y) * Math.min(1, dt * 12);
  prevVel.copy(vel);

  // --- wrist rotation springs: lean into motion, waggle on stops ---
  const tz = THREE.MathUtils.clamp(-vel.x * 0.045, -0.7, 0.7);
  const tx = THREE.MathUtils.clamp(-vel.y * 0.035, -0.55, 0.55);
  const ty = THREE.MathUtils.clamp(vel.x * 0.02, -0.4, 0.4);
  const RK = 90, RD = 7.5;
  rot.vz += ((tz - rot.z) * RK - rot.vz * RD) * dt;
  rot.vx += ((tx - rot.x) * RK - rot.vx * RD) * dt;
  rot.vy += ((ty - rot.y) * RK - rot.vy * RD) * dt;
  rot.z += rot.vz * dt; rot.x += rot.vx * dt; rot.y += rot.vy * dt;

  const idle = Math.sin(t * 1.6) * 0.03;
  wrist.rotation.set(rot.x + idle, rot.y, rot.z + Math.sin(t * 1.3) * 0.02);
  wrist.position.set(0, 0, 0);

  // --- down/press blend: tilt + squash, fingertip planted ---
  grabAmount += ((grabbing ? 1 : 0) - grabAmount) * Math.min(1, dt * 12);
  gripAmount += (gripTarget - gripAmount) * Math.min(1, dt * 10);
  const ease = grabAmount * grabAmount * (3 - 2 * grabAmount);
  const gEase = gripAmount * gripAmount * (3 - 2 * gripAmount);
  hand.quaternion.slerpQuaternions(qPoint, qTap, ease);
  if (gEase > 0.001) hand.quaternion.slerp(qGrip, gEase);
  hand.scale.setScalar(0.62 * THREE.MathUtils.lerp(POINT.scale, GRIP.scale, gEase)
                            * (1 - 0.08 * ease));

  // --- finger jiggle springs kicked by acceleration ---
  const accelMag = THREE.MathUtils.clamp((Math.abs(accelSmooth.x) + Math.abs(accelSmooth.y)) * 0.0012, 0, 0.5);
  for (const f of rigs) {
    const jig = f.jig;
    const kick = accelMag * Math.sin(t * 22 + jig.phase);
    jig.v += ((0 - jig.a) * 160 - jig.v * 9) * dt + kick;
    jig.a += jig.v * dt;
  }
  poseFingers(ease, gEase);
  pinPointerTip();
  updatePoof(dt);

  if (DBG.includes('raw') || !shaderSettings.enabled) {
    renderer.setRenderTarget(null);
    applyCartridgeLockShake(t);
    renderer.render(scene, camera);
    resetCameraAfterShake();
  } else {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    applyCartridgeLockShake(t);
    renderer.render(scene, camera);
    resetCameraAfterShake();
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  crtScreenMaterial.uniforms.time.value = t;
}
tick();
