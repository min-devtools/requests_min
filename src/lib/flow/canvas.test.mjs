import assert from "node:assert/strict";
import test from "node:test";

import {
  layoutGraph,
  nextSelection,
  alignNodes,
  distributeNodes,
  duplicateGraphElements,
  DEFAULT_NODE_SIZE,
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

const uniformSizes = (nodes, width = 200, height = 80) => new Map(nodes.map((node) => [node.id, { width, height }]));

test("layoutGraph LR advances ranks left→right and TB top→bottom", () => {
  const node = (id) => ({ id, key: id, type: "delay", position: { x: 0, y: 0 }, config: { ms: 1 } });
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "c" },
  ];
  const lr = layoutGraph(nodes, edges, "LR", uniformSizes(nodes));
  assert.ok(lr[0].position.x < lr[1].position.x);
  assert.ok(lr[1].position.x < lr[2].position.x);
  assert.equal(lr[0].position.y, lr[1].position.y); // a straight chain stays on one lane
  const tb = layoutGraph(nodes, edges, "TB", uniformSizes(nodes));
  assert.ok(tb[0].position.y < tb[1].position.y);
  assert.ok(tb[1].position.y < tb[2].position.y);
  assert.equal(tb[0].position.x, tb[1].position.x);
});

test("layoutGraph siblings share a rank instead of stacking arbitrarily", () => {
  const node = (id) => ({ id, key: id, type: "delay", position: { x: 0, y: 0 }, config: { ms: 1 } });
  const nodes = [node("root"), node("s1"), node("s2")];
  const edges = [
    { id: "e1", source: "root", target: "s1" },
    { id: "e2", source: "root", target: "s2" },
  ];
  const lr = layoutGraph(nodes, edges, "LR", uniformSizes(nodes));
  assert.equal(lr[1].position.x, lr[2].position.x); // same rank
  assert.notEqual(lr[1].position.y, lr[2].position.y); // separated within it
});

test("layoutGraph keeps the unchanged-input contract", () => {
  const node = (id) => ({ id, key: id, type: "delay", position: { x: 0, y: 0 }, config: { ms: 1 } });
  const nodes = [node("a")];
  const once = layoutGraph(nodes, [], "LR", uniformSizes(nodes));
  const twice = layoutGraph(once, [], "LR", uniformSizes(nodes));
  assert.deepEqual(once, twice); // idempotent
  assert.deepEqual(layoutGraph([], [], "LR", new Map()), []); // empty graph returns []
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

test("layoutGraph pushes looped-back loop blocks off the chain lane", () => {
  const a = createDelayFlowNode("a", new Set(), { x: 500, y: 400 });
  const b = createDelayFlowNode("b", new Set([a.key]), { x: 500, y: 400 });
  const loop = createLoopFlowNode("loop", new Set([a.key, b.key]), { x: 500, y: 400 });
  const nodes = [a, b, loop];
  const edges = [
    { id: "a-b", source: "a", target: "b" },
    { id: "b-loop", source: "b", target: "loop" },
    { id: "loop-a", source: "loop", target: "a" }, // the circle-closing back-edge
  ];

  const lr = layoutGraph(nodes, edges, "LR", uniformSizes(nodes));
  const chainBottom = Math.max(lr[0].position.y, lr[1].position.y) + 80;
  assert.ok(lr[2].position.y >= chainBottom); // LR: loop drops below the chain
  const tb = layoutGraph(nodes, edges, "TB", uniformSizes(nodes));
  const chainRight = Math.max(tb[0].position.x, tb[1].position.x) + 200;
  assert.ok(tb[2].position.x >= chainRight); // TB: loop swings right of the chain
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

const bareNode = (id, x, y) => ({ id, key: id, type: "delay", position: { x, y }, config: { ms: 1 } });
const sizesOf = (entries) => new Map(entries);

test("alignNodes equalizes centers on one axis and leaves outsiders alone", () => {
  const nodes = [bareNode("a", 0, 0), bareNode("b", 300, 100), bareNode("c", 600, 999)];
  const sizes = sizesOf([["a", { width: 100, height: 40 }], ["b", { width: 100, height: 60 }]]);
  const aligned = alignNodes(nodes, new Set(["a", "b"]), "y", sizes);
  // centers: a=20, b=130 → target 75 → a.y=55, b.y=45
  assert.equal(aligned[0].position.y, 55);
  assert.equal(aligned[1].position.y, 45);
  assert.equal(aligned[0].position.x, 0);
  assert.equal(aligned[2], nodes[2]); // untouched node keeps identity
});

test("alignNodes needs two picked nodes and falls back to DEFAULT_NODE_SIZE", () => {
  const nodes = [bareNode("a", 0, 0), bareNode("b", 0, 100)];
  assert.deepEqual(alignNodes(nodes, new Set(["a"]), "y", new Map()), nodes);
  assert.ok(DEFAULT_NODE_SIZE.width > 0 && DEFAULT_NODE_SIZE.height > 0);
  const aligned = alignNodes(nodes, new Set(["a", "b"]), "x", new Map());
  assert.equal(aligned[0].position.x, aligned[1].position.x); // same column via default size
});

test("distributeNodes equalizes gaps between the outermost centers", () => {
  const nodes = [bareNode("a", 0, 0), bareNode("b", 40, 0), bareNode("c", 400, 0)];
  const sizes = sizesOf([["a", { width: 100, height: 40 }], ["b", { width: 100, height: 40 }], ["c", { width: 100, height: 40 }]]);
  const spread = distributeNodes(nodes, new Set(["a", "b", "c"]), "x", sizes);
  // centers: 50, 90, 450 → first/last fixed, middle center → 250 → b.x = 200
  assert.equal(spread[0].position.x, 0);
  assert.equal(spread[1].position.x, 200);
  assert.equal(spread[2].position.x, 400);
  assert.deepEqual(distributeNodes(nodes, new Set(["a", "b"]), "x", sizes), nodes); // <3 picked = no-op copy
});

test("duplicateGraphElements clones picked nodes with fresh ids/keys and internal edges", () => {
  const nodes = [bareNode("a", 0, 0), bareNode("b", 100, 0), bareNode("c", 200, 0)];
  const edges = [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "c" },
  ];
  let n = 0;
  const dup = duplicateGraphElements(nodes, edges, new Set(["a", "b"]), (prefix) => `${prefix}-dup-${++n}`, { x: 40, y: 40 });
  assert.equal(dup.nodes.length, 2);
  assert.equal(dup.edges.length, 1); // only the a→b edge is internal
  assert.notEqual(dup.nodes[0].id, "a");
  assert.notEqual(dup.nodes[0].key, "a"); // collision-safe re-key
  assert.equal(dup.nodes[0].position.x, 40);
  assert.equal(dup.edges[0].source, dup.nodes[0].id);
  assert.equal(dup.edges[0].target, dup.nodes[1].id);
  assert.equal(duplicateGraphElements(nodes, edges, new Set(), () => "x", { x: 0, y: 0 }), null);
});
