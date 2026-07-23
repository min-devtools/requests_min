import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, src), "utf8").catch(() => "");

test("Cmd+S saves environments first, then flows, then requests", async () => {
  const app = await source("App.tsx");

  assert.match(app, /import \{ saveActiveFlow \} from "\.\/lib\/flow\/flowActions"/);
  const environment = app.indexOf('activeTab?.kind === "environments"');
  const flow = app.indexOf('activeTab?.kind === "flow"');
  const request = app.indexOf("saveActiveRequest()", flow);
  assert.ok(environment >= 0 && flow > environment && request > flow);
  assert.match(app, /if \(activeTab\?\.kind === "environments"\)[^\n]+\n\s*else if \(activeTab\?\.kind === "flow"\) void saveActiveFlow\(\);\n\s*else void saveActiveRequest\(\);/);
});

test("Saved Flows uses the utility view contract and loads on activation", async () => {
  const view = await source("components/views/FlowsView.tsx");

  assert.match(view, /className={`content utility-view \$\{active \? "active" : ""\}`}/);
  assert.match(view, /useEffect\(\(\) => \{ if \(active\) void reload\(\); \}, \[active\]\)/);
  assert.match(view, /className="page-head"/);
  assert.match(view, /className="utility-body"/);
  assert.match(view, /className="table-panel"/);
  assert.match(view, /className="history-table"/);
});

test("Saved Flows reports activation load failures", async () => {
  const view = await source("components/views/FlowsView.tsx");

  assert.match(view, /createLatestFlowListReload\(\{[\s\S]*load: api\.flowList,[\s\S]*fail: \(error\) => \{[\s\S]*showToast\("Load failed", String\(error\), "err"\)/);
});

test("Saved Flows wires every Phase-1 action and reloads mutations", async () => {
  const view = await source("components/views/FlowsView.tsx");

  for (const action of ["createFlow", "renameFlow", "duplicateFlow", "exportFlow", "deleteFlow"]) {
    assert.match(view, new RegExp(`\\b${action}\\(`));
  }
  assert.match(view, /openFlowTab\(flow\.id\)/);
  assert.match(view, /await action\(\);\s*await reload\(\);/);
  assert.match(view, /showToast\(failure, String\(error\), "err"\)/);
});

test("Saved Flows keeps Open and always-visible keyboard actions as separate buttons", async () => {
  const view = await source("components/views/FlowsView.tsx");

  assert.match(view, /<ToolButton[^>]*onClick=\{\(\) => void open\(flow\)\}[^>]*>Open<\/ToolButton>/);
  for (const label of ["Rename", "Duplicate", "Export", "Delete"]) {
    const dynamicLabel = `${label} \\$\\{flow\\.name\\}`;
    assert.match(view, new RegExp("title=\\{`" + dynamicLabel + "`\\} aria-label=\\{`" + dynamicLabel + "`\\}"));
  }
  assert.doesNotMatch(view, /role="button"/);
  assert.doesNotMatch(view, /tabIndex=/);
  assert.doesNotMatch(view, /stopPropagation/);
  assert.doesNotMatch(view, /row-actions/);
});

test("Saved Flows exposes each flow name as the table row header", async () => {
  const view = await source("components/views/FlowsView.tsx");

  assert.match(view, /<th scope="row"><strong>\{flow\.name\}<\/strong><small className="row-subtitle">\{flow\.id\}<\/small><\/th>/);
});

test("Saved Flows filters names with Cmd+F and cycles name sorting", async () => {
  const view = await source("components/views/FlowsView.tsx");

  assert.match(view, /fuzzyMatch\(query, flow\.name\)/);
  assert.match(view, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(view, /event\.key\.toLowerCase\(\) !== "f"/);
  assert.match(view, /sortDirection === "desc" \? "asc" : sortDirection === "asc" \? null : "desc"/);
  assert.match(view, /onClick=\{\(\) => setSortDirection/);
  assert.match(view, /className="side-search"/);
  assert.match(view, /onKeyDown=\{\(event\) => \{ if \(event\.key === "Escape"\) event\.currentTarget\.blur\(\); \}\}/);
});

test("Saved Flows uses Scenario runner as its only heading", async () => {
  const view = await source("components/views/FlowsView.tsx");

  assert.match(view, /<h1>Scenario runner<\/h1>/);
  assert.doesNotMatch(view, /<div className="eyebrow">Scenario runner<\/div>/);
  assert.doesNotMatch(view, /<h1>Flows<\/h1>/);
});
