import assert from "node:assert/strict";
import test from "node:test";
import { emptyFlow, isRequestNode } from "./types.ts";
import { stepKeyFor, topoOrder, validateFlow } from "./validate.ts";

const node = (id, overrides = {}) => ({
  id,
  key: id,
  type: "delay",
  position: { x: 0, y: 0 },
  config: { ms: 1 },
  ...overrides,
});
const edge = (source, target, overrides = {}) => ({
  id: `${source}-${target}`,
  source,
  target,
  ...overrides,
});

test("topoOrder returns execution order respecting edges", () => {
  const order = topoOrder([node("b"), node("a")], [edge("a", "b")]);
  assert.deepEqual(order, ["a", "b"]);
});

test("topoOrder returns null on cycle", () => {
  assert.equal(topoOrder([node("a"), node("b")], [edge("a", "b"), edge("b", "a")]), null);
});

test("validateFlow flags cycle, duplicate keys, ws request, disconnected node", () => {
  const ws = node("w", {
    type: "request",
    config: {
      request: {
        name: "w",
        protocol: "ws",
        ws: { url: "", headers: [], savedMessages: [] },
      },
    },
  });
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b", { key: "a" }), ws],
    edges: [edge("a", "b"), edge("b", "a")],
  };
  const messages = validateFlow(flow).map((issue) => issue.message).join(" | ");
  assert.match(messages, /cycle/);
  assert.match(messages, /Duplicate step key "a"/);
  assert.match(messages, /WebSocket/);
  assert.match(messages, /not connected/);
});

test("validateFlow accepts a simple valid chain", () => {
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b")],
    edges: [edge("a", "b")],
  };
  assert.deepEqual(validateFlow(flow).filter((issue) => issue.level === "error"), []);
});

test("stepKeyFor slugs and dedupes", () => {
  assert.equal(stepKeyFor("Login user!", new Set()), "login-user");
  assert.equal(stepKeyFor("Login user", new Set(["login-user"])), "login-user-2");
  assert.equal(stepKeyFor("###", new Set()), "step");
});

test("validateFlow rejects step keys outside the generated slug grammar", () => {
  for (const [index, key] of ["login.v2", "__proto__", "Login", "login user"].entries()) {
    const id = `invalid-key-${index}`;
    const issues = validateFlow({
      version: 1,
      id: "f",
      name: "f",
      nodes: [node(id, { key })],
      edges: [],
    });
    const invalidKey = issues.find((issue) => issue.nodeId === id && /Invalid step key/.test(issue.message));

    assert.equal(invalidKey?.level, "error", `expected ${JSON.stringify(key)} to be rejected`);
    assert.match(invalidKey?.message ?? "", /\^\[a-z0-9\]/);
  }
});

test("isRequestNode rejects malformed external request nodes", () => {
  assert.equal(isRequestNode(node("bad", { type: "request", config: {} })), false);
  assert.equal(isRequestNode(node("bad", {
    type: "request",
    config: { request: { name: "bad", protocol: "invalid" } },
  })), false);
});

test("isRequestNode requires valid base fields", () => {
  const config = { request: { name: "request", protocol: "http" } };

  assert.equal(isRequestNode({ type: "request", config: { request: { protocol: "http" } } }), false);
  assert.equal(isRequestNode({ type: "request", config }), false);
  assert.equal(isRequestNode({ id: 1, key: "request", position: { x: 0, y: 0 }, type: "request", config }), false);
  assert.equal(isRequestNode({ id: "request", key: 1, position: { x: 0, y: 0 }, type: "request", config }), false);
  assert.equal(isRequestNode({ id: "request", key: "request", position: { x: "0", y: 0 }, type: "request", config }), false);
  assert.equal(isRequestNode({ id: "request", key: "request", position: { x: 0, y: null }, type: "request", config }), false);
  assert.equal(isRequestNode(node("request", { type: "request", config })), true);
});

test("validateFlow rejects an empty flow", () => {
  assert.deepEqual(validateFlow(emptyFlow("f", "Empty")), [
    { level: "error", message: "Flow has no nodes" },
  ]);
});

