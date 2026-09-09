import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createWorkerServiceHandler } from "./worker-service.js";

async function listen(service) {
  const server = http.createServer(service.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

function ndjson(text) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("a claimable job streams acceptance first and the result last", async () => {
  const seen = [];
  const service = createWorkerServiceHandler({
    instanceId: "rev-1-abcd",
    claim: async (jobId, executionId) => { seen.push(["claim", jobId, executionId]); return { claimed: true, job: {} }; },
    run: async (jobId, executionId) => { seen.push(["run", jobId, executionId]); return { status: "complete", revision: 9 }; },
  });
  const { base, close } = await listen(service);
  try {
    const response = await fetch(`${base}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "11111111-1111-1111-1111-111111111111" }),
    });
    assert.equal(response.status, 200);
    const lines = ndjson(await response.text());
    assert.deepEqual(lines[0], { accepted: true, executionId: "rev-1-abcd-1", jobId: "11111111-1111-1111-1111-111111111111" });
    assert.deepEqual(lines.at(-1), { done: true, status: "complete", revision: 9 });
    assert.deepEqual(seen, [
      ["claim", "11111111-1111-1111-1111-111111111111", "rev-1-abcd-1"],
      ["run", "11111111-1111-1111-1111-111111111111", "rev-1-abcd-1"],
    ]);
    assert.equal(service.isBusy(), false);
  } finally {
    await close();
  }
});

test("an unclaimable job is refused before any stream starts", async () => {
  let ran = false;
  const service = createWorkerServiceHandler({
    instanceId: "w",
    claim: async () => ({ claimed: false, job: { status: "running" } }),
    run: async () => { ran = true; },
  });
  const { base, close } = await listen(service);
  try {
    const response = await fetch(`${base}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "job-00000001" }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "not claimable", status: "running" });
    assert.equal(ran, false);
  } finally {
    await close();
  }
});

test("a busy instance refuses a second job and reports it on readyz", async () => {
  let finish;
  const running = new Promise((resolve) => { finish = resolve; });
  const service = createWorkerServiceHandler({
    instanceId: "w",
    claim: async () => ({ claimed: true, job: {} }),
    run: () => running.then(() => ({ status: "complete" })),
    heartbeatMs: 10,
  });
  const { base, close } = await listen(service);
  try {
    const first = fetch(`${base}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "job-00000001" }),
    });
    // Wait until the first run is in flight.
    while (!service.isBusy()) await new Promise((resolve) => setTimeout(resolve, 5));
    const health = await (await fetch(`${base}/readyz`)).json();
    assert.equal(health.busy.jobId, "job-00000001");
    const second = await fetch(`${base}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "job-00000002" }),
    });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error, "busy");
    await new Promise((resolve) => setTimeout(resolve, 40));
    finish();
    const lines = ndjson(await (await first).text());
    assert.ok(lines.some((line) => line.heartbeat), "heartbeats keep the stream alive");
    assert.equal(lines.at(-1).done, true);
  } finally {
    await close();
  }
});

test("a crashing run still ends the stream with a failed status", async () => {
  const service = createWorkerServiceHandler({
    instanceId: "w",
    claim: async () => ({ claimed: true, job: {} }),
    run: async () => { throw new Error("boom"); },
  });
  const { base, close } = await listen(service);
  try {
    const response = await fetch(`${base}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "job-00000001" }),
    });
    const lines = ndjson(await response.text());
    assert.equal(lines.at(-1).status, "failed");
    assert.equal(service.isBusy(), false);
  } finally {
    await close();
  }
});

test("bad requests are rejected", async () => {
  const service = createWorkerServiceHandler({ instanceId: "w", claim: async () => ({}), run: async () => ({}) });
  const { base, close } = await listen(service);
  try {
    const missing = await fetch(`${base}/run`, { method: "POST", body: "{}" });
    assert.equal(missing.status, 400);
    const other = await fetch(`${base}/nope`);
    assert.equal(other.status, 404);
  } finally {
    await close();
  }
});

test('special job kind reaches both claim and execution without fighter routing',async()=>{
 const seen=[];const service=createWorkerServiceHandler({instanceId:'special-worker',
  claim:async(id,execution,kind)=>{seen.push(['claim',kind]);return {claimed:true,job:{}};},
  run:async(id,execution,kind)=>{seen.push(['run',kind]);return {status:'complete'};}});
 const {base,close}=await listen(service);
 try {
  const response=await fetch(`${base}/run`,{method:'POST',body:JSON.stringify({jobId:'special-123456',jobKind:'specials'})});
  await response.text();assert.equal(response.status,200);assert.deepEqual(seen,[['claim','specials'],['run','specials']]);
 }finally{await close();}
});
