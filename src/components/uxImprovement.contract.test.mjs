import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("request actions share readiness and saveability contracts", async () => {
  const [titlebar, inspector, runner] = await Promise.all([
    source("components/Titlebar.tsx"),
    source("components/Inspector.tsx"),
    source("lib/runRequest.ts"),
  ]);

  assert.match(titlebar, /requestTargetConfigured/);
  assert.match(titlebar, /dirty \|\| !relPath/);
  assert.doesNotMatch(titlebar, /Cancel request/);
  assert.doesNotMatch(inspector, /saveActiveRequest|copyCommand|Copy \{request\.protocol/);
  assert.match(inspector, /requestReadiness\(request, unresolved\.length\)/);
  assert.match(runner, /requestTargetConfigured\(rt\.request\)/);
  assert.match(runner, /showToast\("Request incomplete"/);
});

test("Inspector availability follows active content and becomes a narrow-window drawer", async () => {
  const [app, css] = await Promise.all([
    source("App.tsx"),
    source("styles/requestsmin.css"),
  ]);

  assert.match(app, /const inspectorAvailable = activeKind === "request" \|\| activeKind === "flow"/);
  assert.match(app, /classList\.toggle\("inspector-unavailable", !inspectorAvailable\)/);
  assert.match(app, /rightCollapsed \|\| !inspectorAvailable/);
  assert.match(app, /disabled=\{!inspectorAvailable\}/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*\.inspector\s*\{[\s\S]*position:\s*absolute[\s\S]*right:\s*0/s);
});

test("Flow clears stale step details when selection is dismissed", async () => {
  const canvas = await source("components/flow/FlowCanvas.tsx");

  assert.match(canvas, /updateFlowTab\(tabId, \{ selectedNodeIds: \[\], panelNodeId: null \}\)/);
  assert.match(canvas, /onPaneClick=\{\(\) => updateFlowTab\(tabId, \{ selectedNodeIds: \[\], panelNodeId: null \}\)\}/);
});

test("workspace navigation and command results expose keyboard semantics", async () => {
  const [sidebar, palette] = await Promise.all([
    source("components/Sidebar.tsx"),
    source("components/CommandPalette.tsx"),
  ]);

  assert.match(sidebar, /<button key=\{item\.kind\} type="button" className=\{`nav-item/);
  assert.match(palette, /role="dialog"/);
  assert.match(palette, /role="listbox"/);
  assert.match(palette, /role="option"/);
  assert.match(palette, /aria-selected=\{i === cursor\}/);
});

test("session restore strips literal request secrets and functional helper text stays legible", async () => {
  const [store, css] = await Promise.all([
    source("store.ts"),
    source("styles/requestsmin.css"),
  ]);

  assert.match(store, /request: sanitizeForStorage\(rt\.request\)/);
  assert.match(store, /original: sanitizeOriginalForStorage\(rt\.original\)/);
  assert.match(css, /\.inspector-empty[^}]*color:\s*var\(--text-2\)/s);
  assert.match(css, /\.response-empty[^}]*color:\s*var\(--text-2\)/s);
});
