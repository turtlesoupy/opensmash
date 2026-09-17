import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDOFF_CODE_ALPHABET,
  HANDOFF_CODE_LENGTH,
  chunkRanges,
  createRomAssembler,
  decodeHandoffFrame,
  encodeHandoffHeader,
  generateHandoffCode,
  handoffCodeFromLocation,
  handoffUrl,
  isHandoffCode,
  normalizeHandoffCode,
} from "./rom-handoff.js";

test("generated codes use only the unambiguous alphabet", () => {
  for (let round = 0; round < 200; round += 1) {
    const code = generateHandoffCode();
    assert.equal(code.length, HANDOFF_CODE_LENGTH);
    assert.ok(isHandoffCode(code), code);
    assert.doesNotMatch(code, /[01OIL]/);
  }
});

test("generateHandoffCode rejection-samples so bytes past the alphabet range are skipped", () => {
  // 255 is outside the accepted range and must be skipped, not wrapped.
  const bytes = [255, 0, 255, 1, 2, 3, 4, 5, 6];
  let cursor = 0;
  const random = (n) => Uint8Array.from({ length: n }, () => bytes[Math.min(cursor++, bytes.length - 1)]);
  const code = generateHandoffCode(random);
  assert.equal(code, [0, 1, 2, 3, 4, 5].map((index) => HANDOFF_CODE_ALPHABET[index]).join(""));
});

test("normalizeHandoffCode uppercases, strips separators, and folds confusables to invalid symbols", () => {
  assert.equal(normalizeHandoffCode(" ab-cd ef "), "ABCDEF");
  assert.equal(normalizeHandoffCode("abc.def"), "ABCDEF");
  // 0/1/L are not in the alphabet, and neither are O or I: a typo fails
  // validation instead of quietly matching the wrong room.
  assert.equal(isHandoffCode(normalizeHandoffCode("0BCDEF")), false);
  assert.equal(isHandoffCode(normalizeHandoffCode("1BCDEF")), false);
  assert.equal(isHandoffCode(normalizeHandoffCode("lBCDEF")), false);
  assert.equal(isHandoffCode("ABCDEF"), true);
  assert.equal(isHandoffCode("ABCDE"), false);
  assert.equal(isHandoffCode("ABCDEFG"), false);
  assert.equal(isHandoffCode(null), false);
});

test("handoffUrl round-trips through handoffCodeFromLocation", () => {
  const url = handoffUrl("https://example.com", "ABCDEF");
  assert.equal(url, "https://example.com/?handoff=ABCDEF");
  assert.equal(handoffUrl("https://example.com", "ABCDEF", "melee"), "https://example.com/melee/?handoff=ABCDEF");
  assert.equal(handoffCodeFromLocation(new URL(url).search), "ABCDEF");
  assert.equal(handoffCodeFromLocation("?handoff=abc-def"), "ABCDEF");
  assert.equal(handoffCodeFromLocation("?handoff=nope"), null);
  assert.equal(handoffCodeFromLocation(""), null);
});

test("header frames encode and decode", () => {
  const header = decodeHandoffFrame(encodeHandoffHeader({ name: "smash.z64", size: 16, sha1: "ab" }));
  assert.deepEqual(header, { type: "header", name: "smash.z64", size: 16, sha1: "ab" });
  assert.throws(() => encodeHandoffHeader({ size: 0 }), /size/);
  assert.throws(() => decodeHandoffFrame("not json"), /Malformed/);
  assert.throws(() => decodeHandoffFrame("{}"), /Malformed/);
});

test("chunkRanges covers the payload exactly", () => {
  assert.deepEqual(chunkRanges(10, 4), [[0, 4], [4, 8], [8, 10]]);
  assert.deepEqual(chunkRanges(8, 4), [[0, 4], [4, 8]]);
  assert.deepEqual(chunkRanges(0, 4), []);
});

test("assembler reassembles chunks and refuses short or long transfers", () => {
  const source = Uint8Array.from({ length: 37 }, (_, index) => index);
  const assembler = createRomAssembler({ type: "header", size: source.length });
  for (const [start, end] of chunkRanges(source.length, 8)) {
    assembler.push(source.subarray(start, end).buffer.slice(start, end));
  }
  assert.equal(assembler.progress, 1);
  assert.deepEqual(assembler.finish(), source);

  const short = createRomAssembler({ type: "header", size: 4 });
  short.push(new Uint8Array([1, 2]));
  assert.throws(() => short.finish(), /ended early/);

  const long = createRomAssembler({ type: "header", size: 2 });
  assert.throws(() => long.push(new Uint8Array([1, 2, 3])), /more data/);

  assert.throws(() => createRomAssembler({ type: "header", size: 1e12 }), /unexpected file size/);
  assert.throws(() => createRomAssembler({ type: "done" }), /header first/);
});
