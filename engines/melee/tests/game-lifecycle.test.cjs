const { test } = require("node:test");
const assert = require("node:assert/strict");
const create = require("../desktop/game-lifecycle.cjs");

test("reload cleanup finishes before the next renderer can reserve a match", async () => {
  const calls = [];
  let finishStop;
  const lifecycle = create(async (route, body) => {
    calls.push([route, body]);
    if (route.endsWith("/stop")) await new Promise(resolve => { finishStop = resolve; });
  });
  const reset = lifecycle.reset();
  const begin = lifecycle.begin("next");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  finishStop();
  await Promise.all([reset, begin]);
  assert.deepEqual(calls, [["/api/native/stop", {}], ["/api/native/begin", { session: "next" }]]);
});

test("renderer loss disables presentation and clears held input immediately", async () => {
  const calls = [];
  const lifecycle = create(async () => {}, {
    ready: value => calls.push(value), clearInput: () => calls.push("clear"),
  });
  await lifecycle.reset();
  assert.deepEqual(calls, [false, "clear"]);
});
