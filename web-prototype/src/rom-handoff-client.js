import {channelInbox, sendGameFile, receiveGameFile} from '../shared/handoff-transfer.js';
// rom-handoff-client.js — browser side of the ROM handoff.
//
// Host (the device that already validated a ROM): opens a signalling room,
// shows the code/QR, and once a guest connects streams the stored ROM over a
// WebRTC data channel. Guest (usually a phone): joins the room, answers, and
// reassembles the bytes into a File that goes through the ordinary upload
// validation path — so the guest ends up with the same IndexedDB entry and
// session cookie a manual upload would produce.
//
// Signalling is HTTP polling against /api/handoff/rooms (server/handoff-rooms.js);
// the ROM itself never touches the server. ICE servers come from
// /api/handoff/ice: STUN always, plus a TURN relay when the deploy configures
// one (server/handoff-ice.js). A relay only forwards DTLS ciphertext, so the
// ROM stays unreadable to every server involved.

import {
  handoffUrl,
  isHandoffCode,
  normalizeHandoffCode,
} from "../shared/rom-handoff.js";

const FALLBACK_ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

/**
 * ICE servers from the API: STUN plus a TURN relay when the deploy has one
 * configured (server/handoff-ice.js). Falls back to public STUN so a failed
 * fetch never blocks a same-network handoff.
 */
async function fetchIceConfig() {
  try {
    const config = await api("/api/handoff/ice");
    if (Array.isArray(config?.iceServers) && config.iceServers.length) return { iceServers: config.iceServers, relay: Boolean(config.relay) };
  } catch (error) {
    console.warn("[handoff] ICE config unavailable, using STUN only:", error);
  }
  return { iceServers: FALLBACK_ICE_SERVERS, relay: false };
}

const BLOCKED_BROWSER_MESSAGE =
  "This browser is blocking direct connections: it produced no network candidates at all. " +
  "A privacy or ad-blocking extension, or a WebRTC policy, is usually the cause. " +
  "Try an incognito or private window (extensions off) or a different browser on this device.";

function connectionFailedMessage(relay) {
  return relay
    ? "The connection between the devices failed. Check that both are online and try again."
    : "The connection between the devices failed. Put both on the same Wi-Fi and try again.";
}

/** Log what each side gathered and how the connection progresses — the first thing to check when a pair cannot connect. */
function logCandidateTypes(pc, label) {
  const types = new Set();
  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate?.type) types.add(event.candidate.type);
    else if (!event.candidate) console.info(`[handoff] ${label} gathered candidate types:`, [...types].join(", ") || "none");
  });
  pc.addEventListener("connectionstatechange", () => console.info(`[handoff] ${label} connection state:`, pc.connectionState));
  pc.addEventListener("iceconnectionstatechange", () => console.info(`[handoff] ${label} ICE state:`, pc.iceConnectionState));
}
const POLL_INTERVAL_MS = 500;
// A host can sit on the QR page for minutes. Poll fast while a pairing is
// plausible, then back off so an idle handoff is not 1,200 room reads.
const POLL_FAST_WINDOW_MS = 30 * 1000;
const POLL_IDLE_INTERVAL_MS = 2000;
const WAIT_FOR_PEER_MS = 10 * 60 * 1000;
// From the moment both descriptions are in place until the channel opens.
const CONNECT_TIMEOUT_MS = 60 * 1000;
// Local ICE candidates are batched so a host with many interfaces and six TURN
// URLs posts a handful of messages instead of dozens of contended writes.
const CANDIDATE_BATCH_MS = 150;
const BUFFER_LOW_WATER = 256 * 1024;

