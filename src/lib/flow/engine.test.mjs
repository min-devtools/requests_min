import assert from "node:assert/strict";
import test from "node:test";

const loadedEngine = import("./engine.ts").catch((error) => ({ loadError: error }));

const engineExports = async () => {
  const loaded = await loadedEngine;
  assert.equal(
    loaded.loadError,
    undefined,
    `flow engine module must load: ${loaded.loadError ?? "unknown error"}`,
  );
  return loaded;
};

const httpNode = (id, key, url = `https://example.test/${key}`, onError) => ({
  id,
  key,
  type: "request",
  position: { x: 0, y: 0 },
  config: {
    request: {
      name: key,
      protocol: "http",
      http: {
        method: "GET",
        url,
        headers: [],
        params: [],
        auth: { type: "none" },
        body: { type: "none" },
        insecure: false,
      },
    },
    ...(onError ? { onError } : {}),
  },
});

const grpcNode = (id, key, onError) => ({
  id,
  key,
  type: "request",
  position: { x: 0, y: 0 },
  config: {
    request: {
      name: key,
      protocol: "grpc",
      grpc: {
        endpoint: "grpc.example.test:443",
        protoSource: "reflection",
        protoFiles: [],
        service: "test.Service",
        method: "Lookup",
        message: "{}",
        metadata: [],
        insecure: false,
      },
    },
    ...(onError ? { onError } : {}),
  },
});

const delayNode = (id, key, ms) => ({
  id,
  key,
  type: "delay",
  position: { x: 0, y: 0 },
  config: { ms },
});

const transformNode = (id, key, code) => ({
  id,
  key,
  type: "transform",
  position: { x: 0, y: 0 },
  config: { code },
});

const edge = (source, target) => ({ id: `${source}-${target}`, source, target });

const makeFlow = (nodes, edges = []) => ({
  version: 1,
  id: "flow-1",
  name: "Test flow",
  nodes,
  edges,
});

const httpResponse = (status, body = "{}") => ({
  status,
  headers: [],
  body,
  timeMs: 4,
  sizeBytes: body.length,
});

