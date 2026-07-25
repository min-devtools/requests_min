import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, src), "utf8");

test("the step editor lives in the right dock as a tab", async () => {
  const [panel, flowView, inspector, requestView] = await Promise.all([
    read("components/flow/NodePanel.tsx"),
    read("components/views/FlowView.tsx"),
    read("components/Inspector.tsx"),
    read("components/views/RequestView.tsx"),
  ]);

  assert.match(panel, /`flowreq:\${tabId}:\${node\.id}`/);
  assert.match(panel, /<RequestView tabId=\{editorId\} active embedded/);
  assert.doesNotMatch(panel, /Partial<FlowNode>/);
  assert.doesNotMatch(flowView, /NodePanel/);
  assert.match(flowView, /className="flow-body"/);
  assert.match(inspector, /<NodePanel tabId=\{activeTabId\} \/>/);
  // dock tab switcher uses the shared .mini-tabs pill style (matches sibling apps)
  assert.match(inspector, /className="mini-tabs" role="tablist"/);
  // opening a step reveals/widens the dock; the tab itself is store-driven (canvas → step, report → result)
  assert.match(inspector, /if \(!ft\?\.panelNodeId\) return;\s*const state = useApp\.getState\(\)/);
  assert.match(requestView, /embedded\?: boolean/);
  assert.match(requestView, /!embedded && requestHorizontal/);
  // the embedded flow editor drops the protocol rail (REST/gRPC pills + name); protocol moves to the Step-key row
  assert.match(requestView, /\{!embedded && \(\s*<div className="protocol-rail">/);
  assert.match(panel, /className="method-select flow-proto-select"/);
});

test("the Step Result tab renders the run response in the inspector dock", async () => {
  const [panel, inspector] = await Promise.all([
    read("components/flow/NodePanel.tsx"),
    read("components/Inspector.tsx"),
  ]);

  assert.doesNotMatch(panel, /Resolved input|flow-resolved/);
  assert.match(inspector, /ft\.panelNodeId \?\? ft\.selectedNodeId/);
  // dock tab is store-driven so report rows can jump straight to the result view
  assert.match(inspector, /const dockTab = ft\?\.dockTab \?\? "step"/);
  assert.match(inspector, />Step Result</);
  assert.match(inspector, /<JsonTreePanel value=\{stepResponseBody\(flowResult\.response\)\} \/>/);
  assert.doesNotMatch(inspector, /New request/);
});

test("request resizing resolves the request screen from the dragged handle", async () => {
  const resize = await read("components/ResizeHandles.tsx");
  assert.match(resize, /event\.currentTarget[^\n]+closest\("\.request-screen\.active"\)/);
  assert.doesNotMatch(resize, /document\.querySelector\(requestAxis \? "\.request-screen\.active"/);
});

test("the flow panel layout keeps a zero-min-height canvas and embedded editor chain", async () => {
  const css = await read("styles/views.css");
  assert.match(css, /\.flow-body\s*\{[^}]*min-height:\s*0[^}]*display:\s*flex/s);
  assert.match(css, /\.flow-body\s+\.flow-canvas-wrap\s*\{[^}]*flex:\s*1/s);
  assert.match(css, /\.flow-node-editor\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.flow-node-editor\s+\.request-screen\.embedded\s*\{[^}]*grid-template-rows:/s);
});

test("Step Result JSON uses the dock content font size", async () => {
  const css = await read("styles/requestsmin.css");

  assert.match(css, /\.flow-result-response \.json-tree-view\s*\{[^}]*font-size:\s*0\.9231rem/s);
});
