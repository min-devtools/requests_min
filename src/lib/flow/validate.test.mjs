import assert from "node:assert/strict";
import test from "node:test";
import { emptyFlow, isRequestNode } from "./types.ts";
import { dagEdges, loopBackEdgeMap, loopBodyNodes, stepKeyFor, topoOrder, validateFlow } from "./validate.ts";

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

  // the structural guard enforces the same loop bounds validateFlow does, so a hand-edited
  // flows/*.json can't smuggle in a runaway iteration count
  const loop = (count) => node("l", { type: "loop", config: { count } });
  assert.equal(isFlow({ ...good, nodes: [loop(100)] }), true);
  assert.equal(isFlow({ ...good, nodes: [loop(101)] }), false);
  assert.equal(isFlow({ ...good, nodes: [loop(1_000_000_000)] }), false);
  assert.equal(isFlow({ ...good, nodes: [loop(0)] }), false);

  // `enabled` is optional but must be a boolean when present
  assert.equal(isFlow({ ...good, nodes: [{ ...node("a"), enabled: false }] }), true);
  assert.equal(isFlow({ ...good, nodes: [{ ...node("a"), enabled: "yes" }] }), false);
});

const loopNode = (id, count = 2) => node(id, { type: "loop", config: { count } });
const messagesOf = (flow) => validateFlow(flow).map((issue) => issue.message).join(" | ");

test("validateFlow accepts a loop closing a circle back to an earlier step", () => {
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b"), loopNode("loop", 3), node("c")],
    edges: [edge("a", "b"), edge("b", "loop"), edge("loop", "a"), edge("loop", "c")],
  };
  const errors = validateFlow(flow).filter((issue) => issue.level === "error");
  assert.deepEqual(errors, []);
});

test("loopBackEdgeMap, dagEdges and loopBodyNodes agree on the wired circle", () => {
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b"), loopNode("loop", 3), node("c")],
    edges: [edge("a", "b"), edge("b", "loop"), edge("loop", "a"), edge("loop", "c")],
  };
  assert.deepEqual(loopBackEdgeMap(flow).get("loop"), [{ edgeId: "loop-a", targetId: "a" }]);
  assert.deepEqual(dagEdges(flow).map((e) => e.id).sort(), ["a-b", "b-loop", "loop-c"]);
  assert.deepEqual(loopBodyNodes(flow, "loop"), ["a", "b"]);
});

test("validateFlow requires exactly one loop-back connection", () => {
  const missing = {
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), loopNode("loop")],
    edges: [edge("a", "loop")],
  };
  assert.match(messagesOf(missing), /back to an earlier step/);

  const multiple = {
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b"), loopNode("loop")],
    edges: [edge("a", "loop"), edge("b", "loop"), edge("loop", "a"), edge("loop", "b")],
  };
  assert.match(messagesOf(multiple), /multiple loop-back/);
});

test("validateFlow rejects tangled nested loops and invalid counts", () => {
  // loop2 sits inside loop1's circle — that always closes a second circle for loop2
  const tangled = {
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), loopNode("loop1"), loopNode("loop2")],
    edges: [edge("a", "loop2"), edge("loop2", "loop1"), edge("loop1", "a"), edge("loop2", "a")],
  };
  const tangledMessages = messagesOf(tangled);
  assert.match(tangledMessages, /multiple loop-back/);
  assert.ok(validateFlow(tangled).some((issue) => issue.level === "error"));

  for (const count of [0, -2, 1.5, 101, NaN]) {
    const flow = {
      version: 1,
      id: "f",
      name: "f",
      nodes: [node("a"), loopNode("loop", count)],
      edges: [edge("a", "loop"), edge("loop", "a")],
    };
    assert.match(messagesOf(flow), /Invalid loop configuration/, `count ${count} must be rejected`);
  }
});

test("validateFlow still flags cycles that do not pass through a loop step", () => {
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), node("b")],
    edges: [edge("a", "b"), edge("b", "a")],
  };
  assert.match(messagesOf(flow), /cycle/);
});

test("edges between the same nodes via different target handles are not duplicates", () => {
  const issues = validateFlow({
    version: 1,
    id: "f",
    name: "f",
    nodes: [node("a"), loopNode("loop")],
    edges: [
      edge("a", "loop", { id: "one" }),
      edge("a", "loop", { id: "two", targetHandle: "in-right" }),
    ],
  });
  assert.equal(issues.find((issue) => issue.message.includes("Duplicate edge connection")), undefined);
});