const grpcResponse = (statusCode, bodyJson = "{}") => ({
  statusCode,
  headers: [],
  trailers: [],
  bodyJson,
  timeMs: 5,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeHarness = async ({ flow, previousRun = null, env = "dev" }) => {
  const { createFlowExecutor } = await engineExports();
  const flowTab = { flow, run: previousRun, running: false };
  const updates = [];
  const toasts = [];
  const httpCalls = [];
  const grpcCalls = [];
  const mirrors = [];
  const openAdapters = new Set();
  const sleepCalls = [];
  let activeEnv = env;
  let now = 1_000;
  let onHttp = async () => httpResponse(200);
  let onGrpc = async () => grpcResponse("OK");
  let onSleep = async () => {};

  const deps = {
    getFlowTab: (tabId) => tabId === "tab-1" ? flowTab : undefined,
    getActiveEnv: () => activeEnv,
    updateFlowTab: (_tabId, patch) => {
      Object.assign(flowTab, patch);
      updates.push(structuredClone(patch));
    },
    showToast: (title, body, kind) => toasts.push({ title, body, kind }),
    httpRequest: async (capturedEnv, request) => {
      httpCalls.push({ env: capturedEnv, request: structuredClone(request) });
      return onHttp(capturedEnv, request, httpCalls.length - 1);
    },
    grpcUnary: async (capturedEnv, part) => {
      grpcCalls.push({ env: capturedEnv, part: structuredClone(part) });
      return onGrpc(capturedEnv, part, grpcCalls.length - 1);
    },
    mirrorResponse: (tabId, nodeId, response) => {
      if (openAdapters.has(`${tabId}:${nodeId}`)) {
        mirrors.push({ tabId, nodeId, response: structuredClone(response) });
      }
    },
    now: () => now,
    sleep: async (ms) => {
      sleepCalls.push(ms);
      now += ms;
      await onSleep(ms, sleepCalls.length - 1);
    },
  };
  const executor = createFlowExecutor(deps);

  return {
    executor,
    flowTab,
    updates,
    toasts,
    httpCalls,
    grpcCalls,
    mirrors,
    openAdapters,
    sleepCalls,
    setEnv: (value) => { activeEnv = value; },
    setNow: (value) => { now = value; },
    setHttp: (fn) => { onHttp = fn; },
    setGrpc: (fn) => { onGrpc = fn; },
    setSleep: (fn) => { onSleep = fn; },
  };
};

test("exports the live flow API and the dependency-injected executor", async () => {
  const loaded = await engineExports();
  assert.equal(typeof loaded.runActiveFlow, "function");
  assert.equal(typeof loaded.runFlow, "function");
  assert.equal(typeof loaded.cancelFlow, "function");
  assert.equal(typeof loaded.createFlowExecutor, "function");
});

test("runs deterministic HTTP -> delay -> HTTP order with step references and one env snapshot", async () => {
  const first = httpNode("first", "login");
  const wait = delayNode("wait", "settle", 250);
  const last = httpNode(
    "last",
    "profile",
    "https://example.test/users/{{steps.login.response.body.userId}}",
  );
  const h = await makeHarness({
    flow: makeFlow([last, wait, first], [edge("first", "wait"), edge("wait", "last")]),
  });
  h.openAdapters.add("tab-1:first");
  h.openAdapters.add("tab-1:last");
  h.setHttp(async (_env, _request, index) => {
    if (index === 0) {
      h.setEnv("prod");
      return httpResponse(200, "{\"userId\":42}");
    }
    return httpResponse(204, "");
  });

  await h.executor.runFlow("tab-1");

  assert.deepEqual(h.httpCalls.map((call) => call.request.name), ["login", "profile"]);
  assert.deepEqual(h.httpCalls.map((call) => call.env), ["dev", "dev"]);
  assert.equal(h.httpCalls[1].request.http.url, "https://example.test/users/42");
  assert.deepEqual(h.sleepCalls, [100, 100, 50]);
  assert.deepEqual(h.mirrors.map((entry) => entry.nodeId), ["first", "last"]);
  assert.equal(h.flowTab.run.status, "success");
  assert.deepEqual(
    Object.fromEntries(Object.entries(h.updates[0].run.steps).map(([id, result]) => [id, result.status])),
    { last: "idle", wait: "idle", first: "idle" },
  );
  assert.equal(h.flowTab.running, false);
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].title, "Flow finished");
});

test("classifies HTTP and gRPC responses and retains failed responses", async () => {
  const nodes = [
    httpNode("h-ok", "http-ok", undefined, "continue"),
    httpNode("h-bad", "http-bad", undefined, "continue"),
    grpcNode("g-ok", "grpc-ok", "continue"),
    grpcNode("g-bad", "grpc-bad", "continue"),
  ];
  const h = await makeHarness({
    flow: makeFlow(nodes, [edge("h-ok", "h-bad"), edge("h-bad", "g-ok"), edge("g-ok", "g-bad")]),
  });
  h.setHttp(async (_env, _request, index) => index === 0
    ? httpResponse(399, "{\"ok\":true}")
    : httpResponse(400, "{\"error\":\"bad\"}"));
  h.setGrpc(async (_env, _part, index) => index === 0
    ? grpcResponse("OK", "{\"ok\":true}")
    : grpcResponse("NOT_FOUND", "{\"error\":\"missing\"}"));

  await h.executor.runFlow("tab-1");

  assert.deepEqual(
    Object.fromEntries(Object.entries(h.flowTab.run.steps).map(([id, result]) => [id, result.status])),
    { "h-ok": "success", "h-bad": "failed", "g-ok": "success", "g-bad": "failed" },
  );
  assert.equal(h.flowTab.run.steps["h-bad"].response.status, 400);
  assert.match(h.flowTab.run.steps["h-bad"].error, /400/);
  assert.equal(h.flowTab.run.steps["g-bad"].response.statusCode, "NOT_FOUND");
  assert.match(h.flowTab.run.steps["g-bad"].error, /NOT_FOUND/);
  assert.equal(h.flowTab.run.status, "failed");
});

