import assert from "node:assert/strict";
import test from "node:test";

import {
  autoLayoutNodes,
  nextSelection,
  commitNodePositions,
  copyGraphElements,
  createDelayFlowNode,
  createLoopFlowNode,
  createRequestFlowNode,
  parseRequestDropPayload,
  pasteGraphElements,
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

test("copyGraphElements clones selected nodes and their internal edges only", () => {
  const a = createDelayFlowNode("a", new Set(), { x: 0, y: 0 });
  const b = createDelayFlowNode("b", new Set([a.key]), { x: 100, y: 0 });
  const c = createDelayFlowNode("c", new Set([a.key, b.key]), { x: 200, y: 0 });
  const edges = [
    { id: "e-ab", source: "a", target: "b" },
    { id: "e-bc", source: "b", target: "c" },
  ];
  const clipboard = copyGraphElements([a, b, c], edges, new Set(["a", "b"]));

  assert.ok(clipboard);
  assert.deepEqual(clipboard.nodes.map((node) => node.id), ["a", "b"]);
  // e-bc stays out: c is not part of the selection
  assert.deepEqual(clipboard.edges.map((edge) => edge.id), ["e-ab"]);

  // deep clone: mutating the graph afterwards must not leak into the clipboard
  a.config.ms = 9999;
  a.position.x = -50;
  edges[0].id = "mutated";
  assert.equal(clipboard.nodes[0].config.ms, 1000);
  assert.equal(clipboard.nodes[0].position.x, 0);
  assert.equal(clipboard.edges[0].id, "e-ab");
});

test("copyGraphElements returns null when nothing usable is selected", () => {
  const a = createDelayFlowNode("a", new Set(), { x: 0, y: 0 });
  assert.equal(copyGraphElements([a], [], new Set()), null);
  assert.equal(copyGraphElements([a], [], new Set(["missing"])), null);
});

test("pasteGraphElements re-ids nodes and edges, re-keys collisions, and offsets positions", () => {
  const request = createRequestFlowNode({
    id: "n-old",
    request: httpRequest,
    origin: { collectionId: "core", relPath: "users/create.json" },
    position: { x: 10, y: 20 },
    takenKeys: new Set(),
  });
  const delay = createDelayFlowNode("n-delay", new Set([request.key]), { x: 300, y: 20 });
  const clipboard = {
    nodes: [request, delay],
    edges: [{ id: "e-old", source: "n-old", target: "n-delay" }],
  };
  let counter = 0;
  const makeId = (prefix) => `${prefix}-new-${++counter}`;
  const pasted = pasteGraphElements(clipboard, new Set(["create-user", "delay"]), makeId, { x: 40, y: 40 });

  assert.deepEqual(pasted.nodes.map((node) => node.id), ["n-new-1", "n-new-2"]);
  assert.deepEqual(pasted.nodes.map((node) => node.key), ["create-user-2", "delay-2"]);
  assert.deepEqual(pasted.nodes[0].position, { x: 50, y: 60 });
  assert.deepEqual(pasted.nodes[1].position, { x: 340, y: 60 });
  assert.deepEqual(pasted.edges, [{ id: "e-new-3", source: "n-new-1", target: "n-new-2" }]);

  // the source nodes stay untouched and the pasted config is an independent copy
  assert.equal(request.id, "n-old");
  pasted.nodes[0].config.request.http.url = "/changed";
  assert.equal(request.config.request.http.url, "{{baseUrl}}/users");
});

test("pasteGraphElements can paste the same clipboard twice without key collisions", () => {
  const delay = createDelayFlowNode("d", new Set(), { x: 0, y: 0 });
  const clipboard = { nodes: [delay], edges: [] };
  let counter = 0;
  const makeId = (prefix) => `${prefix}-${++counter}`;
  const first = pasteGraphElements(clipboard, new Set([delay.key]), makeId, { x: 40, y: 40 });
  const second = pasteGraphElements(clipboard, new Set([delay.key, first.nodes[0].key]), makeId, { x: 80, y: 80 });
  assert.equal(first.nodes[0].key, "delay-2");
  assert.equal(second.nodes[0].key, "delay-3");
  assert.notEqual(first.nodes[0].id, second.nodes[0].id);
});

test("createLoopFlowNode uses collision-safe step keys and defaults to 3 passes", () => {
  const first = createLoopFlowNode("loop-1", new Set(), { x: 5, y: 6 });
  assert.equal(first.key, "loop");
  assert.equal(first.type, "loop");
  assert.equal(first.config.count, 3);
  assert.deepEqual(first.position, { x: 5, y: 6 });
  assert.equal(createLoopFlowNode("loop-2", new Set(["loop"]), { x: 0, y: 0 }).key, "loop-2");
});

test("autoLayoutNodes arranges flows containing a loop instead of bailing on the circle", () => {
  const a = createDelayFlowNode("a", new Set(), { x: 500, y: 400 });
  const b = createDelayFlowNode("b", new Set([a.key]), { x: 500, y: 400 });
  const loop = createLoopFlowNode("loop", new Set([a.key, b.key]), { x: 500, y: 400 });
  const c = createDelayFlowNode("c", new Set([a.key, b.key, loop.key]), { x: 500, y: 400 });
  const edges = [
    { id: "a-b", source: "a", target: "b" },
    { id: "b-loop", source: "b", target: "loop" },
    { id: "loop-a", source: "loop", target: "a" }, // the circle-closing back-edge
    { id: "loop-c", source: "loop", target: "c" }, // exit edge after the loop
  ];

  const laid = autoLayoutNodes([a, b, loop, c], edges);
  const byId = Object.fromEntries(laid.map((n) => [n.id, n.position]));
  assert.deepEqual(byId.a, { x: 60, y: 60 });
  assert.deepEqual(byId.b, { x: 360, y: 60 });
  // the loop drops one row below the chain so its back-edge routes under the blocks
  assert.deepEqual(byId.loop, { x: 660, y: 210 });
  // exit steps stay on the chain row in the next column
  assert.deepEqual(byId.c, { x: 960, y: 60 });

  // a plain cycle (no loop step) still refuses to lay out
  const cyclic = autoLayoutNodes([a, b], [
    { id: "x", source: "a", target: "b" },
    { id: "y", source: "b", target: "a" },
  ]);
  assert.deepEqual(cyclic.map((n) => n.position), [a.position, b.position]);
});

test("nextSelection appends new picks in recency order and drops deselects/removes", () => {
  assert.deepEqual(nextSelection([], [{ type: "select", id: "a", selected: true }]), ["a"]);
  assert.deepEqual(
    nextSelection(["a"], [{ type: "select", id: "b", selected: true }, { type: "select", id: "c", selected: true }]),
    ["a", "b", "c"],
  );
  assert.deepEqual(nextSelection(["a", "b"], [{ type: "select", id: "a", selected: false }]), ["b"]);
  assert.deepEqual(nextSelection(["a", "b"], [{ type: "remove", id: "b" }]), ["a"]);
});

test("nextSelection returns the same reference when nothing changed", () => {
  const current = ["a", "b"];
  assert.equal(nextSelection(current, [{ type: "position", id: "a" }]), current);
  assert.equal(nextSelection(current, [{ type: "select", id: "a", selected: true }]), current);
  assert.equal(nextSelection(current, [{ type: "remove", id: "zz" }]), current);
});
