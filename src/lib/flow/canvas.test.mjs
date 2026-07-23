import assert from "node:assert/strict";
import test from "node:test";

import {
  autoLayoutNodes,
  commitNodePositions,
  createDelayFlowNode,
  createRequestFlowNode,
  parseRequestDropPayload,
  removeGraphElements,
} from "./canvas.ts";

const httpRequest = {
  name: "Create user",
  protocol: "http",
  http: {
    method: "POST",
    url: "{{baseUrl}}/users",
    headers: [],
    params: [],
    auth: { type: "none" },
    body: { type: "json", content: "{}" },
    insecure: false,
  },
};

test("parseRequestDropPayload accepts the sidebar request contract", () => {
  assert.deepEqual(
    parseRequestDropPayload(JSON.stringify({
      kind: "request",
      collectionId: "core",
      relPath: "users/create.json",
    })),
    { kind: "request", collectionId: "core", relPath: "users/create.json" },
  );
});

test("parseRequestDropPayload rejects malformed or incomplete payloads", () => {
  for (const raw of [
    "",
    "not json",
    JSON.stringify({ kind: "collection", id: "core" }),
    JSON.stringify({ kind: "request", collectionId: "", relPath: "one.json" }),
    JSON.stringify({ kind: "request", collectionId: "   ", relPath: "one.json" }),
    JSON.stringify({ kind: "request", collectionId: "core", relPath: "  " }),
    JSON.stringify({ kind: "request", collectionId: "core", relPath: 3 }),
  ]) {
    assert.throws(() => parseRequestDropPayload(raw), /request drop payload/i);
  }
});

test("createRequestFlowNode snapshots the request and records its origin", () => {
  const request = structuredClone(httpRequest);
  const node = createRequestFlowNode({
    id: "node-1",
    request,
    origin: { collectionId: "core", relPath: "users/create.json" },
    position: { x: 80, y: 120 },
    takenKeys: new Set(["create-user"]),
  });

  request.name = "Changed after drop";
  request.http.url = "/changed";

  assert.equal(node.key, "create-user-2");
  assert.equal(node.config.request.name, "Create user");
  assert.equal(node.config.request.http.url, "{{baseUrl}}/users");
  assert.deepEqual(node.config.origin, { collectionId: "core", relPath: "users/create.json" });
  assert.deepEqual(node.position, { x: 80, y: 120 });
});

test("createRequestFlowNode rejects WebSocket snapshots", () => {
  assert.throws(() => createRequestFlowNode({
    id: "node-ws",
    request: { name: "socket", protocol: "ws", ws: { url: "ws://localhost", headers: [], savedMessages: [] } },
    origin: { collectionId: "core", relPath: "socket.json" },
    position: { x: 0, y: 0 },
    takenKeys: new Set(),
  }), /WebSocket requests/i);
});

test("createDelayFlowNode uses collision-safe step keys", () => {
  assert.equal(createDelayFlowNode("delay-1", new Set(), { x: 10, y: 20 }).key, "delay");
  assert.equal(createDelayFlowNode("delay-2", new Set(["delay"]), { x: 10, y: 20 }).key, "delay-2");
});

test("removeGraphElements removes selected nodes and their dangling edges", () => {
  const delay = createDelayFlowNode("delay", new Set(), { x: 0, y: 0 });
  const request = createRequestFlowNode({
    id: "request",
    request: httpRequest,
    origin: { collectionId: "core", relPath: "users/create.json" },
    position: { x: 100, y: 0 },
    takenKeys: new Set([delay.key]),
  });
  const graph = removeGraphElements(
    [delay, request],
    [{ id: "edge", source: delay.id, target: request.id }],
    new Set([delay.id]),
    new Set(),
  );

  assert.deepEqual(graph.nodes.map((node) => node.id), [request.id]);
  assert.deepEqual(graph.edges, []);
});

test("commitNodePositions persists every node in a multi-selection drag", () => {
  const first = createDelayFlowNode("first", new Set(), { x: 0, y: 0 });
  const second = createDelayFlowNode("second", new Set([first.key]), { x: 50, y: 0 });
  const nodes = commitNodePositions([first, second], [
    { id: first.id, position: { x: 100, y: 120 } },
    { id: second.id, position: { x: 150, y: 120 } },
  ]);

  assert.deepEqual(nodes.map((node) => node.position), [
    { x: 100, y: 120 },
    { x: 150, y: 120 },
  ]);
  assert.deepEqual(first.position, { x: 0, y: 0 });
  assert.deepEqual(second.position, { x: 50, y: 0 });
});

test("autoLayoutNodes stacks parallel branches per depth column and skips cyclic graphs", () => {
  const node = (id, x = 0, y = 0) => ({ id, key: id, type: "delay", position: { x, y }, config: { ms: 1 } });
  const nodes = [node("a"), node("b"), node("c"), node("d")];
  const edges = [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "a", target: "c" },
    { id: "e3", source: "b", target: "d" },
    { id: "e4", source: "c", target: "d" },
  ];

  const laid = autoLayoutNodes(nodes, edges);
  const byId = Object.fromEntries(laid.map((n) => [n.id, n.position]));
  assert.deepEqual(byId.a, { x: 60, y: 60 });
  assert.deepEqual(byId.b, { x: 360, y: 60 });
  assert.deepEqual(byId.c, { x: 360, y: 210 });
  assert.deepEqual(byId.d, { x: 660, y: 60 });

  const cyclic = autoLayoutNodes(nodes, [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "a" }]);
  assert.deepEqual(cyclic.map((n) => n.position), nodes.map((n) => n.position));

  const stable = autoLayoutNodes(laid, edges);
  assert.deepEqual(stable, laid);
});
