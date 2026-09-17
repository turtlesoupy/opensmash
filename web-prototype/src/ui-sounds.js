import { installAudioUnlock } from "../shared/audio-unlock.js";
import { useEffect, useRef } from "react";

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "label",
  "summary",
  "select",
  "input",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='gridcell']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[data-ui-sound='click']",
].join(",");

const EDITABLE_INPUT_TYPES = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

const SILENT_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "FnLock",
  "Meta",
  "NumLock",
  "ScrollLock",
  "Shift",
]);

function isDisabled(element) {
  if (!element) return true;
  if (element.matches?.(":disabled, [aria-disabled='true']")) return true;
  if (element.matches?.("label") && element.control?.disabled) return true;
  return false;
}

function findInteractiveElement(target) {
  if (!(target instanceof Element)) return null;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return isDisabled(interactive) ? null : interactive;
}

function isEditableElement(target) {
  if (!(target instanceof Element)) return false;
  const editable = target.closest("input, textarea, [contenteditable]");
  if (!editable || isDisabled(editable) || editable.readOnly) return false;
  if (editable.matches("[contenteditable]")) {
    return editable.getAttribute("contenteditable") !== "false";
  }
  if (editable.matches("textarea")) return true;
  return EDITABLE_INPUT_TYPES.has(editable.type);
}

function connectEnvelope(context, destination, peak, start, end) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(destination);
  return gain;
}

function makeNoiseBuffer(context) {
  const frameCount = Math.ceil(context.sampleRate * 0.065);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0x51f15e;

  for (let index = 0; index < samples.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[index] = (seed / 0x80000000) - 1;
  }
  return buffer;
}

class UiSoundEngine {
  constructor() {
    this.context = null;
    this.noiseBuffer = null;
    this.variation = 0;
  }

  getContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.noiseBuffer = makeNoiseBuffer(this.context);
    }
    if (["suspended", "interrupted"].includes(this.context.state)) this.context.resume().catch(() => {});
    return this.context;
  }

  nextPitch() {
    const pitchSteps = [0.97, 1.015, 0.99, 1.035, 1];
    const pitch = pitchSteps[this.variation % pitchSteps.length];
    this.variation += 1;
    return pitch;
  }

  noiseStrike(context, destination, {
    end,
    filterFrequency,
    gain,
    pitch,
    start,
  }) {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    source.playbackRate.setValueAtTime(pitch, start);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(filterFrequency * pitch, start);
    filter.Q.setValueAtTime(0.75, start);
    source.connect(filter);
    filter.connect(connectEnvelope(context, destination, gain, start, end));
    source.start(start);
    source.stop(end + 0.002);
  }

  toneStrike(context, destination, {
    end,
    from,
    gain,
    start,
    to,
    type = "triangle",
  }) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, end);
    oscillator.connect(connectEnvelope(context, destination, gain, start, end));
    oscillator.start(start);
    oscillator.stop(end + 0.002);
  }

  playClick() {
    const context = this.getContext();
    if (!context) return;
    const now = context.currentTime;
    const pitch = this.nextPitch();
    const master = context.createGain();
    master.gain.setValueAtTime(0.42, now);
    master.connect(context.destination);

    this.noiseStrike(context, master, {
      start: now,
      end: now + 0.026,
      gain: 0.11,
      filterFrequency: 2600,
      pitch,
    });
    this.toneStrike(context, master, {
      start: now,
      end: now + 0.024,
      from: 1180 * pitch,
      to: 520 * pitch,
      gain: 0.055,
    });
    this.toneStrike(context, master, {
      start: now + 0.003,
      end: now + 0.011,
      from: 3300 * pitch,
      to: 1850 * pitch,
      gain: 0.022,
      type: "square",
    });
    window.setTimeout(() => master.disconnect(), 80);
  }

  playKey() {
    const context = this.getContext();
    if (!context) return;
    const now = context.currentTime;
    const pitch = this.nextPitch();
    const master = context.createGain();
    master.gain.setValueAtTime(0.34, now);
    master.connect(context.destination);

    this.noiseStrike(context, master, {
      start: now,
      end: now + 0.016,
      gain: 0.075,
      filterFrequency: 3900,
      pitch,
    });
    this.toneStrike(context, master, {
      start: now,
      end: now + 0.015,
      from: 760 * pitch,
      to: 440 * pitch,
      gain: 0.034,
      type: "square",
    });
    this.noiseStrike(context, master, {
      start: now + 0.013,
      end: now + 0.026,
      gain: 0.025,
      filterFrequency: 3000,
      pitch: pitch * 0.93,
    });
    window.setTimeout(() => master.disconnect(), 60);
  }

  destroy() {
    this.context?.close().catch(() => {});
    this.context = null;
    this.noiseBuffer = null;
  }
}

function installUiSounds(isEnabled) {
  const engine = new UiSoundEngine();
  const soundAllowed = (target) => (
    isEnabled() || target?.closest?.("[data-ui-sound-toggle]")
  );

  const clickFromPointer = (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const target = findInteractiveElement(event.target);
    if (target && soundAllowed(target)) engine.playClick();
  };

  const clickFromKeyboard = (event) => {
    if (!event.isTrusted || event.detail !== 0) return;
    const target = findInteractiveElement(event.target);
    if (target && soundAllowed(target)) engine.playClick();
  };

  const keyFromEditable = (event) => {
    if (
      event.isComposing
      || event.ctrlKey
      || event.metaKey
      || event.altKey
      || event.key === "Process"
      || SILENT_KEYS.has(event.key)
      || !isEditableElement(event.target)
      || !soundAllowed(event.target)
    ) return;
    engine.playKey();
  };

  const removeAudioUnlock = installAudioUnlock(window, () => isEnabled() ? [engine.context] : []);

  document.addEventListener("pointerdown", clickFromPointer, true);
  document.addEventListener("click", clickFromKeyboard, true);
  document.addEventListener("keydown", keyFromEditable, true);

  return () => {
    document.removeEventListener("pointerdown", clickFromPointer, true);
    document.removeEventListener("click", clickFromKeyboard, true);
    document.removeEventListener("keydown", keyFromEditable, true);
    removeAudioUnlock();
    engine.destroy();
  };
}

export function useUiSounds(enabled) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => installUiSounds(() => enabledRef.current), []);
}