test("stop skips remaining targets while continue executes them but keeps the run failed", async () => {
  const stopped = await makeHarness({
    flow: makeFlow(
      [httpNode("a", "a"), httpNode("b", "b"), httpNode("c", "c")],
      [edge("a", "b"), edge("b", "c")],
    ),
  });
  stopped.setHttp(async () => httpResponse(500));
  await stopped.executor.runFlow("tab-1");

  assert.equal(stopped.httpCalls.length, 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(stopped.flowTab.run.steps).map(([id, result]) => [id, result.status])),
    { a: "failed", b: "skipped", c: "skipped" },
  );

  const continued = await makeHarness({
    flow: makeFlow(
      [httpNode("a", "a", undefined, "continue"), httpNode("b", "b")],
      [edge("a", "b")],
    ),
  });
  continued.setHttp(async (_env, _request, index) => httpResponse(index === 0 ? 500 : 200));
  await continued.executor.runFlow("tab-1");

  assert.equal(continued.httpCalls.length, 2);
  assert.equal(continued.flowTab.run.steps.b.status, "success");
  assert.equal(continued.flowTab.run.status, "failed");
});

test("independent branches run in parallel; a stop-failure skips only its descendants", async () => {
  // a ─┬─ b (fails, stop) ── d
  //    └─ c (independent, must still run)
  const h = await makeHarness({
    flow: makeFlow(
      [httpNode("a", "a"), httpNode("b", "b"), httpNode("c", "c"), httpNode("d", "d")],
      [edge("a", "b"), edge("a", "c"), edge("b", "d")],
    ),
  });
  h.setHttp(async (_env, request) => httpResponse(request.name === "b" ? 500 : 200));

  await h.executor.runFlow("tab-1");

  assert.deepEqual(
    Object.fromEntries(Object.entries(h.flowTab.run.steps).map(([id, result]) => [id, result.status])),
    { a: "success", b: "failed", c: "success", d: "skipped" },
  );
  // c ran despite b's stop-failure — the failure is scoped to b's descendant d
  assert.deepEqual(h.httpCalls.map((call) => call.request.name).sort(), ["a", "b", "c"]);
  assert.equal(h.flowTab.run.status, "failed");
});

test("cancel interrupts a delay in slices no larger than 100ms and skips the rest", async () => {
  const h = await makeHarness({
    flow: makeFlow([delayNode("wait", "wait", 1_000), httpNode("after", "after")], [edge("wait", "after")]),
  });
  h.setSleep(async () => h.executor.cancelFlow("tab-1"));

  await h.executor.runFlow("tab-1");

  assert.deepEqual(h.sleepCalls, [100]);
  assert.ok(h.sleepCalls.every((slice) => slice <= 100));
  assert.equal(h.flowTab.run.steps.wait.status, "skipped");
  assert.equal(h.flowTab.run.steps.after.status, "skipped");
  assert.equal(h.flowTab.run.status, "cancelled");
  assert.equal(h.httpCalls.length, 0);
  assert.equal(h.flowTab.running, false);
});

test("cancel does not abort an in-flight request and running stays true until it settles", async () => {
  const pending = deferred();
  const h = await makeHarness({
    flow: makeFlow([httpNode("active", "active"), httpNode("after", "after")], [edge("active", "after")]),
  });
  h.setHttp(async () => pending.promise);

  const runPromise = h.executor.runFlow("tab-1");
  assert.equal(h.httpCalls.length, 1);
  h.executor.cancelFlow("tab-1");
  assert.equal(h.flowTab.running, true);
  assert.equal(h.flowTab.run.steps.active.status, "running");

  pending.resolve(httpResponse(200));
  await runPromise;

  assert.equal(h.httpCalls.length, 1);
  assert.equal(h.flowTab.run.steps.active.status, "success");
  assert.equal(h.flowTab.run.steps.after.status, "skipped");
  assert.equal(h.flowTab.run.status, "cancelled");
  assert.equal(h.flowTab.running, false);
});

