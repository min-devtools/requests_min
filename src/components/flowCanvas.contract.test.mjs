import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../", import.meta.url);

test("request drags can move within the sidebar or copy into a flow", async () => {
  const sidebar = await readFile(new URL("components/Sidebar.tsx", src), "utf8");
  assert.match(sidebar, /kind: "collection"[^\n]+effectAllowed = "move"/);
  assert.match(sidebar, /kind: "request"[^\n]+effectAllowed = "copyMove"/);
});

test("flow view preserves mounted active state and collision-safe delay keys", async () => {
  const [view, helper] = await Promise.all([
    readFile(new URL("components/views/FlowView.tsx", src), "utf8"),
    readFile(new URL("lib/flow/canvas.ts", src), "utf8"),
  ]);
  assert.match(view, /className={`content flow-view \${active \? "active" : ""}`}/);
  assert.match(view, /createDelayFlowNode\(/);
  assert.match(helper, /stepKeyFor\("delay",\s*takenKeys\)/);
  assert.match(view, /saveActiveFlow\(\)/);
  assert.match(view, /<FlowCanvas tabId={tabId} active={active}/);
});

test("flow layout has a zero-min-height chain and canonical design tokens", async () => {
  const css = await readFile(new URL("styles/views.css", src), "utf8");
  assert.match(css, /\.content\.flow-view\.active\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.flow-canvas-wrap\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.flow-node\s*\{[^}]*var\(--border-default\)[^}]*var\(--surface-panel\)/s);
  assert.match(css, /\.flow-node\.status-success\s*\{[^}]*var\(--status-success\)/s);
  assert.match(css, /\.flow-node\.status-failed\s*\{[^}]*var\(--status-danger\)/s);
  const flowCss = css.slice(css.indexOf("/* Flow canvas */"), css.indexOf(".condition-card"));
  assert.doesNotMatch(flowCss, /var\(--(?:border|panel|ok|err)(?:\)|,)/);
});

test("graph mutation callbacks consult current run state", async () => {
  const canvas = await readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8");
  assert.match(canvas, /onNodesChange[\s\S]+?const current = useApp\.getState\(\)\.flowTabs\[tabId\];[\s\S]+?const running = current\?\.running \?\? true;[\s\S]+?running\s*\? changes\.filter/);
  assert.match(canvas, /onEdgesChange[\s\S]+?const current = useApp\.getState\(\)\.flowTabs\[tabId\];[\s\S]+?const running = current\?\.running \?\? true;[\s\S]+?running\s*\? changes\.filter/);
});

test("an in-flight drop exits silently if its flow tab was closed", async () => {
  const canvas = await readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8");
  assert.match(canvas, /await api\.reqRead[\s\S]+?const current = useApp\.getState\(\)\.flowTabs\[tabId\];\s*if \(!current\) return;\s*if \(current\.running\)/);
});
