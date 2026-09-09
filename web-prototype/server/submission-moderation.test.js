import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SubmissionModerationError,
  createSubmissionModerator,
} from "./submission-moderation.js";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opensmash-moderation-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const photoPath = path.join(root, "photo.png");
  await writeFile(photoPath, Buffer.from("89504e470d0a1a0a", "hex"));
  return photoPath;
}

test("submission moderation sends text and image before approving", async (context) => {
  const photoPath = await fixture(context);
  let request;
  const moderator = createSubmissionModerator({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({
        model: "omni-moderation-2024-09-26",
        results: [{ flagged: false, categories: { sexual: false } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const result = await moderator({
    name: "Safe Fighter",
    emblem: "A star",
    moveDirection: "Fights with vines",
    photoPath,
    mimeType: "image/png",
  });
  assert.equal(result.status, "approved");
  assert.equal(request.model, "omni-moderation-latest");
  assert.match(request.input[0].text, /Safe Fighter/);
  assert.match(request.input[0].text, /Requested move direction: Fights with vines/);
  assert.match(request.input[1].image_url.url, /^data:image\/png;base64,/);
});

test("flagged submissions are rejected with safe public copy", async (context) => {
  const photoPath = await fixture(context);
  const moderator = createSubmissionModerator({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      model: "omni-moderation-latest",
      results: [{ flagged: true, categories: { sexual: true, violence: false } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  await assert.rejects(
    moderator({ name: "Rejected", emblem: "", photoPath, mimeType: "image/png" }),
    (error) => error instanceof SubmissionModerationError &&
      error.status === 422 &&
      error.details.categories.includes("sexual"),
  );
});

test("production moderation fails closed without a key", async (context) => {
  const photoPath = await fixture(context);
  const moderator = createSubmissionModerator({ apiKey: "", required: true });
  await assert.rejects(
    moderator({ name: "No key", emblem: "", photoPath, mimeType: "image/png" }),
    (error) => error.status === 503,
  );
});