test("a transform step runs its JS on the parent's body and feeds the result downstream", async () => {
  const src = httpNode("src", "src");
  const xform = transformNode("xf", "shape", "const value = {{steps.src.response.body}}\nreturn { doubled: value.count * 2 };");
  const sink = httpNode("sink", "sink", "https://example.test/n/{{steps.shape.doubled}}");
  const h = await makeHarness({
    flow: makeFlow([src, xform, sink], [edge("src", "xf"), edge("xf", "sink")]),
  });
  h.setHttp(async (_env, _request, index) =>
    index === 0 ? httpResponse(200, "{\"count\":21}") : httpResponse(204, ""));

  await h.executor.runFlow("tab-1");

  assert.equal(h.flowTab.run.steps.xf.status, "success");
  assert.deepEqual(h.flowTab.run.steps.xf.output, { doubled: 42 });
  // the transform's return is referenceable by the next step
  assert.equal(h.httpCalls[1].request.http.url, "https://example.test/n/42");
  assert.equal(h.flowTab.run.status, "success");
});

test("a throwing transform fails the step and skips its descendants", async () => {
  const src = httpNode("src", "src");
  const xform = transformNode("xf", "shape", "throw new Error('boom');");
  const sink = httpNode("sink", "sink");
  const h = await makeHarness({
    flow: makeFlow([src, xform, sink], [edge("src", "xf"), edge("xf", "sink")]),
  });

  await h.executor.runFlow("tab-1");

  assert.equal(h.flowTab.run.steps.xf.status, "failed");
  assert.match(h.flowTab.run.steps.xf.error, /boom/);
  assert.equal(h.flowTab.run.steps.sink.status, "skipped");
  assert.equal(h.httpCalls.length, 1);
  assert.equal(h.flowTab.run.status, "failed");
});

test("a transform returning non-cloneable data fails the step instead of stranding the run", async () => {
  const xform = transformNode("xf", "shape", "return { fn: () => 1 };");
  const h = await makeHarness({ flow: makeFlow([xform], []) });

  await h.executor.runFlow("tab-1");

  assert.equal(h.flowTab.run.steps.xf.status, "failed");
  assert.match(h.flowTab.run.steps.xf.error, /plain JSON/);
  assert.equal(h.flowTab.run.status, "failed");
  assert.equal(h.flowTab.running, false);
});

test("transport rejection becomes a failed step and stops later requests", async () => {
  const h = await makeHarness({
    flow: makeFlow([httpNode("a", "a"), httpNode("b", "b")], [edge("a", "b")]),
  });
  h.setHttp(async () => { throw new Error("network unavailable"); });

  await h.executor.runFlow("tab-1");

  assert.equal(h.flowTab.run.steps.a.status, "failed");
  assert.match(h.flowTab.run.steps.a.error, /network unavailable/);
  assert.deepEqual(h.flowTab.run.steps.a.resolvedRequest, h.httpCalls[0].request);
  assert.equal(h.flowTab.run.steps.b.status, "skipped");
  assert.equal(h.httpCalls.length, 1);
  assert.equal(h.flowTab.run.status, "failed");
});

test("malformed protocol payload becomes a failed step without invoking the backend", async () => {
  const malformed = grpcNode("bad", "bad");
  delete malformed.config.request.grpc;
  const h = await makeHarness({ flow: makeFlow([malformed]) });

  await h.executor.runFlow("tab-1");

  assert.equal(h.flowTab.run.steps.bad.status, "failed");
  assert.match(h.flowTab.run.steps.bad.error, /gRPC.*configuration/i);
  assert.equal(h.grpcCalls.length, 0);
});

test("invalid flow toasts and makes no API or run-state calls", async () => {
  const h = await makeHarness({ flow: makeFlow([]) });

  await h.executor.runFlow("tab-1");

  assert.equal(h.httpCalls.length, 0);
  assert.equal(h.grpcCalls.length, 0);
  assert.equal(h.updates.length, 0);
  assert.equal(h.flowTab.run, null);
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].title, "Flow invalid");
  assert.match(h.toasts[0].body, /no nodes/i);
});

test("single-node run rejects a missing target clearly", async () => {
  const h = await makeHarness({ flow: makeFlow([delayNode("present", "present", 0)]) });

  await h.executor.runFlow("tab-1", "missing");

  assert.equal(h.updates.length, 0);
  assert.equal(h.toasts.length, 1);
  assert.match(`${h.toasts[0].title} ${h.toasts[0].body}`, /not found|missing/i);
});

