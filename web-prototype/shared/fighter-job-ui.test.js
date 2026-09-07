import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFighterJobCellError,
  formatFighterJobError,
  reconcileVisibleFighterJobs,
} from "./fighter-job-ui.js";

test("generation errors are converted to friendly toast and compact cell copy", () => {
  const copyrightJob = { name: "Captain Test", error: "provider rejected copyrighted content" };
  assert.match(formatFighterJobError(copyrightJob), /couldn’t create Captain Test/);
  assert.doesNotMatch(formatFighterJobError(copyrightJob), /provider rejected copyrighted content/);
  assert.equal(formatFighterJobCellError(copyrightJob), "Copyright blocked");

  const safetyJob = { name: "Safety Test", error: "content policy safety block" };
  assert.match(formatFighterJobError(safetyJob), /safety checks/);
  assert.equal(formatFighterJobCellError(safetyJob), "Safety check failed");

  const codedSafetyJob = { name: "Coded Test", error: "moderation_blocked: content_filter" };
  assert.match(formatFighterJobError(codedSafetyJob), /safety checks/);

  const rawJob = { name: "Raw Test", error: "Traceback: pipeline exited with code 17" };
  assert.equal(
    formatFighterJobError(rawJob),
    "We couldn’t finish generating Raw Test. Please try again with a different photo or fighter details.",
  );
});

test("old failed jobs disappear on refresh while an observed job remains if it fails", () => {
  const oldFailure = {
    id: "old-failure",
    status: "failed",
    revision: 3,
    createdAt: "2026-09-01T10:00:00.000Z",
  };
  assert.deepEqual(reconcileVisibleFighterJobs([], [oldFailure]), []);

  const running = {
    id: "live-job",
    status: "running",
    revision: 1,
    createdAt: "2026-09-02T10:00:00.000Z",
  };
  const failed = { ...running, status: "failed", revision: 2 };
  assert.deepEqual(reconcileVisibleFighterJobs([running], [oldFailure, failed]), [failed]);
});

test("job reconciliation does not replace a newer live event with stale polling data", () => {
  const live = {
    id: "live-job",
    status: "running",
    revision: 5,
    createdAt: "2026-09-02T10:00:00.000Z",
  };
  const stale = { ...live, progress: 20, revision: 4 };
  assert.deepEqual(reconcileVisibleFighterJobs([live], [stale]), [live]);
});

test("Tripo edge rejection is a provider failure, not a photo safety failure", () => {
  const job = { name: "Test", error: "RuntimeError: HTTP 403 from https://api.tripo3d.ai/v2/openapi/task: error code: 1010" };
  assert.equal(formatFighterJobCellError(job), "Provider unavailable");
  assert.match(formatFighterJobError(job), /3D provider is blocking our connection/);
  assert.doesNotMatch(formatFighterJobError(job), /different photo|safety checks/);
});
