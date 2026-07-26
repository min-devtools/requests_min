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

test("flow blocks open a right-click context menu with group-aware actions", async () => {
  const canvas = await readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8");
  assert.match(canvas, /onNodeContextMenu/);
  assert.match(canvas, /setNodeMenu\(\{ x: event\.clientX, y: event\.clientY, nodeId: canvasNode\.id \}\)/);
  assert.match(canvas, /<ContextMenu/);
  // right-clicking inside a 2+ selection targets the whole group; outside it, just that block
  assert.match(canvas, /selection\.includes\(nodeMenu\.nodeId\) && selection\.length > 1/);
  assert.match(canvas, /label: `Copy \$\{many \? `\$\{menuIds\.length\} blocks` : "block"\}`/);
  assert.match(canvas, /label: `Duplicate/);
  assert.match(canvas, /danger: true/);
  // menu copy and ⌘C share one path; delete confirms via the shared blocks helper
  assert.match(canvas, /copyBlocks\(new Set\(menuIds\)\)/);
  assert.match(canvas, /confirmDeleteBlocks\(tabId, menuIds\)/);
});

test("Add loop action creates a loop block whose count edits inline in the step detail tab", async () => {
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
  // no pencil on the block face: the pass count edits inline in the step detail tab
  assert.doesNotMatch(node, /pencil|editLoopNode/);
  assert.match(node, /run body ×\{data\.node\.config\.count\}/);
  assert.match(actions, /export async function promptLoopCount/);
  assert.match(actions, /export function setLoopCount/);
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
  assert.match(panel, /setLoopCount\(tabId, node\.id/);
  assert.match(panel, /CommitNumberInput/);
  // the panel's legend dots use the same colors as the canvas anchors
  assert.match(css, /\.flow-dot-in \{ background: var\(--accent-primary\); \}/);
  assert.match(css, /\.flow-dot-out \{ background: var\(--orange/);
});

test("delay blocks open the step detail tab and edit their duration inline", async () => {
  const [delay, panel, canvas, inspector, actions] = await Promise.all([
    readFile(new URL("components/flow/DelayNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/DelayPanel.tsx", src), "utf8"),
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
    readFile(new URL("components/Inspector.tsx", src), "utf8"),
    readFile(new URL("components/flow/nodeActions.ts", src), "utf8"),
  ]);
  // no pencil on the block face; clicking the block opens the dock (opensDock covers delay)
  assert.doesNotMatch(delay, /pencil|editDelayNode/);
  assert.match(delay, /confirmDeleteNode\(data\.tabId, data\.node\.id, data\.node\.key\)/);
  assert.match(canvas, /\|\| node\.type === "delay"/);
  assert.match(inspector, /panelNode\?\.type === "delay"\s*\?\s*<DelayPanel tabId=\{activeTabId\} \/>/);
  assert.match(panel, /setDelayMs\(tabId, node\.id/);
  assert.match(panel, /CommitNumberInput/);
  assert.match(actions, /export function setDelayMs/);
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

test("loop, delay and transform blocks read left-to-right and carry an on/off switch", async () => {
  const [loop, delay, transform, bits, actions, css, types, engine] = await Promise.all([
    readFile(new URL("components/flow/LoopNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/DelayNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/TransformNode.tsx", src), "utf8"),
    readFile(new URL("components/flow/nodeBits.tsx", src), "utf8"),
    readFile(new URL("components/flow/nodeActions.ts", src), "utf8"),
    readFile(new URL("styles/views.css", src), "utf8"),
    readFile(new URL("lib/flow/types.ts", src), "utf8"),
    readFile(new URL("lib/flow/engine.ts", src), "utf8"),
  ]);

  // compact blocks align left like every other block — no centered identity row left over
  assert.match(css, /\.flow-node-delay \.flow-node-head \{ justify-content: flex-start; \}/);
  assert.doesNotMatch(css, /\.flow-node-delay \.flow-node-head \{ justify-content: center; \}/);
  assert.match(css, /\.flow-node-loop \.flow-node-sub \{ text-align: left; \}/);

  // the switch is a real ARIA switch pinned top-right, and it edits the persisted `enabled` flag
  assert.match(bits, /role="switch"/);
  assert.match(bits, /className="flow-node-toggle nodrag nopan"/);
  assert.match(css, /\.flow-node-toggle\[aria-checked="true"\]/);
  assert.match(types, /enabled\?: boolean/);
  assert.match(actions, /export function setNodeEnabled/);
  for (const node of [loop, delay, transform]) {
    assert.match(node, /<NodeToggle/);
    assert.match(node, /setNodeEnabled\(data\.tabId, data\.node\.id, next\)/);
    assert.match(node, /is-off/);
  }

  // an off step is a pass-through: skipped without running, and it never blocks its descendants
  assert.match(engine, /if \(!isNodeEnabled\(node\)\)/);
  assert.match(engine, /status: "skipped", disabled: true/);
  assert.match(engine, /if \(step\?\.disabled\) return false;/);
});

test("steps hanging off a loop body wait for the loop, not for the body's first pass", async () => {
  const engine = await readFile(new URL("lib/flow/engine.ts", src), "utf8");
  // the scheduler re-parents body-exit edges onto the loop so nothing reads a step mid-re-run
  assert.match(engine, /const schedulerEdges = \[\.\.\.graphEdges\];/);
  assert.match(engine, /source: loopId, target: edge\.target/);
  assert.match(engine, /for \(const graphEdge of schedulerEdges\)/);
  // an unexplained skip must not be reported as a green run
  assert.match(engine, /step\.status === "skipped" && !step\.disabled/);
});

test("⌘A selects every block and Esc clears the selection (canvas only, not in inputs)", async () => {
  const canvas = await readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8");
  assert.match(canvas, /key !== "c" && key !== "v" && key !== "a"/);
  assert.match(canvas, /selectedNodeIds: current\.flow\.nodes\.map\(\(node\) => node\.id\)/);
  assert.match(canvas, /event\.key === "Escape"/);
  assert.match(canvas, /selectedNodeIds: \[\]/);
});

test("a floating selection bar offers group copy/duplicate/delete and align/distribute", async () => {
  const [bar, canvas, actions, icon] = await Promise.all([
    readFile(new URL("components/flow/SelectionBar.tsx", src), "utf8"),
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
    readFile(new URL("components/flow/nodeActions.ts", src), "utf8"),
    readFile(new URL("ui/Icon.tsx", src), "utf8"),
  ]);
  // bar appears only for a 2+ selection while idle, animated via AnimatePresence
  assert.match(bar, /count >= 2 && !running/);
  assert.match(bar, /AnimatePresence/);
  assert.match(bar, /\{count\} selected/);
  // distribute needs three blocks
  assert.match(bar, /disabled=\{count < 3\}/);
  // canvas wires the bar to shared group handlers and mounts it as a React Flow panel
  assert.match(canvas, /<SelectionBar/);
  assert.match(canvas, /duplicateGraphElements\(/);
  assert.match(canvas, /alignNodes\(/);
  assert.match(canvas, /distributeNodes\(/);
  assert.match(canvas, /runPositionTween\(/);
  // group delete confirms with a count and reuses one removal path
  assert.match(actions, /export async function confirmDeleteBlocks/);
  assert.match(actions, /Delete \$\{nodeIds\.length\} steps\?/);
  assert.match(icon, /duplicate: CopyPlus/);
});

test("Arrange is a split button with a remembered LR/TB direction and animated layout", async () => {
  const [view, canvas, store] = await Promise.all([
    readFile(new URL("components/views/FlowView.tsx", src), "utf8"),
    readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8"),
    readFile(new URL("store.ts", src), "utf8"),
  ]);
  assert.match(store, /flowArrangeDir/);
  assert.match(store, /requestsmin:flow-arrange-dir/);
  assert.match(view, /arrangeApi\.current\?\.\(/);
  assert.match(view, /Left → right/);
  assert.match(view, /Top → bottom/);
  // the canvas owns arrange execution: measured sizes → layoutGraph → tweened commit + fitView
  assert.match(canvas, /arrangeApi/);
  assert.match(canvas, /layoutGraph\(current\.flow\.nodes, current\.flow\.edges, direction, measuredSizes\(\)\)/);
  assert.match(canvas, /animateToPositions\(.*, true\)/);
});