test("single-node rerun keeps successful ancestors usable and carries other steps over as stale", async () => {
  const upstream = httpNode("upstream", "login");
  const target = httpNode("target", "target", "https://example.test/{{steps.login.response.body.token}}");
  const downstream = httpNode("downstream", "downstream");
  const unrelated = httpNode("unrelated", "unrelated");
  const previousRun = {
    startedAt: 1,
    status: "failed",
    steps: {
      upstream: {
        status: "success",
        resolvedRequest: upstream.config.request,
        response: httpResponse(200, "{\"token\":\"ancestor\"}"),
      },
      target: { status: "failed", error: "old target failure" },
      downstream: { status: "failed", error: "stale downstream failure" },
      unrelated: { status: "failed", error: "stale unrelated failure" },
    },
  };
  const h = await makeHarness({
    flow: makeFlow(
      [upstream, target, downstream, unrelated],
      [edge("upstream", "target"), edge("target", "downstream")],
    ),
    previousRun,
  });

  await h.executor.runFlow("tab-1", "target");

  assert.equal(h.httpCalls.length, 1);
  assert.equal(h.httpCalls[0].request.http.url, "https://example.test/ancestor");
  assert.equal(h.flowTab.run.steps.target.status, "success");
  assert.equal(h.flowTab.run.steps.upstream.status, "success");
  assert.equal(h.flowTab.run.steps.upstream.stale, undefined);
  assert.deepEqual(h.flowTab.run.steps.downstream, { status: "failed", error: "stale downstream failure", stale: true });
  assert.deepEqual(h.flowTab.run.steps.unrelated, { status: "failed", error: "stale unrelated failure", stale: true });
  assert.equal(h.flowTab.run.status, "success");
  assert.equal(h.toasts.length, 0);
});

test("single-node rerun cannot resolve downstream or unrelated stale results", async () => {
  for (const staleKey of ["downstream", "unrelated"]) {
    const target = httpNode("target", "target", `https://example.test/{{steps.${staleKey}.response.body.token}}`);
    const downstream = httpNode("downstream", "downstream");
    const unrelated = httpNode("unrelated", "unrelated");
    const previousRun = {
      startedAt: 1,
      status: "success",
      steps: {
        downstream: {
          status: "success",
          resolvedRequest: downstream.config.request,
          response: httpResponse(200, "{\"token\":\"forbidden\"}"),
        },
        unrelated: {
          status: "success",
          resolvedRequest: unrelated.config.request,
          response: httpResponse(200, "{\"token\":\"forbidden\"}"),
        },
      },
    };
    const h = await makeHarness({
      flow: makeFlow([target, downstream, unrelated], [edge("target", "downstream")]),
      previousRun,
    });

    await h.executor.runFlow("tab-1", "target");

    assert.equal(h.httpCalls.length, 0);
    assert.equal(h.flowTab.run.steps.target.status, "failed");
    assert.match(h.flowTab.run.steps.target.error, new RegExp(`steps\\.${staleKey}`));
    assert.equal(h.flowTab.run.status, "failed");
  }
});

test("captures a flow snapshot before async work so graph edits cannot change later steps", async () => {
  const first = httpNode("first", "first");
  const second = httpNode("second", "second", "https://example.test/original");
  const flow = makeFlow([first, second], [edge("first", "second")]);
  const h = await makeHarness({ flow });
  h.setHttp(async (_env, _request, index) => {
    if (index === 0) {
      flow.nodes[1].config.request.http.url = "https://example.test/edited";
      flow.nodes.reverse();
      flow.edges.length = 0;
    }
    return httpResponse(200);
  });

  await h.executor.runFlow("tab-1");

  assert.deepEqual(h.httpCalls.map((call) => call.request.name), ["first", "second"]);
  assert.equal(h.httpCalls[1].request.http.url, "https://example.test/original");
});

