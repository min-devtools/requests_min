import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const src = new URL("./", import.meta.url);
let actionsInstance = 0;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
};

const flow = (id, name = `Flow ${id}`, nodes = []) => ({ version: 1, id, name, nodes, edges: [] });
const flowTab = (value, original = JSON.stringify(value)) => ({
  flowId: value.id,
  flow: value,
  original,
  dirty: JSON.stringify(value) !== original,
  run: null,
  running: false,
  selectedNodeId: null,
});

async function importActions() {
  let output;
  try {
    const result = await build({
      entryPoints: [new URL("flowActions.ts", src).pathname],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      logLevel: "silent",
      plugins: [{
        name: "flow-actions-test-deps",
        setup(builder) {
          builder.onResolve({ filter: /^@tauri-apps\/plugin-dialog$/ }, () => ({ path: "dialog", namespace: "test-stub" }));
          builder.onResolve({ filter: /^\.\.\/api$/ }, () => ({ path: "api", namespace: "test-stub" }));
          builder.onResolve({ filter: /^\.\.\/\.\.\/store$/ }, () => ({ path: "store", namespace: "test-stub" }));
          builder.onLoad({ filter: /.*/, namespace: "test-stub" }, ({ path }) => {
            if (path === "dialog") return { contents: "export const save = async () => null;" };
            if (path === "api") return { contents: "export const api = {};" };
            return { contents: "export const useApp = { getState() { return {}; } };" };
          });
        },
      }],
    });
    output = result.outputFiles[0].text;
  } catch (error) {
    assert.fail(`flowActions.ts must compile: ${String(error)}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(`${output}\n// instance ${++actionsInstance}`).toString("base64")}`);
}

function createHarness(overrides = {}) {
  const writes = [];
  const closes = [];
  const toasts = [];
  const opened = [];
  const state = {
    tabs: [],
    activeTabId: "welcome",
    flowTabs: {},
    openFlowTab: async (id) => { opened.push(id); },
    updateFlowTab: (tabId, patch) => {
      const current = state.flowTabs[tabId];
      if (!current) return;
      const next = { ...current, ...patch };
      next.dirty = JSON.stringify(next.flow) !== next.original;
      state.flowTabs[tabId] = next;
      state.tabs = state.tabs.map((tab) => tab.id === tabId ? { ...tab, title: next.flow.name } : tab);
    },
    closeTab: (tabId) => {
      closes.push(tabId);
      state.tabs = state.tabs.filter((tab) => tab.id !== tabId);
      delete state.flowTabs[tabId];
    },
    showToast: (...toast) => { toasts.push(toast); },
  };
  const backend = {
    flowRead: async (id) => flow(id),
    flowWrite: async (id, value) => { writes.push([id, value]); },
    flowDelete: async () => {},
    flowExport: async () => {},
    ...overrides.backend,
  };
  return { state, backend, writes, closes, toasts, opened };
}

test("newFlowId stays backend-safe and unique when clock and randomness repeat", async () => {
  const { newFlowId } = await importActions();
  const realNow = Date.now;
  const realRandom = Math.random;
  Date.now = () => 0;
  Math.random = () => 0;
  try {
    const first = newFlowId();
    const second = newFlowId();
    assert.match(first, /^flow-[a-z0-9]+(?:-[a-z0-9]+)+$/);
    assert.notEqual(first, second);
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
});

test("createFlow writes an empty named flow before opening it", async () => {
  const { createFlowActions } = await importActions();
  const harness = createHarness();
  const actions = createFlowActions({
    backend: harness.backend,
    getState: () => harness.state,
    saveDialog: async () => null,
    makeId: () => "flow-created",
  });

  await actions.createFlow("  Signup  ");

  assert.deepEqual(harness.writes, [["flow-created", flow("flow-created", "Signup")]]);
  assert.deepEqual(harness.opened, ["flow-created"]);
});

test("saveActiveFlow commits the written snapshot while edits made during the write stay dirty", async () => {
  const { createFlowActions } = await importActions();
  const write = deferred();
  let written;
  const harness = createHarness({
    backend: { flowWrite: async (_id, value) => { written = value; return write.promise; } },
  });
  const original = flow("race", "Race", [{ id: "first", config: { ms: 10 } }]);
  harness.state.tabs = [{ id: "tab-race", kind: "flow", title: "Race", icon: "flow" }];
  harness.state.activeTabId = "tab-race";
  harness.state.flowTabs["tab-race"] = flowTab(original);
  const actions = createFlowActions({ backend: harness.backend, getState: () => harness.state, saveDialog: async () => null, makeId: () => "unused" });

  const saving = actions.saveActiveFlow();
  harness.state.flowTabs["tab-race"].flow = flow("race", "Race edited", [{ id: "first", config: { ms: 99 } }]);
  write.resolve();
  await saving;

  assert.deepEqual(written, original);
  assert.notEqual(written, original);
  assert.equal(harness.state.flowTabs["tab-race"].flow.name, "Race edited");
  assert.equal(harness.state.flowTabs["tab-race"].original, JSON.stringify(original));
  assert.equal(harness.state.flowTabs["tab-race"].dirty, true);
  assert.deepEqual(harness.toasts, [["Saved", "Race written to disk."]]);
});

test("saveActiveFlow is a no-op outside an active flow tab", async () => {
  const { createFlowActions } = await importActions();
  const harness = createHarness();
  const actions = createFlowActions({ backend: harness.backend, getState: () => harness.state, saveDialog: async () => null, makeId: () => "unused" });

  await actions.saveActiveFlow();

  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.toasts, []);
});

test("renameFlow preserves in-flight tab edits and safely advances every current baseline name", async () => {
  const { createFlowActions } = await importActions();
  const disk = flow("rename", "Old disk", [{ id: "disk", config: { ms: 1 } }]);
  const write = deferred();
  let written;
  const harness = createHarness({
    backend: {
      flowRead: async () => structuredClone(disk),
      flowWrite: async (_id, value) => { written = value; return write.promise; },
    },
  });
  const baseline = flow("rename", "Old baseline", [{ id: "baseline", config: { ms: 2 } }]);
  const firstEdit = flow("rename", "Old baseline", [{ id: "edited-first", config: { ms: 3 } }]);
  harness.state.tabs = [{ id: "first", kind: "flow", title: "Old baseline", icon: "flow" }];
  harness.state.flowTabs.first = flowTab(firstEdit, JSON.stringify(baseline));
  const actions = createFlowActions({ backend: harness.backend, getState: () => harness.state, saveDialog: async () => null, makeId: () => "unused" });

  const renaming = actions.renameFlow("rename", "Renamed");
  await Promise.resolve();
  const latestFirstEdit = flow("rename", "Typing", [{ id: "edited-latest", config: { ms: 4 } }]);
  const secondEdit = flow("rename", "Second edit", [{ id: "second", config: { ms: 5 } }]);
  harness.state.flowTabs.first.flow = latestFirstEdit;
  harness.state.tabs.push({ id: "second", kind: "flow", title: "Second edit", icon: "flow" });
  harness.state.flowTabs.second = flowTab(secondEdit, "not-json");
  write.resolve();
  await renaming;

  assert.deepEqual(written, { ...disk, name: "Renamed" });
  assert.deepEqual(harness.state.flowTabs.first.flow.nodes, latestFirstEdit.nodes);
  assert.equal(harness.state.flowTabs.first.flow.name, "Renamed");
  assert.deepEqual(JSON.parse(harness.state.flowTabs.first.original), { ...baseline, name: "Renamed" });
  assert.equal(harness.state.flowTabs.first.dirty, true);
  assert.deepEqual(harness.state.flowTabs.second.flow.nodes, secondEdit.nodes);
  assert.equal(harness.state.flowTabs.second.flow.name, "Renamed");
  assert.deepEqual(JSON.parse(harness.state.flowTabs.second.original), { ...disk, name: "Renamed" });
  assert.equal(harness.state.flowTabs.second.dirty, true);
});

test("renameFlow falls back to disk when a parsed baseline has the wrong id or version", async () => {
  const { createFlowActions } = await importActions();
  const disk = flow("rename", "Disk", [{ id: "disk", config: { ms: 1 } }]);
  const harness = createHarness({ backend: { flowRead: async () => structuredClone(disk) } });
  const edited = flow("rename", "Edited", [{ id: "edited", config: { ms: 2 } }]);
  harness.state.tabs = [
    { id: "wrong-id", kind: "flow", title: "Edited", icon: "flow" },
    { id: "wrong-version", kind: "flow", title: "Edited", icon: "flow" },
  ];
  harness.state.flowTabs["wrong-id"] = flowTab(edited, JSON.stringify({ ...disk, id: "other" }));
  harness.state.flowTabs["wrong-version"] = flowTab(edited, JSON.stringify({ ...disk, version: 2 }));
  const actions = createFlowActions({ backend: harness.backend, getState: () => harness.state, saveDialog: async () => null, makeId: () => "unused" });

  await actions.renameFlow("rename", "Renamed");

  const expected = { ...disk, name: "Renamed" };
  assert.deepEqual(JSON.parse(harness.state.flowTabs["wrong-id"].original), expected);
  assert.deepEqual(JSON.parse(harness.state.flowTabs["wrong-version"].original), expected);
  assert.equal(harness.state.flowTabs["wrong-id"].dirty, true);
  assert.equal(harness.state.flowTabs["wrong-version"].dirty, true);
});

test("duplicateFlow deep-clones the disk flow with a new id and copy name", async () => {
  const { createFlowActions } = await importActions();
  const disk = flow("source", "Checkout", [{ id: "request", config: { request: { headers: [{ key: "x", value: "1" }] } } }]);
  let written;
  const harness = createHarness({
    backend: {
      flowRead: async () => disk,
      flowWrite: async (_id, value) => { written = value; },
    },
  });
  const actions = createFlowActions({ backend: harness.backend, getState: () => harness.state, saveDialog: async () => null, makeId: () => "copy-id" });

  await actions.duplicateFlow("source");

  assert.deepEqual(written, { ...disk, id: "copy-id", name: "Checkout copy" });
  assert.notEqual(written, disk);
  assert.notEqual(written.nodes, disk.nodes);
  assert.notEqual(written.nodes[0].config, disk.nodes[0].config);
});

test("deleteFlow keeps matching tabs open when backend deletion fails", async () => {
  const { createFlowActions } = await importActions();
  const harness = createHarness({ backend: { flowDelete: async () => { throw new Error("disk busy"); } } });
  harness.state.tabs = [{ id: "flow-tab", kind: "flow", title: "Delete", icon: "flow" }];
  harness.state.flowTabs["flow-tab"] = flowTab(flow("delete", "Delete"));
  const actions = createFlowActions({ backend: harness.backend, getState: () => harness.state, saveDialog: async () => null, makeId: () => "unused" });

  await assert.rejects(actions.deleteFlow("delete"), /disk busy/);

  assert.deepEqual(harness.closes, []);
  assert.equal(harness.state.tabs.length, 1);
});

test("deleteFlow closes all current matching tabs only after backend deletion succeeds", async () => {
  const { createFlowActions } = await importActions();
  const deletion = deferred();
  const harness = createHarness({ backend: { flowDelete: async () => deletion.promise } });
  harness.state.tabs = [
    { id: "flow-one", kind: "flow", title: "Delete", icon: "flow" },
    { id: "flow-two", kind: "flow", title: "Delete duplicate", icon: "flow" },
  ];
  harness.state.flowTabs["flow-one"] = flowTab(flow("delete", "Delete"));
  harness.state.flowTabs["flow-two"] = flowTab(flow("delete", "Delete duplicate"));
  const actions = createFlowActions({ backend: harness.backend, getState: () => harness.state, saveDialog: async () => null, makeId: () => "unused" });

  const deleting = actions.deleteFlow("delete");
  assert.deepEqual(harness.closes, []);
  deletion.resolve();
  await deleting;

  assert.deepEqual(harness.closes, ["flow-one", "flow-two"]);
});

test("exportFlow does nothing when the save dialog is cancelled", async () => {
  const { createFlowActions } = await importActions();
  let exports = 0;
  const harness = createHarness({ backend: { flowExport: async () => { exports++; } } });
  const actions = createFlowActions({ backend: harness.backend, getState: () => harness.state, saveDialog: async () => null, makeId: () => "unused" });

  await actions.exportFlow("export", "Unsafe/name");

  assert.equal(exports, 0);
  assert.deepEqual(harness.toasts, []);
});

test("exportFlow sanitizes the default filename, exports, and reports success", async () => {
  const { createFlowActions } = await importActions();
  let options;
  const exported = [];
  const harness = createHarness({ backend: { flowExport: async (...args) => { exported.push(args); } } });
  const actions = createFlowActions({
    backend: harness.backend,
    getState: () => harness.state,
    saveDialog: async (value) => { options = value; return "/tmp/export.json"; },
    makeId: () => "unused",
  });

  await actions.exportFlow("export", "Unsafe/name\\flow");

  assert.equal(options.defaultPath, "Unsafe-name-flow.flow.json");
  assert.deepEqual(exported, [["export", "/tmp/export.json"]]);
  assert.deepEqual(harness.toasts, [["Exported", "/tmp/export.json"]]);
});

test("latest flow-list reload ignores an older success", async () => {
  const { createLatestFlowListReload } = await importActions();
  assert.equal(typeof createLatestFlowListReload, "function");
  const older = deferred();
  const newer = deferred();
  const applied = [];
  let call = 0;
  const reload = createLatestFlowListReload({
    load: () => (++call === 1 ? older.promise : newer.promise),
    apply: (flows) => applied.push(flows),
    fail: assert.fail,
  });

  const olderReload = reload();
  const newerReload = reload();
  newer.resolve([{ id: "new", name: "New", nodeCount: 0 }]);
  await newerReload;
  older.resolve([{ id: "old", name: "Old", nodeCount: 0 }]);
  await olderReload;

  assert.deepEqual(applied, [[{ id: "new", name: "New", nodeCount: 0 }]]);
});

test("latest flow-list reload ignores an older failure", async () => {
  const { createLatestFlowListReload } = await importActions();
  assert.equal(typeof createLatestFlowListReload, "function");
  const older = deferred();
  const newer = deferred();
  const failures = [];
  let call = 0;
  const reload = createLatestFlowListReload({
    load: () => (++call === 1 ? older.promise : newer.promise),
    apply: () => {},
    fail: (error) => failures.push(error),
  });

  const olderReload = reload();
  const newerReload = reload();
  newer.resolve([]);
  await newerReload;
  older.reject(new Error("stale failure"));
  await olderReload;

  assert.deepEqual(failures, []);
});
