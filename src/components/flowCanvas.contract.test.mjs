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

test("flow canvas copy-pastes selected blocks with ⌘C/⌘V via a shared clipboard", async () => {
  const [canvas, helper] = await Promise.all([
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
    readFile(new URL("lib/flow/canvas.ts", src), "utf8"),
  ]);
  assert.match(canvas, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(canvas, /copyGraphElements\(current\.flow\.nodes, current\.flow\.edges, selectedIds\)/);
  assert.match(canvas, /pasteGraphElements\(/);
  // native copy/paste keeps winning inside inputs, Monaco, and text selections
  assert.match(canvas, /el\.tagName === "INPUT" \|\| el\.tagName === "TEXTAREA" \|\| el\.isContentEditable/);
  assert.match(canvas, /!selection\.isCollapsed/);
  // paste is blocked while running and lands as one undoable updateFlowTab flow patch
  assert.match(canvas, /if \(current\.running\) \{\s*showToast\("Flow is running"/);
  assert.match(helper, /export function copyGraphElements/);
  assert.match(helper, /export function pasteGraphElements/);
  assert.match(helper, /stepKeyFor\(node\.key, keys\)/);
});

test("flow blocks open a right-click context menu with a copy option", async () => {
  const canvas = await readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8");
  assert.match(canvas, /onNodeContextMenu/);
  assert.match(canvas, /setNodeMenu\(\{ x: event\.clientX, y: event\.clientY, nodeId: canvasNode\.id \}\)/);
  assert.match(canvas, /className="index-context-menu"/);
  assert.match(canvas, /<strong>Copy block<\/strong><kbd>⌘C<\/kbd>/);
  // the menu's copy and ⌘C share one path
  assert.match(canvas, /copyBlocks\(new Set\(\[nodeMenu\.nodeId\]\)\)/);
});

test("Add loop action creates a loop block edited through a modal like Add delay", async () => {
  const [view, canvas, node, actions, helper, icon] = await Promise.all([
    readFile(new URL("components/views/FlowView.tsx", src), "utf8"),
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
    readFile(new URL("components/flow/LoopNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/nodeActions.ts", src), "utf8"),
    readFile(new URL("lib/flow/canvas.ts", src), "utf8"),
    readFile(new URL("ui/Icon.tsx", src), "utf8"),
  ]);
  assert.match(view, /\{ key: "loop", label: "Add loop", icon: "repeat" \}/);
  assert.match(view, /promptLoopCount\("Add loop", 3\)/);
  assert.match(view, /createLoopFlowNode\(/);
  assert.match(canvas, /loop: LoopNode/);
  assert.match(node, /editLoopNode\(data\.tabId, data\.node\.id\)/);
  assert.match(node, /run body ×\{data\.node\.config\.count\}/);
  assert.match(actions, /export async function promptLoopCount/);
  assert.match(actions, /export async function editLoopNode/);
  assert.match(helper, /export function createLoopFlowNode/);
  assert.match(helper, /stepKeyFor\("loop", takenKeys\)/);
  assert.match(icon, /repeat: Repeat/);
  // Arrange keeps working on loop flows: auto-layout walks the acyclic remainder too, and
  // drops loop steps below the chain so back-edges route under the blocks
  assert.match(helper, /dagEdges\(\{ nodes, edges \}\)/);
  assert.match(helper, /loopBackEdgeMap\(\{ nodes, edges \}\)/);
});

test("loop anchors are color-coded and the step detail tab explains the circle wiring", async () => {
  const [css, canvas, inspector, panel] = await Promise.all([
    readFile(new URL("styles/views.css", src), "utf8"),
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
    readFile(new URL("components/Inspector.tsx", src), "utf8"),
    readFile(new URL("components/flow/LoopPanel.tsx", src), "utf8"),
  ]);
  assert.match(css, /\.flow-node-loop \.react-flow__handle\.handle-in \{ background: var\(--accent-primary\)/);
  assert.match(css, /\.flow-node-loop \.react-flow__handle\.handle-out \{ background: var\(--orange/);
  // clicking a loop block opens its dock panel
  assert.match(canvas, /\|\| isLoopNode\(node\)/);
  assert.match(inspector, /panelNode\?\.type === "loop"/);
  assert.match(inspector, /<LoopPanel tabId=\{activeTabId\} \/>/);
  assert.match(panel, /flow-loop-hint/);
  assert.match(panel, /flow-dot flow-dot-in/);
  assert.match(panel, /flow-dot flow-dot-out/);
  assert.match(panel, /editLoopNode\(tabId, node\.id\)/);
  // the panel's legend dots use the same colors as the canvas anchors
  assert.match(css, /\.flow-dot-in \{ background: var\(--accent-primary\); \}/);
  assert.match(css, /\.flow-dot-out \{ background: var\(--orange/);
});

test("loop block drops its key, shows a live countdown, and accepts wires from both sides", async () => {
  const [loop, delay, types, canvas] = await Promise.all([
    readFile(new URL("components/flow/LoopNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/DelayNode.tsx", src), "utf8"),
    readFile(new URL("lib/flow/types.ts", src), "utf8"),
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
  ]);
  // delay & loop blocks stay compact: no step key on the block face
  assert.doesNotMatch(loop, /flow-node-key/);
  assert.doesNotMatch(delay, /flow-node-key/);
  // countdown badge bound to the engine's live remaining-passes field
  assert.match(loop, /flow-node-loop-count/);
  assert.match(loop, /data\.remaining/);
  assert.match(types, /remaining\?: number/);
  assert.match(canvas, /remaining \?\? null/);
  // dual-direction anchors: default left-in/right-out plus id'd alternates, both persisted
  assert.match(loop, /type="target" position=\{Position\.Left\} className="handle-in"/);
  assert.match(loop, /type="source" position=\{Position\.Left\} id="out-left"/);
  assert.match(loop, /type="target" position=\{Position\.Right\} id="in-right"/);
  assert.match(loop, /type="source" position=\{Position\.Right\} className="handle-out"/);
  assert.match(types, /targetHandle\?: string/);
  assert.match(canvas, /targetHandle: edge\.targetHandle \?\? undefined/);
});

test("dragging a wire pulses every compatible handle anchor and locks the valid one green", async () => {
  const [canvas, css, request, delay, transform, loop] = await Promise.all([
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
    readFile(new URL("styles/views.css", src), "utf8"),
    readFile(new URL("components/flow/RequestNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/DelayNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/TransformNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/LoopNode.tsx", src), "utf8"),
  ]);
  assert.match(canvas, /onConnectStart=\{\(_, params\) => setLinking\(params\.handleType\)\}/);
  assert.match(canvas, /onConnectEnd=\{\(\) => setLinking\(null\)\}/);
  assert.match(canvas, /is-linking-from-\$\{linking\}/);
  // every block's anchors carry the in/out marker classes the CSS keys on
  for (const node of [request, delay, transform, loop]) {
    assert.match(node, /className="handle-in"/);
    assert.match(node, /className="handle-out"/);
  }
  assert.match(css, /\.is-linking-from-source \.react-flow__handle\.handle-in/);
  assert.match(css, /\.is-linking-from-target \.react-flow__handle\.handle-out/);
  assert.match(css, /@keyframes flow-handle-pulse/);
  assert.match(css, /scale\(1\.15\)/);
  assert.match(css, /\.react-flow__handle\.valid/);
});

test("run wires flash only when execution crosses them (engine-stamped activation pulses)", async () => {
  const [canvas, engine, types] = await Promise.all([
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
    readFile(new URL("lib/flow/engine.ts", src), "utf8"),
    readFile(new URL("lib/flow/types.ts", src), "utf8"),
  ]);
  // the engine stamps each step start with the block that fed it; the canvas lights the wire
  // from that feeder for a short window — loop wires pulse once per pass, never a constant glow
  assert.match(types, /pulses\?: Record<string, \{ at: number; via: string \| null \}>/);
  assert.match(engine, /runNode = async \(nodeId: string, via\?: string\)/);
  assert.match(engine, /via: via \?\? null/);
  assert.match(engine, /let via = nodeId/);
  assert.match(engine, /launch\(child, nodeId\)/);
  assert.match(canvas, /pulse\?\.via === edge\.source/);
  assert.match(canvas, /WIRE_PULSE_MS/);
  assert.doesNotMatch(canvas, /steps\[edge\.source\]\?\.status === "running"/);
});

test("loop steps run their body count times via back-edge aware scheduling and validation", async () => {
  const [engine, validateLib, types] = await Promise.all([
    readFile(new URL("lib/flow/engine.ts", src), "utf8"),
    readFile(new URL("lib/flow/validate.ts", src), "utf8"),
    readFile(new URL("lib/flow/types.ts", src), "utf8"),
  ]);
  assert.match(validateLib, /export function loopBackEdgeMap/);
  assert.match(validateLib, /export function dagEdges/);
  assert.match(validateLib, /export function loopBodyNodes/);
  assert.match(validateLib, /Loop needs a connection from it back to an earlier step/);
  assert.match(engine, /dagEdges\(flow\)/);
  assert.match(engine, /loopBodyNodes\(flow, node\.id\)/);
  assert.match(engine, /node\.type === "loop"/);
  assert.match(types, /MAX_LOOP_COUNT = 100/);
});
