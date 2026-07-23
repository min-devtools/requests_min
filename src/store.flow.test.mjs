import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const src = new URL("./", import.meta.url);
let storeInstance = 0;
let bundledStore;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
};

const flow = (id, name = `Flow ${id}`) => ({ version: 1, id, name, nodes: [], edges: [] });
const request = (name) => ({
  name,
  protocol: "http",
  http: { method: "GET", url: "", headers: [], params: [], auth: { type: "none" }, body: { type: "none" }, insecure: false },
});
const requestTab = (name) => ({
  collectionId: null,
  relPath: null,
  request: request(name),
  original: JSON.stringify(request(name)),
  dirty: false,
  response: null,
  running: false,
  error: null,
});
const flowTab = (value, patch = {}) => ({
  flowId: value.id,
  flow: value,
  original: JSON.stringify(value),
  dirty: false,
  run: null,
  running: false,
  selectedNodeId: null,
  panelNodeId: null,
  undoStack: [],
  redoStack: [],
  ...patch,
});

async function importStore({ session, invoke } = {}) {
  const values = new Map();
  if (session) values.set("requestsmin:session", JSON.stringify(session));
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  const window = {
    setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, callback) => listeners.set(type, callback),
  };
  const tauriInternals = {
    invoke: (command, args) => invoke?.(command, args) ?? Promise.resolve({}),
  };
  window.__TAURI_INTERNALS__ = tauriInternals;
  globalThis.localStorage = localStorage;
  globalThis.window = window;
  globalThis.document = { visibilityState: "visible" };
  globalThis.__TAURI_INTERNALS__ = tauriInternals;

  bundledStore ??= build({
    entryPoints: [new URL("store.ts", src).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  }).then((result) => result.outputFiles[0].text);
  const code = `${await bundledStore}\n// store instance ${++storeInstance}`;
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

  return {
    useApp: module.useApp,
    readSession: () => JSON.parse(values.get("requestsmin:session") ?? "null"),
    flushTimers: async () => {
      while (timers.size) {
        const callbacks = [...timers.values()];
        timers.clear();
        for (const callback of callbacks) await callback();
      }
    },
  };
}

test("session restore keeps flow instances, dedupes Saved Flows, drops orphans, and resets runtime", async () => {
  const flowAOriginal = flow("a", "Flow A");
  const flowAEdited = { ...flowAOriginal, nodes: [{ id: "delay", key: "delay", type: "delay", position: { x: 0, y: 0 }, config: { ms: 10 } }] };
  const flowB = flow("b", "Flow B");
  const { useApp } = await importStore({
    session: {
      tabs: [
        { id: "flow-a", kind: "flow", title: "Flow A", icon: "flow" },
        { id: "flows-one", kind: "flows", title: "Saved Flows", icon: "flow" },
        { id: "flow-b", kind: "flow", title: "Flow B", icon: "flow" },
        { id: "flows-two", kind: "flows", title: "Duplicate", icon: "flow" },
        { id: "flow-orphan", kind: "flow", title: "Orphan", icon: "flow" },
        { id: "flow-missing-id", kind: "flow", title: "Missing id", icon: "flow" },
      ],
      activeTabId: "flow-orphan",
      requestTabs: {},
      flowTabs: {
        "flow-a": { flowId: "a", flow: flowAEdited, original: JSON.stringify(flowAOriginal), dirty: false, run: { status: "success" }, running: true, selectedNodeId: "delay" },
        "flow-b": { flowId: "b", flow: flowB, original: JSON.stringify(flowB), dirty: true, run: { status: "failed" }, running: true, selectedNodeId: "gone" },
        "flow-missing-id": { flow: flow("missing"), original: "" },
      },
    },
  });

  const state = useApp.getState();
  assert.deepEqual(state.tabs.map((tab) => tab.id), ["flow-a", "flows-one", "flow-b"]);
  assert.equal(state.activeTabId, "flow-a");
  assert.deepEqual(Object.keys(state.flowTabs), ["flow-a", "flow-b"]);
  assert.equal(state.flowTabs["flow-a"].dirty, true);
  assert.equal(state.flowTabs["flow-b"].dirty, false);
  for (const restored of Object.values(state.flowTabs)) {
    assert.equal(restored.run, null);
    assert.equal(restored.running, false);
    assert.equal(restored.selectedNodeId, null);
  }
});

