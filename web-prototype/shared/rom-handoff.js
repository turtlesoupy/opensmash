// rom-handoff.js — protocol pieces for moving a validated ROM from one of the
// player's browsers to another (typically laptop → phone) over a WebRTC data
// channel. Everything here is pure so it can be unit-tested in Node; the
// browser glue (RTCPeerConnection, fetch signalling) lives in
// src/rom-handoff-client.js and the signalling rooms in server/handoff-rooms.js.
//
// Privacy contract: the server only ever relays SDP offers/answers and ICE
// candidates. ROM bytes travel peer-to-peer and never touch the signalling
// endpoint. Messages are size-capped server-side so a room cannot be abused
// as a relay for anything else.

// No 0/O, 1/I/L, or vowels that read as words: typed codes must survive a
// phone keyboard and a glance across the room.
export const HANDOFF_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const HANDOFF_CODE_LENGTH = 6;
export const HANDOFF_QUERY_PARAM = "handoff";
export const HANDOFF_CHUNK_SIZE = 16 * 1024;
export const HANDOFF_MAX_MESSAGE_BYTES = 16 * 1024;

const CODE_CONFUSABLES = Object.freeze({ "0": "O", "1": "I", "L": "I" });

function defaultRandom(length) {
  const bytes = new Uint8Array(length);
  const cryptoImpl = globalThis.crypto;
  if (cryptoImpl?.getRandomValues) cryptoImpl.getRandomValues(bytes);
  else for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

/** A fresh room code. `random(n)` returns n bytes (injectable for tests). */
export function generateHandoffCode(random = defaultRandom) {
  const alphabet = HANDOFF_CODE_ALPHABET;
  let code = "";
  while (code.length < HANDOFF_CODE_LENGTH) {
    // Rejection-sample so every symbol is equally likely.
    const bytes = random(HANDOFF_CODE_LENGTH * 2);
    for (const byte of bytes) {
      if (code.length >= HANDOFF_CODE_LENGTH) break;
      if (byte < alphabet.length * Math.floor(256 / alphabet.length)) {
        code += alphabet[byte % alphabet.length];
      }
    }
  }
  return code;
}

/**
 * Canonicalise something a person typed or pasted: uppercase, strip spaces
 * and dashes, and fold the characters we deliberately left out of the
 * alphabet onto their look-alikes so "0" → "O"… except O and I are not in the
 * alphabet either, so those map to nothing valid and fail `isHandoffCode`.
 * That is intentional: the alphabet has no confusable pairs, so a typo shows
 * up as an invalid code rather than a silently wrong one.
 */
export function normalizeHandoffCode(input) {
  const cleaned = String(input || "").toUpperCase().replace(/[\s\-_.]/g, "");
  return cleaned.replace(/[01L]/g, (char) => CODE_CONFUSABLES[char] || char);
}

export function isHandoffCode(code) {
  if (typeof code !== "string" || code.length !== HANDOFF_CODE_LENGTH) return false;
  for (const char of code) if (!HANDOFF_CODE_ALPHABET.includes(char)) return false;
  return true;
}

/** The URL a phone scans; opening it starts the receive flow with the code. */
export function handoffUrl(origin, code, game = 'ssb64') {
  const url = new URL(game === "melee" ? "/melee/" : "/", origin);
  url.searchParams.set(HANDOFF_QUERY_PARAM, code);
  return url.toString();
}

/** The code embedded in a page URL by `handoffUrl`, or null. */
export function handoffCodeFromLocation(search) {
  const raw = new URLSearchParams(search || "").get(HANDOFF_QUERY_PARAM);
  if (!raw) return null;
  const code = normalizeHandoffCode(raw);
  return isHandoffCode(code) ? code : null;
}

// ---------------------------------------------------------------------------
// Data-channel framing. The host sends one JSON text frame (the header), then
// binary chunks in order, then a JSON `done` frame. The guest answers with a
// `received` frame once every byte is in. Text frames are tiny JSON so both
// ends can distinguish them from binary chunks by type alone.

export function encodeHandoffHeader({ name, size, sha1 }) {
  if (!Number.isInteger(size) || size <= 0) throw new Error("ROM size is required.");
  return JSON.stringify({ type: "header", name: name || "rom.z64", size, sha1: sha1 || null });
}

export function decodeHandoffFrame(text) {
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    throw new Error("Malformed handoff frame.");
  }
  if (!frame || typeof frame.type !== "string") throw new Error("Malformed handoff frame.");
  return frame;
}

/** [offset, end) chunk boundaries for a payload of `size` bytes. */
export function chunkRanges(size, chunkSize = HANDOFF_CHUNK_SIZE) {
  const ranges = [];
  for (let offset = 0; offset < size; offset += chunkSize) {
    ranges.push([offset, Math.min(size, offset + chunkSize)]);
  }
  return ranges;
}

/**
 * Receiver-side buffer. Feed it the header, then every binary chunk in order;
 * `finish()` hands back the complete image or throws if bytes are missing.
 */
export function createRomAssembler(header, { maxSize = 64 * 1024 * 1024 } = {}) {
  if (header?.type !== "header") throw new Error("Expected a handoff header first.");
  const size = Number(header.size);
  if (!Number.isInteger(size) || size <= 0 || size > maxSize) {
    throw new Error("The sending device offered an unexpected file size.");
  }
  const bytes = new Uint8Array(size);
  let received = 0;
  return {
    get size() { return size; },
    get received() { return received; },
    get progress() { return received / size; },
    push(chunk) {
      const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (received + view.length > size) throw new Error("The sending device sent more data than announced.");
      bytes.set(view, received);
      received += view.length;
      return received;
    },
    finish() {
      if (received !== size) {
        throw new Error(`Transfer ended early: ${received} of ${size} bytes arrived.`);
      }
      return bytes;
    },
  };
}