test("validateFlow reports malformed request config without throwing", () => {
  const malformed = node("bad", { type: "request", config: {} });
  const issues = validateFlow({
    version: 1,
    id: "f",
    name: "f",
    nodes: [malformed],
    edges: [],
  });

  assert.deepEqual(issues.find((issue) => issue.nodeId === "bad"), {
    level: "error",
    nodeId: "bad",
    message: 'Step "bad": Invalid request configuration',
  });
});

test("validateFlow rejects missing, non-finite, and negative delay durations", () => {
  const issues = validateFlow({
    version: 1,
    id: "f",
    name: "f",
    nodes: [
      node("missing", { config: {} }),
      node("infinite", { config: { ms: Infinity } }),
      node("negative", { config: { ms: -1 } }),
    ],
    edges: [],
  });
  const invalidDelayIssues = issues.filter((issue) => /Invalid delay configuration/.test(issue.message));

  assert.deepEqual(invalidDelayIssues.map((issue) => issue.level), ["error", "error", "error"]);
  assert.deepEqual(invalidDelayIssues.map((issue) => issue.nodeId), ["missing", "infinite", "negative"]);
});

test("topoOrder returns null for duplicate node ids", () => {
  assert.equal(topoOrder([node("a"), node("a", { key: "a-2" })], []), null);
});

test("validateFlow rejects duplicate node ids", () => {
  const issues = validateFlow({
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("a", { key: "a-2" })],
    edges: [],
  });
  const duplicate = issues.find((issue) => issue.message === 'Duplicate node id "a"');

  assert.equal(duplicate?.level, "error");
});

test("validateFlow rejects duplicate edge ids", () => {
  const issues = validateFlow({
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b"), node("c")],
    edges: [
      edge("a", "b", { id: "duplicate" }),
      edge("b", "c", { id: "duplicate" }),
    ],
  });
  const duplicate = issues.find((issue) => issue.message === 'Duplicate edge id "duplicate"');

  assert.equal(duplicate?.level, "error");
});

test("validateFlow rejects duplicate edge connections", () => {
  const issues = validateFlow({
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b")],
    edges: [
      edge("a", "b", { id: "one", sourceHandle: "success" }),
      edge("a", "b", { id: "two", sourceHandle: "success" }),
    ],
  });
  const duplicate = issues.find((issue) => issue.message.includes("Duplicate edge connection"));

  assert.equal(duplicate?.level, "error");
  assert.match(duplicate?.message ?? "", /"a" -> "b".*"success"/);
});

test("dangling edges are errors and do not connect nodes", () => {
  const issues = validateFlow({
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b")],
    edges: [
      edge("a", "missing", { id: "missing-target" }),
      edge("ghost", "b", { id: "missing-source" }),
    ],
  });
  const missingTarget = issues.find((issue) => issue.message.includes('Edge "missing-target"'));
  const missingSource = issues.find((issue) => issue.message.includes('Edge "missing-source"'));
  const disconnected = issues
    .filter((issue) => issue.level === "warn" && issue.message.includes("not connected"))
    .map((issue) => issue.nodeId);

  assert.equal(missingTarget?.level, "error");
  assert.match(missingTarget?.message ?? "", /missing target node "missing"/);
  assert.equal(missingSource?.level, "error");
  assert.match(missingSource?.message ?? "", /missing source node "ghost"/);
  assert.deepEqual(disconnected, ["a", "b"]);
});

test("isFlow accepts well-formed flows and rejects malformed shapes", async () => {
  const { isFlow } = await import("./types.ts");
  const good = {
    version: 1,
    id: "f",
    name: "Flow",
    nodes: [
      node("a"),
      node("t", { type: "transform", config: { code: "return {}" } }),
    ],
    edges: [edge("a", "t")],
  };
  assert.equal(isFlow(good), true);

  assert.equal(isFlow(null), false);
  assert.equal(isFlow({ id: "f" }), false); // no version/name/nodes/edges
  assert.equal(isFlow({ ...good, version: 2 }), false);
  assert.equal(isFlow({ ...good, nodes: "nope" }), false);
  assert.equal(isFlow({ ...good, nodes: [{ id: "x" }] }), false); // node missing key/position/type
  assert.equal(isFlow({ ...good, nodes: [node("z", { type: "banana" })] }), false);
  assert.equal(
    isFlow({ ...good, nodes: [node("t2", { type: "transform", config: {} })] }),
    false, // transform without code
  );
  assert.equal(isFlow({ ...good, edges: [{ id: "e" }] }), false);
});