test("session save excludes flow request adapters and all flow runtime state", async () => {
  const { useApp, flushTimers, readSession } = await importStore();
  const savedFlow = flow("save", "Save flow");
  useApp.setState({
    tabs: [{ id: "flow-save", kind: "flow", title: savedFlow.name, icon: "flow" }],
    activeTabId: "flow-save",
    requestTabs: {
      "request-1": requestTab("Persist me"),
      "flowreq:flow-save:node-1": requestTab("Adapter"),
      "flowreq:another-flow:node-2": requestTab("Other adapter"),
    },
    flowTabs: {
      "flow-save": flowTab(savedFlow, {
        run: { startedAt: 1, status: "running", steps: {} },
        running: true,
        selectedNodeId: "node-1",
      }),
    },
  });
  await flushTimers();

  const session = readSession();
  assert.deepEqual(Object.keys(session.requestTabs), ["request-1"]);
  assert.deepEqual(session.flowTabs["flow-save"], {
    flowId: "save",
    flow: savedFlow,
    original: JSON.stringify(savedFlow),
  });
});

test("concurrent openFlowTab calls share one read and one activated tab for the same flow id", async () => {
  const opened = flow("login", "Login flow");
  const read = deferred();
  let reads = 0;
  const { useApp } = await importStore({
    invoke: async (command) => {
      if (command === "flow_read") { reads++; return read.promise; }
      return {};
    },
  });

  const firstOpen = useApp.getState().openFlowTab("login");
  const laterOpen = useApp.getState().openFlowTab("login");
  read.resolve(opened);
  await Promise.all([firstOpen, laterOpen]);

  const state = useApp.getState();
  assert.equal(reads, 1);
  assert.equal(state.tabs.filter((tab) => tab.kind === "flow").length, 1);
  assert.equal(Object.values(state.flowTabs).filter((tab) => tab.flowId === "login").length, 1);
  const flowTab = state.tabs.find((tab) => tab.kind === "flow");
  assert.equal(state.activeTabId, flowTab.id);
});

test("the latest requested flow stays active when different reads resolve out of order", async () => {
  const olderRead = deferred();
  const newerRead = deferred();
  const { useApp } = await importStore({
    invoke: async (command, args) => {
      if (command !== "flow_read") return {};
      return args.id === "older" ? olderRead.promise : newerRead.promise;
    },
  });

  const olderOpen = useApp.getState().openFlowTab("older");
  const newerOpen = useApp.getState().openFlowTab("newer");
  newerRead.resolve(flow("newer", "Newer flow"));
  await newerOpen;
  const newerTabId = useApp.getState().activeTabId;

  olderRead.resolve(flow("older", "Older flow"));
  await olderOpen;

  const state = useApp.getState();
  assert.equal(state.tabs.filter((tab) => tab.kind === "flow").length, 2);
  assert.equal(state.flowTabs[newerTabId].flowId, "newer");
  assert.equal(state.activeTabId, newerTabId);
});

test("a failed flow read does not poison a later retry", async () => {
  const opened = flow("retry", "Retry flow");
  let reads = 0;
  const { useApp } = await importStore({
    invoke: async (command) => {
      if (command !== "flow_read") return {};
      reads++;
      if (reads === 1) throw new Error("read failed");
      return opened;
    },
  });

  await assert.rejects(useApp.getState().openFlowTab("retry"), /read failed/);
  await useApp.getState().openFlowTab("retry");

  assert.equal(reads, 2);
  assert.equal(Object.values(useApp.getState().flowTabs).filter((tab) => tab.flowId === "retry").length, 1);
});

test("updateFlowTab recomputes dirty and only changes tabs when the title changes", async () => {
  const opened = flow("edit", "Edit flow");
  const { useApp } = await importStore({ invoke: async (command) => command === "flow_read" ? opened : {} });
  await useApp.getState().openFlowTab("edit");
  const tabId = useApp.getState().activeTabId;

  const initialTabs = useApp.getState().tabs;
  useApp.getState().updateFlowTab(tabId, { running: true, selectedNodeId: "n1", run: { startedAt: 1, status: "running", steps: {} } });
  assert.strictEqual(useApp.getState().tabs, initialTabs);
  assert.equal(useApp.getState().flowTabs[tabId].dirty, false);

  const contentEdit = { ...opened, nodes: [{ id: "n1", key: "wait", type: "delay", position: { x: 0, y: 0 }, config: { ms: 5 } }] };
  useApp.getState().updateFlowTab(tabId, { flow: contentEdit });
  assert.strictEqual(useApp.getState().tabs, initialTabs);
  assert.equal(useApp.getState().flowTabs[tabId].dirty, true);

  useApp.getState().updateFlowTab(tabId, { flow: { ...contentEdit, name: "Renamed flow" } });
  assert.notStrictEqual(useApp.getState().tabs, initialTabs);
  assert.equal(useApp.getState().tabs.find((tab) => tab.id === tabId).title, "Renamed flow");
});