class HandoffCancelled extends Error {
  constructor() {
    super("Handoff cancelled.");
    this.name = "HandoffCancelled";
  }
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `Handoff request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

/**
 * Tell the other side why this side is leaving, then tear the room down. The
 * short delay lets the peer's next poll read the reason instead of a 404.
 */
async function farewell(room, role, key, error) {
  if (!room || !key) return;
  const reason = error instanceof HandoffCancelled ? "cancelled" : (error?.message || "unknown error");
  try {
    await api(`/api/handoff/rooms/${room}/messages`, { method: "POST", body: { role, key, message: { type: "bye", reason } } });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } catch { /* the room may already be gone */ }
  api(`/api/handoff/rooms/${room}/close`, { method: "POST", body: { role, key } }).catch(() => {});
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new HandoffCancelled());
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(new HandoffCancelled()); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Drive one side of the signalling exchange: relay local ICE candidates to the
 * room, and feed remote descriptions/candidates into the connection until the
 * data channel opens. Returns when `until()` becomes true or throws on abort,
 * timeout, or a failed ICE state.
 */
/**
 * Capture and relay this side's ICE candidates. MUST be attached before any
 * description is set: gathering starts at setLocalDescription and the first
 * host candidates fire within milliseconds, long before a signalling round
 * trip to the server completes. (The original code attached this after
 * uploading the offer, so against Firestore latency the host posted no
 * candidates at all and the peer could never connect.)
 */
function attachCandidateRelay({ pc, room, role, key }) {
  const diag = { localTypes: new Set(), remoteTypes: new Set(), remoteCount: 0, postFailures: 0, gatheredNothing: false };
  let outbox = [];
  let flushTimer = 0;
  const flush = () => {
    flushTimer = 0;
    if (!outbox.length) return;
    const batch = outbox;
    outbox = [];
    api(`/api/handoff/rooms/${room}/messages`, {
      method: "POST",
      body: { role, key, messages: batch.map((candidate) => ({ type: "candidate", candidate })) },
    }).catch((error) => {
      diag.postFailures += batch.length;
      console.warn("[handoff] candidate relay failed:", error);
    });
  };
  pc.addEventListener("icecandidate", (event) => {
    if (!event.candidate) { flush(); return; }
    if (event.candidate.type) diag.localTypes.add(event.candidate.type);
    outbox.push(event.candidate.toJSON());
    if (!flushTimer) flushTimer = setTimeout(flush, CANDIDATE_BATCH_MS);
  });
  // A browser that finishes gathering with nothing to offer can never connect.
  // This is a privacy extension or a WebRTC IP-handling policy, not the
  // network — say so instead of blaming Wi-Fi after a long timeout.
  pc.addEventListener("icegatheringstatechange", () => {
    if (pc.iceGatheringState === "complete" && diag.localTypes.size === 0) diag.gatheredNothing = true;
  });
  return { diag, flush };
}

/**
 * Drive one side of the signalling exchange: feed remote descriptions and
 * candidates into the connection until the data channel opens. Returns when
 * `until()` becomes true or throws on abort, timeout, or a failed ICE state.
 * `relayer` comes from attachCandidateRelay (attached earlier).
 */
async function runSignalling({ pc, room, role, key, onRemote, until, signal, deadlineMs, relay = false, relayer }) {
  let cursor = 0;
  const pendingCandidates = [];
  let remoteDescriptionSet = false;
  let connectStartedAt = 0;
  const { diag, flush } = relayer;

  const addRemote = async (candidate) => {
    diag.remoteCount += 1;
    const type = /typ (\w+)/.exec(candidate?.candidate || "")?.[1];
    if (type) diag.remoteTypes.add(type);
    await pc.addIceCandidate(candidate).catch((error) => console.warn("[handoff] addIceCandidate failed:", error));
  };

  const started = Date.now();
  while (!until()) {
    if (signal?.aborted) throw new HandoffCancelled();
    if (Date.now() - started > deadlineMs) {
      throw new Error(`The other device never connected. ${describeDiagnostics(pc, diag)}`);
    }
    if (diag.gatheredNothing) {
      throw new Error(BLOCKED_BROWSER_MESSAGE + " " + describeDiagnostics(pc, diag));
    }
    if (connectStartedAt && Date.now() - connectStartedAt > CONNECT_TIMEOUT_MS) {
      throw new Error(`${connectionFailedMessage(relay)} ${describeDiagnostics(pc, diag)}`);
    }
    if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
      throw new Error(`${connectionFailedMessage(relay)} ${describeDiagnostics(pc, diag)}`);
    }
    let view;
    try {
      view = await api(`/api/handoff/rooms/${room}/messages?role=${role}&key=${encodeURIComponent(key)}&after=${cursor}`);
    } catch (error) {
      if (error.status === 404) throw new Error(`The other device ended the handoff before the connection came up. ${describeDiagnostics(pc, diag)}`);
      throw error;
    }
    cursor = view.cursor;
    for (const message of view.messages) {
      if (message.type === "bye") {
        throw new Error(message.reason === "cancelled"
          ? "The other device cancelled the handoff."
          : `The other device gave up: ${message.reason}`);
      }
      if (message.type === "candidate") {
        if (remoteDescriptionSet) await addRemote(message.candidate);
        else pendingCandidates.push(message.candidate);
      } else {
        await onRemote(message);
        if (pc.remoteDescription) {
          remoteDescriptionSet = true;
          connectStartedAt = Date.now();
          for (const candidate of pendingCandidates.splice(0)) await addRemote(candidate);
        }
      }
    }
    if (!until()) {
      const fast = remoteDescriptionSet || Date.now() - started < POLL_FAST_WINDOW_MS;
      await sleep(fast ? POLL_INTERVAL_MS : POLL_IDLE_INTERVAL_MS, signal);
    }
  }
  flush();
}

/** One line a player can read back to us: what each side saw. */
function describeDiagnostics(pc, diag) {
  const local = [...diag.localTypes].join("/") || "none";
  const remote = [...diag.remoteTypes].join("/") || "none";
  const dropped = diag.postFailures ? `, ${diag.postFailures} not delivered` : "";
  return `(ice ${pc.iceConnectionState}; local ${local}; remote ${diag.remoteCount} ${remote}${dropped})`;
}

function waitForChannelOpen(channel, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (channel.readyState === "open") return resolve();
    const timer = setTimeout(() => reject(new Error("The devices found each other but the data channel never opened.")), timeoutMs);
    const done = (fn) => (event) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); fn(event); };
    const onAbort = done(() => reject(new HandoffCancelled()));
    channel.addEventListener("open", done(resolve), { once: true });
    channel.addEventListener("error", done((event) => reject(event?.error || new Error("Data channel error."))), { once: true });
    channel.addEventListener("close", done(() => reject(new Error("The data channel closed before the transfer started."))), { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Host side. `loadRom(game)` resolves to { name, bytes } or { name, file }.
 * The receiver requests its selected game before any file bytes are sent. `onState(state, detail)` receives:
 *   creating → waiting {code,url} → connecting → sending {sent,total} → done
 * Returns { code, url, promise, cancel }.
 */
export function startRomHandoffHost({ loadRom, game = 'ssb64', onState = () => {} }) {
  const controller = new AbortController();
  const { signal } = controller;
  let pc = null;
  let roomCode = null;
  let hostKey = null;

  const promise = (async () => {
    onState("creating");
    const created = await api("/api/handoff/rooms", { method: "POST", body: {} });
    roomCode = created.code;
    hostKey = created.hostKey;
    const url = handoffUrl(location.origin, roomCode, game);
    onState("waiting", { code: roomCode, url, expiresAt: created.expiresAt });

    const ice = await fetchIceConfig();
    pc = new RTCPeerConnection({ iceServers: ice.iceServers });
    logCandidateTypes(pc, "host");
    const relayer = attachCandidateRelay({ pc, room: roomCode, role: "host", key: hostKey });
    const channel = pc.createDataChannel("rom", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    const inbox = channelInbox(channel, signal);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await api(`/api/handoff/rooms/${roomCode}/messages`, {
      method: "POST",
      body: { role: "host", key: hostKey, message: { type: "offer", sdp: pc.localDescription.sdp } },
    });

    let announcedPeer = false;
    await runSignalling({
      pc,
      room: roomCode,
      role: "host",
      key: hostKey,
      signal,
      relay: ice.relay,
      relayer,
      deadlineMs: WAIT_FOR_PEER_MS,
      onRemote: async (message) => {
        if (message.type === "answer") {
          if (!announcedPeer) { announcedPeer = true; onState("connecting"); }
          await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
        }
      },
      until: () => channel.readyState === "open",
    });
    await waitForChannelOpen(channel, signal, CONNECT_TIMEOUT_MS);
    api(`/api/handoff/rooms/${roomCode}/close`, { method: "POST", body: { role: "host", key: hostKey } }).catch(() => {});

    try { await sendGameFile(channel, inbox, loadRom, onState); }
    catch (error) { try {channel.send(JSON.stringify({type:'error',message:error.message}));} catch {} throw error; }
    finally { inbox.dispose(); }
    channel.close();
    pc.close();
  })().catch((error) => {
    farewell(roomCode, "host", hostKey, error);
    pc?.close();
    if (error?.name === "HandoffCancelled") { onState("cancelled"); return; }
    onState("error", { error });
    throw error;
  });

  return {
    promise,
    cancel() { controller.abort(); },
  };
}

/**
 * Guest side. Resolves to a File holding the received ROM image, ready for
 * the same validation the upload button runs. `onState(state, detail)`:
 *   joining → waiting → connecting → receiving {received,total} → done
 */
export function receiveRomHandoff({ code, game = 'ssb64', onState = () => {}, signal } = {}) {
  const roomCode = normalizeHandoffCode(code);
  const controller = new AbortController();
  const abortSignal = controller.signal;
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  if (signal?.aborted) controller.abort();
  let pc = null;
  let guestKey = null;
  let cleanup = async () => {};

  const promise = (async () => {
    if (!isHandoffCode(roomCode)) throw new Error("Enter the 6-character code shown on the other device.");
    onState("joining");
    const joined = await api(`/api/handoff/rooms/${roomCode}/join`, { method: "POST", body: {} });
    guestKey = joined.guestKey;
    onState("waiting");

    const ice = await fetchIceConfig();
    pc = new RTCPeerConnection({ iceServers: ice.iceServers });
    logCandidateTypes(pc, "guest");
    const relayer = attachCandidateRelay({ pc, room: roomCode, role: "guest", key: guestKey });
    let channel = null;
    let inbox;
    const channelReady = new Promise((resolve) => {
      pc.addEventListener("datachannel", (event) => {
        channel = event.channel;
        channel.binaryType = "arraybuffer";
        inbox = channelInbox(channel, abortSignal);
        resolve(channel);
      });
    });

    await runSignalling({
      pc,
      room: roomCode,
      role: "guest",
      key: guestKey,
      signal: abortSignal,
      relay: ice.relay,
      relayer,
      deadlineMs: CONNECT_TIMEOUT_MS,
      onRemote: async (message) => {
        if (message.type !== "offer") return;
        onState("connecting");
        await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await api(`/api/handoff/rooms/${roomCode}/messages`, {
          method: "POST",
          body: { role: "guest", key: guestKey, message: { type: "answer", sdp: pc.localDescription.sdp } },
        });
      },
      until: () => channel?.readyState === "open",
    });
    await channelReady;
    await waitForChannelOpen(channel, abortSignal, CONNECT_TIMEOUT_MS);
    api(`/api/handoff/rooms/${roomCode}/close`, { method: "POST", body: { role: "guest", key: guestKey } }).catch(() => {});

    let file;
    try { file = await receiveGameFile(channel, inbox, game, onState, value => { cleanup = value; }); }
    catch (error) { try {channel.send(JSON.stringify({type:'error',message:error.message}));} catch {} await cleanup(); throw error; }
    finally { inbox.dispose(); }

    setTimeout(() => { try { channel.close(); pc.close(); } catch { /* already closed */ } }, 500);
    return file;
  })().catch((error) => {
    farewell(roomCode, "guest", guestKey, error);
    pc?.close();
    if (error?.name === "HandoffCancelled") { onState("cancelled"); }
    else onState("error", { error });
    throw error;
  });

  return { promise, dispose: () => cleanup(), cancel() { controller.abort(); } };
}

/**
 * Keep the screen on while a handoff is pending. Both ends need a live tab:
 * a locked phone or a closed laptop lid suspends the page and drops the data
 * channel. Best effort (Chromium, Safari 16.4+); returns a release function.
 */
export function holdScreenAwake() {
  let sentinel = null;
  let released = false;
  const acquire = async () => {
    try {
      if (released || document.visibilityState !== "visible" || !navigator.wakeLock?.request) return;
      const lock = await navigator.wakeLock.request("screen");
      // Released while the request was in flight: let it go now, or it stays held.
      if (released) { lock.release().catch(() => {}); return; }
      sentinel = lock;
    } catch {
      sentinel = null;
    }
  };
  const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
  document.addEventListener("visibilitychange", onVisible);
  acquire();
  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisible);
    sentinel?.release().catch(() => {});
    sentinel = null;
  };
}

export function isHandoffSupported() {
  return typeof RTCPeerConnection === "function";
}