test("allows only one active run per tab", async () => {
  const pending = deferred();
  const h = await makeHarness({ flow: makeFlow([httpNode("one", "one")]) });
  h.setHttp(async () => pending.promise);

  const firstRun = h.executor.runFlow("tab-1");
  const secondRun = h.executor.runFlow("tab-1");

  assert.equal(h.httpCalls.length, 1);
  pending.resolve(httpResponse(200));
  await Promise.all([firstRun, secondRun]);
  assert.equal(h.httpCalls.length, 1);
});

const makeLiveHarness = async (flow, { onSleep } = {}) => {
  const loaded = await engineExports();
  assert.equal(typeof loaded.createLiveFlowBindings, "function");

  const flowTab = { flow, run: null, running: false };
  const requestTabs = {};
  const responseUpdates = [];
  const httpCalls = [];
  const grpcCalls = [];
  const historyEntries = [];
  const state = {
    tabs: [
      { id: "request-tab", kind: "request" },
      { id: "flow-tab", kind: "flow" },
    ],
    activeTabId: "request-tab",
    activeEnv: "staging",
    flowTabs: { "flow-tab": flowTab },
    requestTabs,
    updateFlowTab: (_tabId, patch) => Object.assign(flowTab, patch),
    updateRequestTab: (tabId, patch) => {
      Object.assign(requestTabs[tabId], patch);
      responseUpdates.push({ tabId, patch: structuredClone(patch) });
    },
    showToast: () => {},
    addHistory: (entry) => historyEntries.push(structuredClone(entry)),
  };
  let bindings;
  bindings = loaded.createLiveFlowBindings(
    () => state,
    {
      httpRequest: async (env, request) => {
        httpCalls.push({ env, request: structuredClone(request) });
        return httpResponse(200, "{\"live\":true}");
      },
      grpcUnary: async (env, part) => {
        grpcCalls.push({ env, part: structuredClone(part) });
        return grpcResponse("OK");
      },
    },
    {
      now: () => 10,
      sleep: async (ms) => onSleep?.(ms, bindings),
    },
  );
  return { bindings, flowTab, requestTabs, responseUpdates, httpCalls, grpcCalls, historyEntries, state };
};

test("live binding runs only the active flow and forwards captured env and API arguments", async () => {
  const request = httpNode("request", "live-request");
  const h = await makeLiveHarness(makeFlow([request]));

  await h.bindings.runActiveFlow();
  assert.equal(h.httpCalls.length, 0);
  assert.equal(h.flowTab.run, null);

  h.state.activeTabId = "flow-tab";
  await h.bindings.runActiveFlow();

  assert.equal(h.httpCalls.length, 1);
  assert.equal(h.httpCalls[0].env, "staging");
  assert.deepEqual(h.httpCalls[0].request, request.config.request);
  assert.equal(h.flowTab.run.status, "success");
  assert.equal(h.historyEntries.length, 1);
  assert.equal(h.historyEntries[0].status, "200");
  assert.equal(h.historyEntries[0].error, null);
});

test("live binding mirrors responses only while the flow request adapter exists", async () => {
  const h = await makeLiveHarness(makeFlow([httpNode("request", "live-request")]));

  await h.bindings.runFlow("flow-tab");
  assert.equal(h.responseUpdates.length, 0);

  const editorId = "flowreq:flow-tab:request";
  h.requestTabs[editorId] = {};
  await h.bindings.runFlow("flow-tab");

  assert.equal(h.responseUpdates.length, 1);
  assert.equal(h.responseUpdates[0].tabId, editorId);
  assert.equal(h.responseUpdates[0].patch.response.status, 200);
});

test("live binding cancel reaches the active executor token", async () => {
  const h = await makeLiveHarness(
    makeFlow(
      [delayNode("wait", "wait", 500), httpNode("after", "after")],
      [edge("wait", "after")],
    ),
    { onSleep: (_ms, bindings) => bindings.cancelFlow("flow-tab") },
  );

  await h.bindings.runFlow("flow-tab");

  assert.equal(h.flowTab.run.status, "cancelled");
  assert.equal(h.flowTab.run.steps.wait.status, "skipped");
  assert.equal(h.flowTab.run.steps.after.status, "skipped");
  assert.equal(h.httpCalls.length, 0);
});