test("flow request adapters clone their seed and write request edits through synchronously", async () => {
  const { useApp } = await importStore();
  const originalRequest = request("Snapshot");
  originalRequest.http.url = "https://old.example";
  const requestNode = {
    id: "request-node",
    key: "snapshot",
    type: "request",
    position: { x: 0, y: 0 },
    config: { request: originalRequest },
  };
  const opened = { ...flow("adapter"), nodes: [requestNode] };
  useApp.setState({
    tabs: [{ id: "flow-adapter", kind: "flow", title: opened.name, icon: "flow" }],
    activeTabId: "flow-adapter",
    requestTabs: {},
    flowTabs: { "flow-adapter": flowTab(opened) },
  });

  const editorId = "flowreq:flow-adapter:request-node";
  useApp.getState().ensureFlowNodeEditor(editorId, originalRequest);
  const seeded = useApp.getState().requestTabs[editorId];
  assert.deepEqual(seeded.request, originalRequest);
  assert.notStrictEqual(seeded.request, originalRequest);

  const edited = structuredClone(seeded.request);
  edited.http.url = "https://new.example";
  useApp.getState().updateRequestTab(editorId, { request: edited });

  const state = useApp.getState();
  assert.equal(state.requestTabs[editorId].request.http.url, "https://new.example");
  assert.equal(state.flowTabs["flow-adapter"].flow.nodes[0].config.request.http.url, "https://new.example");
  assert.equal(state.flowTabs["flow-adapter"].dirty, true);
});

test("removing flow nodes cleans only their request editor adapters", async () => {
  const { useApp } = await importStore();
  const first = { id: "first", key: "first", type: "request", position: { x: 0, y: 0 }, config: { request: request("First") } };
  const second = { id: "second", key: "second", type: "request", position: { x: 10, y: 10 }, config: { request: request("Second") } };
  const opened = { ...flow("cleanup"), nodes: [first, second] };
  useApp.setState({
    tabs: [{ id: "flow-cleanup", kind: "flow", title: opened.name, icon: "flow" }],
    activeTabId: "flow-cleanup",
    requestTabs: {
      "flowreq:flow-cleanup:first": requestTab("First"),
      "flowreq:flow-cleanup:second": requestTab("Second"),
      "flowreq:another-flow:first": requestTab("Other flow"),
      "request-1": requestTab("Regular"),
    },
    flowTabs: { "flow-cleanup": flowTab(opened) },
  });

  useApp.getState().updateFlowTab("flow-cleanup", { flow: { ...opened, nodes: [second] } });

  assert.deepEqual(Object.keys(useApp.getState().requestTabs).sort(), [
    "flowreq:another-flow:first",
    "flowreq:flow-cleanup:second",
    "request-1",
  ]);
});

test("flow undo/redo restores graph snapshots and blocks while running", async () => {
  const { useApp } = await importStore();
  const a = { id: "a", key: "a", type: "request", position: { x: 0, y: 0 }, config: { request: request("A") } };
  const b = { id: "b", key: "b", type: "request", position: { x: 10, y: 10 }, config: { request: request("B") } };
  const both = { ...flow("hist"), nodes: [a, b] };
  useApp.setState({
    tabs: [{ id: "flow-hist", kind: "flow", title: both.name, icon: "flow" }],
    activeTabId: "flow-hist",
    requestTabs: {},
    flowTabs: { "flow-hist": flowTab(both) },
  });
  const nodeIds = () => useApp.getState().flowTabs["flow-hist"].flow.nodes.map((n) => n.id);

  // delete node b, then undo it back, then redo the delete
  useApp.getState().updateFlowTab("flow-hist", { flow: { ...both, nodes: [a] } });
  assert.deepEqual(nodeIds(), ["a"]);

  useApp.getState().undoFlow("flow-hist");
  assert.deepEqual(nodeIds(), ["a", "b"]);

  useApp.getState().redoFlow("flow-hist");
  assert.deepEqual(nodeIds(), ["a"]);

  // a new edit clears the redo branch
  useApp.getState().undoFlow("flow-hist");
  useApp.getState().updateFlowTab("flow-hist", { flow: { ...both, nodes: [b] } });
  assert.equal(useApp.getState().flowTabs["flow-hist"].redoStack.length, 0);

  // running flows ignore undo
  useApp.getState().updateFlowTab("flow-hist", { running: true });
  const before = nodeIds();
  useApp.getState().undoFlow("flow-hist");
  assert.deepEqual(nodeIds(), before);
});

