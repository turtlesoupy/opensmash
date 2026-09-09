import { readFile } from "node:fs/promises";

const MODERATION_URL = "https://api.openai.com/v1/moderations";
const DEFAULT_MODEL = "omni-moderation-latest";

export class SubmissionModerationError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function selectedCategories(result) {
  return Object.fromEntries(
    Object.entries(result?.categories || {}).filter(([, selected]) => selected === true),
  );
}

export function createSubmissionModerator({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.FIGHTER_MODERATION_MODEL || DEFAULT_MODEL,
  enabled = process.env.FIGHTER_MODERATION_ENABLED !== "0",
  required = process.env.NODE_ENV === "production",
  fetchImpl = fetch,
} = {}) {
  return async function moderateSubmission({ name, emblem, moveDirection, photoPath, mimeType }) {
    if (!enabled || !apiKey) {
      if (required && enabled) {
        throw new SubmissionModerationError(
          503,
          "Safety screening is temporarily unavailable. Please try again shortly.",
        );
      }
      return { status: "skipped", model: null, checkedAt: new Date().toISOString() };
    }

    const photo = await readFile(photoPath);
    const input = [
      {
        type: "text",
        text: [
          `Requested fighter name: ${name}`,
          `Requested emblem direction: ${emblem || "(none)"}`,
          `Requested move direction: ${moveDirection || "(none)"}`,
        ].join("\n"),
      },
      {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${photo.toString("base64")}` },
      },
    ];

    let response;
    try {
      response = await fetchImpl(MODERATION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new SubmissionModerationError(
        503,
        "Safety screening is temporarily unavailable. Please try again shortly.",
        error.message,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new SubmissionModerationError(
        503,
        "Safety screening is temporarily unavailable. Please try again shortly.",
        `OpenAI moderation returned HTTP ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const payload = await response.json();
    const result = payload.results?.[0];
    if (!result || typeof result.flagged !== "boolean") {
      throw new SubmissionModerationError(
        503,
        "Safety screening returned an invalid result. Please try again shortly.",
      );
    }

    const categories = selectedCategories(result);
    if (result.flagged || Object.keys(categories).length) {
      throw new SubmissionModerationError(
        422,
        "That photo or description does not meet the fighter upload safety rules.",
        { categories: Object.keys(categories), model: payload.model || model },
      );
    }

    return {
      status: "approved",
      model: payload.model || model,
      checkedAt: new Date().toISOString(),
    };
  };
}

export const moderateFighterSubmission = createSubmissionModerator();