test("closing a flow removes only its owned adapters and flow state", async () => {
  const { useApp } = await importStore();
  const one = flow("one");
  const ten = flow("ten");
  useApp.setState({
    tabs: [
      { id: "flow-1", kind: "flow", title: one.name, icon: "flow" },
      { id: "flow-10", kind: "flow", title: ten.name, icon: "flow" },
    ],
    activeTabId: "flow-1",
    requestTabs: {
      "flowreq:flow-1:node-a": requestTab("Owned A"),
      "flowreq:flow-1:node-b": requestTab("Owned B"),
      "flowreq:flow-10:node-a": requestTab("Another flow"),
      "request-1": requestTab("Regular"),
    },
    flowTabs: { "flow-1": flowTab(one), "flow-10": flowTab(ten) },
  });

  useApp.getState().closeTab("flow-1");
  const state = useApp.getState();
  assert.deepEqual(Object.keys(state.flowTabs), ["flow-10"]);
  assert.deepEqual(Object.keys(state.requestTabs).sort(), ["flowreq:flow-10:node-a", "request-1"]);
});

test("flow rename updates dirty state and dirty close uses the flow name", async () => {
  const { useApp } = await importStore();
  const original = flow("rename", "Original flow");
  useApp.setState({
    tabs: [{ id: "flow-rename", kind: "flow", title: original.name, icon: "flow" }],
    activeTabId: "flow-rename",
    requestTabs: {},
    flowTabs: { "flow-rename": flowTab(original) },
  });

  useApp.getState().renameTab("flow-rename", "Renamed flow");
  assert.equal(useApp.getState().flowTabs["flow-rename"].flow.name, "Renamed flow");
  assert.equal(useApp.getState().flowTabs["flow-rename"].dirty, true);
  assert.equal(useApp.getState().tabs[0].title, "Renamed flow");

  let prompt;
  useApp.setState({ openConfirm: async (request) => { prompt = request; return false; } });
  await useApp.getState().confirmCloseTab("flow-rename");
  assert.match(prompt.message, /"Renamed flow" has unsaved changes/);
  assert.ok(useApp.getState().flowTabs["flow-rename"]);
});

test("flow tab metadata, navigation, tabs UI, and view roots follow the active-view contract", async () => {
  const read = async (path) => readFile(new URL(path, src), "utf8").catch(() => "");
  const [store, sidebar, icon, tabs, app, flowsView, flowView] = await Promise.all([
    read("store.ts"),
    read("components/Sidebar.tsx"),
    read("ui/Icon.tsx"),
    read("components/TabsBar.tsx"),
    read("App.tsx"),
    read("components/views/FlowsView.tsx"),
    read("components/views/FlowView.tsx"),
  ]);

  assert.match(store, /export type TabKind = [^;]*"flow"[^;]*"flows"/);
  assert.match(store, /Record<Exclude<TabKind, "request" \| "flow">/);
  assert.match(store, /flows: \{ title: "Flows", icon: "flow" \}/);
  assert.match(sidebar, /Exclude<TabKind, "request" \| "flow">/);
  assert.match(sidebar, /kind: "collections"[\s\S]*kind: "flows", icon: "flow", label: "Flows"[\s\S]*kind: "environments"/);
  assert.match(icon, /Workflow/);
  assert.match(icon, /flow: Workflow/);
  assert.match(tabs, /flowTabs: s\.flowTabs/);
  assert.match(tabs, /const dirty = rt\?\.dirty \?\? ft\?\.dirty \?\? false/);
  assert.match(tabs, /tab\.kind === "request" \|\| tab\.kind === "flow"/);
  assert.match(app, /case "flows": return <FlowsView key=\{tab\.id\} active=\{active\} \/>/);
  assert.match(app, /case "flow": return <FlowView key=\{tab\.id\} tabId=\{tab\.id\} active=\{active\} \/>/);
  assert.match(flowsView, /className=\{`content utility-view \$\{active \? "active" : ""\}`\}/);
  assert.match(flowView, /className=\{`content flow-view \$\{active \? "active" : ""\}`\}/);
});
