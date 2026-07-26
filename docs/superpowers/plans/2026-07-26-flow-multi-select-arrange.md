# Flow Multi-Select + Arrange 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** True multi-select on the Flows canvas (group drag/copy/delete, floating selection bar, align/distribute, multi context menu) plus a dagre-powered Arrange with LR/TB directions and animated transitions.

**Architecture:** Selection becomes a store-owned array `selectedNodeIds` (recency-ordered) that the canvas derives its React Flow `selected` flags from, killing the store-sync wipe bug. Group actions and layout produce plain `FlowNode[]` results from pure helpers in `lib/flow/canvas.ts`; the canvas animates positions locally with an rAF tween and commits one undoable store patch at the end.

**Tech Stack:** React 18, zustand, @xyflow/react 12, motion (Framer), new dep `@dagrejs/dagre`, tests via `node --experimental-strip-types --test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-flow-multi-select-arrange-design.md`.
- Selection is session-only: never persisted in flow files or the saved session (session save already only persists `flowId/flow/original` — keep it that way).
- Every graph mutation goes through one `updateFlowTab` call with a `flow` patch (one undo step). No mutations while `running`.
- Pure helper contract in `lib/flow/canvas.ts`: return a NEW array when changed, the input semantics unchanged when not (see existing `commitNodePositions`).
- Tests: `node --experimental-strip-types --test <file>` from repo root.
- **Commit hygiene (this workspace has unrelated user WIP):** `src/styles/views.css` and `src/components/Inspector.tsx` carry uncommitted user changes — NEVER `git add` those two files; leave their edits uncommitted and list them in the final report. All other touched files are safe to commit per task.
- Baseline failures that predate this work (do not chase, except where a task explicitly fixes one): flowCanvas.contract tests 7–8, nodePanel.contract 1–2, flowRunUi.contract 4, flowsPhase1 test 1, and all store.flow.test.mjs failures (Windows esbuild path bug — fixed in Task 1).

---

### Task 1: Fix store.flow.test.mjs on Windows (esbuild entry path)

**Files:**
- Modify: `src/store.flow.test.mjs:72-79`

**Interfaces:**
- Produces: a runnable `store.flow.test.mjs` harness on Windows; later tasks add store tests to it.

`new URL("store.ts", src).pathname` yields `/D:/...` on Windows, which esbuild can't resolve → 11 tests fail with "Could not resolve".

- [ ] **Step 1: Fix the entry path**

Add to imports at top of `src/store.flow.test.mjs`:

```js
import { fileURLToPath } from "node:url";
```

Change the esbuild call:

```js
  bundledStore ??= build({
    entryPoints: [fileURLToPath(new URL("store.ts", src))],
```

- [ ] **Step 2: Run and record the new baseline**

Run: `node --experimental-strip-types --test src/store.flow.test.mjs`
Expected: the "Could not resolve" error is gone; tests now execute. Record pass/fail count — remaining failures (if any) are the true baseline for Task 2.

- [ ] **Step 3: Commit**

```bash
git add src/store.flow.test.mjs
git commit -m "test: resolve store bundle entry with fileURLToPath for Windows"
```

---

### Task 2: Selection state migration — `selectedNodeIds: string[]`

**Files:**
- Modify: `src/store.ts` (FlowTabState 36-51, loadSession 244, openFlowTab 448, updateFlowTab 548)
- Modify: `src/lib/flow/canvas.ts` (add `nextSelection`)
- Modify: `src/components/flow/FlowCanvas.tsx` (derive/reduce selection, dock rule, paste/dblclick/paneclick/contextmenu writers)
- Modify: `src/components/views/FlowView.tsx:162,180,195`
- Modify: `src/components/flow/RunReport.tsx:114`
- Modify: `src/components/Inspector.tsx:89` (DO NOT COMMIT this file)
- Test: `src/lib/flow/canvas.test.mjs`, `src/store.flow.test.mjs`, `src/lib/flow/flowActions.test.mjs`, `src/components/nodePanel.contract.test.mjs`

**Interfaces:**
- Produces: `FlowTabState.selectedNodeIds: string[]` (recency-ordered, last = newest; `[]` = none), `nextSelection(current: string[], changes: readonly { type: string; id?: string; selected?: boolean }[]): string[]` (returns `current` reference when unchanged).
- Every later task reads selection via `useApp.getState().flowTabs[tabId].selectedNodeIds`.

- [ ] **Step 1: Write failing unit tests for `nextSelection`** — append to `src/lib/flow/canvas.test.mjs`:

```js
import { nextSelection } from "./canvas.ts"; // add to the existing import block

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
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/lib/flow/canvas.test.mjs` → FAIL (`nextSelection` not exported).

- [ ] **Step 3: Implement `nextSelection`** in `src/lib/flow/canvas.ts` (below `removeGraphElements`):

```ts
/**
 * Folds React Flow select/remove changes into the store's recency-ordered selection.
 * Returns the SAME array reference when nothing changed so callers can skip the write.
 */
export function nextSelection(
  current: string[],
  changes: readonly { type: string; id?: string; selected?: boolean }[],
): string[] {
  let next = current;
  for (const change of changes) {
    if (!change.id) continue;
    if (change.type === "select" && change.selected) {
      if (!next.includes(change.id)) next = [...next, change.id];
    } else if (change.type === "select" || change.type === "remove") {
      if (next.includes(change.id)) next = next.filter((id) => id !== change.id);
    }
  }
  return next;
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Store migration** in `src/store.ts`:

`FlowTabState` (line 43): replace `selectedNodeId: string | null;` with `selectedNodeIds: string[];` (keep the `panelNodeId` comment as-is).
`loadSession` (line 244) and `openFlowTab` (line 448): replace `selectedNodeId: null,` with `selectedNodeIds: [],`.
`updateFlowTab` cleanup (line 548): replace

```ts
        if (next.selectedNodeId && !remainingNodeIds.has(next.selectedNodeId)) next.selectedNodeId = null;
```

with

```ts
        if (next.selectedNodeIds.some((id) => !remainingNodeIds.has(id))) {
          next.selectedNodeIds = next.selectedNodeIds.filter((id) => remainingNodeIds.has(id));
        }
```

- [ ] **Step 6: Mechanical writers**

`src/components/views/FlowView.tsx` — in `addDelay` (162), `addLoop` (180), `addTransform` (195): `selectedNodeId: node.id,` → `selectedNodeIds: [node.id],`.
`src/components/flow/RunReport.tsx:114`: `selectedNodeId: node.id,` → `selectedNodeIds: [node.id],`.
`src/components/Inspector.tsx:89`: `const flowStepId = ft ? ft.panelNodeId ?? ft.selectedNodeId : null;` → `const flowStepId = ft ? ft.panelNodeId ?? ft.selectedNodeIds.at(-1) ?? null : null;`.

- [ ] **Step 7: FlowCanvas migration** in `src/components/flow/FlowCanvas.tsx`:

Import `nextSelection` from `../../lib/flow/canvas`.
`toCanvasNode` call site (162): `ft.selectedNodeId === node.id` → `ft.selectedNodeIds.includes(node.id)`; memo dep `ft.selectedNodeId` → `ft.selectedNodeIds` (line 165).
Paste handler (272): `selectedNodeId: pasted.nodes[0]?.id ?? current.selectedNodeId,` → `selectedNodeIds: pasted.nodes.map((node) => node.id),` (paste now selects the whole pasted group).
`onNodesChange` (279-318) — replace the selection bookkeeping wholesale:

```ts
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const current = useApp.getState().flowTabs[tabId];
    const running = current?.running ?? true;
    const allowedChanges = running
      ? changes.filter((change) => change.type === "select" || change.type === "dimensions")
      : changes;
    setNodes((local) => applyNodeChanges(allowedChanges, local));

    if (!current) return;
    const removedNodeIds = new Set(
      running
        ? []
        : changes.filter((change) => change.type === "remove").map((change) => change.id),
    );
    const selection = nextSelection(current.selectedNodeIds, allowedChanges);

    if (removedNodeIds.size > 0) {
      const graph = removeGraphElements(
        current.flow.nodes,
        current.flow.edges,
        removedNodeIds,
        new Set(),
      );
      updateFlowTab(tabId, { flow: { ...current.flow, ...graph }, selectedNodeIds: selection });
    } else if (selection !== current.selectedNodeIds) {
      // exactly one selected block opens/retargets the dock; a multi-selection closes it so the
      // canvas stays front-and-center; an emptied selection leaves the dock as it was
      const single = selection.length === 1
        ? current.flow.nodes.find((node) => node.id === selection[0])
        : undefined;
      const panelNodeId = selection.length >= 2 ? null
        : single && opensDock(single) ? single.id
        : current.panelNodeId;
      updateFlowTab(tabId, { selectedNodeIds: selection, panelNodeId, dockTab: "step" });
    }
  }, [tabId, updateFlowTab]);
```

`onPaneClick` (446): `{ selectedNodeId: null }` → `{ selectedNodeIds: [] }`.
`onNodeContextMenu` (451): `if (current.selectedNodeId !== canvasNode.id) updateFlowTab(tabId, { selectedNodeId: canvasNode.id });` → `if (!current.selectedNodeIds.includes(canvasNode.id)) updateFlowTab(tabId, { selectedNodeIds: [canvasNode.id] });`.
`onNodeDoubleClick` (459): `{ panelNodeId: flowNode.id, selectedNodeId: flowNode.id, dockTab: "step" }` → `{ panelNodeId: flowNode.id, selectedNodeIds: [flowNode.id], dockTab: "step" }`.
Drop handler (410): `selectedNodeId: node.id,` → `selectedNodeIds: [node.id],`.

- [ ] **Step 8: Update test fixtures/assertions**

`src/store.flow.test.mjs`: `flowTab()` helper line 40 `selectedNodeId: null,` → `selectedNodeIds: [],`; line 113/114 seeded session fields `selectedNodeId: "delay"` / `"gone"` → `selectedNodeIds: ["delay"]` / `["gone"]`; line 129 `assert.equal(restored.selectedNodeId, null);` → `assert.deepEqual(restored.selectedNodeIds, []);`; line 148 `selectedNodeId: "node-1",` → `selectedNodeIds: ["node-1"],`; line 238 `selectedNodeId: "n1"` → `selectedNodeIds: ["n1"]`. Then find the assertion near line 148's test verifying post-removal cleanup (it checks `selectedNodeId` becomes null) and assert the array filtering instead: removing `node-1` leaves `selectedNodeIds` `[]`, and a surviving id stays.
`src/lib/flow/flowActions.test.mjs:23`: `selectedNodeId: null,` → `selectedNodeIds: [],`.
`src/components/nodePanel.contract.test.mjs:40`: `assert.match(inspector, /ft\.panelNodeId \?\? ft\.selectedNodeId/);` → `assert.match(inspector, /ft\.panelNodeId \?\? ft\.selectedNodeIds\.at\(-1\)/);`.

- [ ] **Step 9: Verify** — Run:

```bash
node --experimental-strip-types --test src/lib/flow/canvas.test.mjs src/store.flow.test.mjs src/lib/flow/flowActions.test.mjs
npx tsc --noEmit
```

Expected: canvas + flowActions PASS; store.flow failures ≤ Task 1 baseline (no new ones); tsc clean (tsc failures caused by unrelated user WIP are acceptable — record them).

- [ ] **Step 10: Commit** (exclude Inspector.tsx)

```bash
git add src/store.ts src/lib/flow/canvas.ts src/components/flow/FlowCanvas.tsx src/components/views/FlowView.tsx src/components/flow/RunReport.tsx src/lib/flow/canvas.test.mjs src/store.flow.test.mjs src/lib/flow/flowActions.test.mjs src/components/nodePanel.contract.test.mjs
git commit -m "feat(flows): store-backed multi-selection that survives canvas sync"
```

---

### Task 3: ⌘A select-all and Esc clear

**Files:**
- Modify: `src/components/flow/FlowCanvas.tsx` (key handler effect, lines 231-277)
- Test: `src/components/flowCanvas.contract.test.mjs`

**Interfaces:**
- Consumes: `selectedNodeIds` (Task 2).

- [ ] **Step 1: Write failing contract test** — append to `src/components/flowCanvas.contract.test.mjs`:

```js
test("⌘A selects every block and Esc clears the selection (canvas only, not in inputs)", async () => {
  const canvas = await readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8");
  assert.match(canvas, /key !== "c" && key !== "v" && key !== "a"/);
  assert.match(canvas, /selectedNodeIds: current\.flow\.nodes\.map\(\(node\) => node\.id\)/);
  assert.match(canvas, /event\.key === "Escape"/);
  assert.match(canvas, /selectedNodeIds: \[\]/);
});
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/components/flowCanvas.contract.test.mjs` → the new test FAILS.

- [ ] **Step 3: Implement** — restructure the `onKey` handler inside the existing effect (keep the input/textarea/contentEditable guard first, then Escape, then the meta-key block):

```ts
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      if (event.key === "Escape") {
        // one Esc dismisses everything transient: the block menu and the selection
        setNodeMenu(null);
        const current = useApp.getState().flowTabs[tabId];
        if (!current || current.selectedNodeIds.length === 0) return;
        event.preventDefault();
        setNodes((local) => local.map((node) => (node.selected ? { ...node, selected: false } : node)));
        updateFlowTab(tabId, { selectedNodeIds: [] });
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "v" && key !== "a") return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const current = useApp.getState().flowTabs[tabId];
      if (!current) return;

      if (key === "a") {
        if (current.flow.nodes.length === 0) return;
        event.preventDefault();
        setNodes((local) => local.map((node) => (node.selected ? node : { ...node, selected: true })));
        updateFlowTab(tabId, { selectedNodeIds: current.flow.nodes.map((node) => node.id) });
        return;
      }

      if (key === "c") {
        const selectedIds = new Set(getNodes().filter((node) => node.selected).map((node) => node.id));
        if (selectedIds.size === 0) return;
        event.preventDefault();
        copyBlocks(selectedIds);
        return;
      }

      // …existing ⌘V branch unchanged…
    };
```

(The old handler's early `if (!(event.metaKey || event.ctrlKey)) return;` moves below the Escape branch; the text-field guard moves above both. `window.getSelection()` stays only in the meta branch so Esc always works.)

- [ ] **Step 4: Run to verify pass** — same command → new test PASSES (tests 7–8 still fail: pre-existing, addressed in Tasks 7/9).

- [ ] **Step 5: Commit**

```bash
git add src/components/flow/FlowCanvas.tsx src/components/flowCanvas.contract.test.mjs
git commit -m "feat(flows): cmd+a selects all blocks, esc clears selection"
```

---

### Task 4: Pure helpers — align, distribute, duplicate

**Files:**
- Modify: `src/lib/flow/canvas.ts`
- Test: `src/lib/flow/canvas.test.mjs`

**Interfaces:**
- Produces:
  - `interface NodeSize { width: number; height: number }`, `const DEFAULT_NODE_SIZE: NodeSize = { width: 220, height: 88 }` (exported)
  - `alignNodes(nodes: readonly FlowNode[], ids: ReadonlySet<string>, axis: "x" | "y", sizes: ReadonlyMap<string, NodeSize>): FlowNode[]` — axis is the coordinate being equalized ("y" = same row, "x" = same column); aligns centers to the group's average; needs ≥2 picked else returns `[...nodes]`.
  - `distributeNodes(nodes, ids, axis: "x" | "y", sizes): FlowNode[]` — equalizes center gaps along axis between first/last; needs ≥3 picked else `[...nodes]`.
  - `duplicateGraphElements(nodes: readonly FlowNode[], edges: readonly FlowEdge[], ids: ReadonlySet<string>, makeId: (prefix: "n" | "e") => string, offset: { x: number; y: number }): FlowClipboard | null`

- [ ] **Step 1: Write failing tests** — append to `src/lib/flow/canvas.test.mjs`:

```js
import { alignNodes, distributeNodes, duplicateGraphElements, DEFAULT_NODE_SIZE } from "./canvas.ts"; // add to import block

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
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/lib/flow/canvas.test.mjs` → FAIL (missing exports).

- [ ] **Step 3: Implement** in `src/lib/flow/canvas.ts` (near the clipboard helpers):

```ts
export interface NodeSize { width: number; height: number }
/** Pre-measure fallback footprint for a canvas block. */
export const DEFAULT_NODE_SIZE: NodeSize = { width: 220, height: 88 };

const nodeCenter = (
  node: FlowNode,
  axis: "x" | "y",
  sizes: ReadonlyMap<string, NodeSize>,
): number => {
  const size = sizes.get(node.id) ?? DEFAULT_NODE_SIZE;
  return axis === "x" ? node.position.x + size.width / 2 : node.position.y + size.height / 2;
};

const placeCenter = (
  node: FlowNode,
  axis: "x" | "y",
  center: number,
  sizes: ReadonlyMap<string, NodeSize>,
): { x: number; y: number } => {
  const size = sizes.get(node.id) ?? DEFAULT_NODE_SIZE;
  return axis === "x"
    ? { x: Math.round(center - size.width / 2), y: node.position.y }
    : { x: node.position.x, y: Math.round(center - size.height / 2) };
};

/** Align the picked blocks' centers on one coordinate ("y" = one row, "x" = one column). */
export function alignNodes(
  nodes: readonly FlowNode[],
  ids: ReadonlySet<string>,
  axis: "x" | "y",
  sizes: ReadonlyMap<string, NodeSize>,
): FlowNode[] {
  const picked = nodes.filter((node) => ids.has(node.id));
  if (picked.length < 2) return [...nodes];
  const target = picked.reduce((sum, node) => sum + nodeCenter(node, axis, sizes), 0) / picked.length;
  return nodes.map((node) => {
    if (!ids.has(node.id)) return node;
    const position = placeCenter(node, axis, target, sizes);
    return position.x === node.position.x && position.y === node.position.y
      ? node
      : { ...node, position };
  });
}

/** Spread the picked blocks so center gaps are equal along one axis; the outermost two stay put. */
export function distributeNodes(
  nodes: readonly FlowNode[],
  ids: ReadonlySet<string>,
  axis: "x" | "y",
  sizes: ReadonlyMap<string, NodeSize>,
): FlowNode[] {
  const picked = nodes.filter((node) => ids.has(node.id));
  if (picked.length < 3) return [...nodes];
  const sorted = [...picked].sort((a, b) => nodeCenter(a, axis, sizes) - nodeCenter(b, axis, sizes));
  const first = nodeCenter(sorted[0], axis, sizes);
  const step = (nodeCenter(sorted[sorted.length - 1], axis, sizes) - first) / (sorted.length - 1);
  const targets = new Map(sorted.map((node, index) => [node.id, first + step * index]));
  return nodes.map((node) => {
    const center = targets.get(node.id);
    if (center === undefined) return node;
    const position = placeCenter(node, axis, center, sizes);
    return position.x === node.position.x && position.y === node.position.y
      ? node
      : { ...node, position };
  });
}

/** Copy + paste in one move: clones the picked subgraph with fresh ids/keys at an offset. */
export function duplicateGraphElements(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  ids: ReadonlySet<string>,
  makeId: (prefix: "n" | "e") => string,
  offset: { x: number; y: number },
): FlowClipboard | null {
  const clipboard = copyGraphElements(nodes, edges, ids);
  if (!clipboard) return null;
  return pasteGraphElements(clipboard, new Set(nodes.map((node) => node.key)), makeId, offset);
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/flow/canvas.ts src/lib/flow/canvas.test.mjs
git commit -m "feat(flows): pure align/distribute/duplicate graph helpers"
```

---

### Task 5: Position tween module

**Files:**
- Create: `src/components/flow/positionTween.ts`
- Test: `src/components/flow/positionTween.test.mjs` (new)

**Interfaces:**
- Produces: `interface TweenTarget { id: string; from: { x: number; y: number }; to: { x: number; y: number } }`, `easeOutCubic(t: number): number`, `lerpTargets(targets: readonly TweenTarget[], progress: number): Map<string, { x: number; y: number }>`, `runPositionTween(targets, durationMs, apply, done): () => void` (returns cancel; `done` fires exactly once unless cancelled).

- [ ] **Step 1: Write failing tests** — create `src/components/flow/positionTween.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { easeOutCubic, lerpTargets } from "./positionTween.ts";

test("easeOutCubic anchors 0→0 and 1→1 and decelerates", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5); // ease-out is ahead of linear mid-flight
});

test("lerpTargets interpolates eased positions and clamps progress", () => {
  const targets = [{ id: "a", from: { x: 0, y: 0 }, to: { x: 100, y: -100 } }];
  assert.deepEqual(lerpTargets(targets, 0).get("a"), { x: 0, y: 0 });
  assert.deepEqual(lerpTargets(targets, 1).get("a"), { x: 100, y: -100 });
  assert.deepEqual(lerpTargets(targets, 5).get("a"), { x: 100, y: -100 });
  const mid = lerpTargets(targets, 0.5).get("a");
  assert.ok(mid.x > 50 && mid.x < 100);
  assert.equal(mid.y, -mid.x);
});
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/components/flow/positionTween.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/components/flow/positionTween.ts`:

```ts
export interface TweenTarget {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export function lerpTargets(
  targets: readonly TweenTarget[],
  progress: number,
): Map<string, { x: number; y: number }> {
  const eased = easeOutCubic(Math.min(1, Math.max(0, progress)));
  return new Map(targets.map((target) => [target.id, {
    x: target.from.x + (target.to.x - target.from.x) * eased,
    y: target.from.y + (target.to.y - target.from.y) * eased,
  }]));
}

/**
 * rAF-driven tween: `apply` gets interpolated positions every frame, `done` fires exactly once
 * when the tween lands. The returned function cancels a tween still in flight (done is skipped).
 */
export function runPositionTween(
  targets: readonly TweenTarget[],
  durationMs: number,
  apply: (positions: Map<string, { x: number; y: number }>) => void,
  done: () => void,
): () => void {
  if (targets.length === 0) {
    done();
    return () => {};
  }
  const startedAt = performance.now();
  let frame = 0;
  let finished = false;
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / durationMs);
    apply(lerpTargets(targets, progress));
    if (progress < 1) {
      frame = requestAnimationFrame(tick);
    } else {
      finished = true;
      done();
    }
  };
  frame = requestAnimationFrame(tick);
  return () => { if (!finished) cancelAnimationFrame(frame); };
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/flow/positionTween.ts src/components/flow/positionTween.test.mjs
git commit -m "feat(flows): rAF position tween with ease-out interpolation"
```

---

### Task 6: Group actions in the canvas + floating SelectionBar

**Files:**
- Create: `src/components/flow/SelectionBar.tsx`
- Modify: `src/components/flow/FlowCanvas.tsx`, `src/components/flow/nodeActions.ts`, `src/ui/Icon.tsx`
- Modify: `src/styles/views.css` (DO NOT COMMIT)
- Test: `src/components/flowCanvas.contract.test.mjs`

**Interfaces:**
- Consumes: Task 4 helpers, Task 5 tween, `selectedNodeIds`.
- Produces (used by Task 7):
  - In `nodeActions.ts`: `confirmDeleteBlocks(tabId: string, nodeIds: readonly string[]): Promise<void>` (single-node message keeps the step key; multi says `Delete N steps?`); `confirmDeleteNode(tabId, nodeId, key)` stays as a thin wrapper with its existing signature.
  - In `FlowCanvas.tsx` Canvas scope: `duplicateBlocks(ids: readonly string[]): void`, `alignSelection(axis: "x" | "y"): void`, `distributeSelection(axis: "x" | "y"): void`, `measuredSizes(): Map<string, NodeSize>`, `animateToPositions(targetNodes: FlowNode[], thenFit: boolean): void`.

- [ ] **Step 1: Write failing contract test** — append to `src/components/flowCanvas.contract.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/components/flowCanvas.contract.test.mjs` → new test FAILS.

- [ ] **Step 3: Icons** — in `src/ui/Icon.tsx` add to the lucide import block: `AlignCenterHorizontal, AlignCenterVertical, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, CopyPlus` and to `ICONS`:

```ts
  "align-h": AlignCenterVertical,
  "align-v": AlignCenterHorizontal,
  "dist-h": AlignHorizontalDistributeCenter,
  "dist-v": AlignVerticalDistributeCenter,
  duplicate: CopyPlus,
```

(Verify the names exist first: `grep -o "AlignCenterVertical\|CopyPlus\|AlignHorizontalDistributeCenter" node_modules/lucide-react/dist/lucide-react.d.ts | sort -u` — if a name is missing, pick the nearest lucide equivalent and keep the ICONS keys the same.)

- [ ] **Step 4: `confirmDeleteBlocks`** — in `src/components/flow/nodeActions.ts` replace `confirmDeleteNode` with:

```ts
/** Confirm-then-delete for one or many flow blocks; also drops every edge touching them. */
export async function confirmDeleteBlocks(tabId: string, nodeIds: readonly string[]): Promise<void> {
  const state = useApp.getState();
  const current = state.flowTabs[tabId];
  if (!current || current.running || nodeIds.length === 0) return;
  const single = nodeIds.length === 1
    ? current.flow.nodes.find((node) => node.id === nodeIds[0])
    : undefined;
  const confirmed = await state.openConfirm({
    title: nodeIds.length === 1 ? "Delete step" : "Delete steps",
    message: single
      ? `Delete step "${single.key}"? Its connections are removed too.`
      : `Delete ${nodeIds.length} steps? Their connections are removed too.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!confirmed) return;
  const fresh = useApp.getState().flowTabs[tabId];
  if (!fresh || fresh.running) return;
  const graph = removeGraphElements(fresh.flow.nodes, fresh.flow.edges, new Set(nodeIds), new Set());
  // updateFlowTab clears selection/panel ids itself when their nodes disappear
  useApp.getState().updateFlowTab(tabId, { flow: { ...fresh.flow, ...graph } });
}

/** Confirm-then-delete for a flow node; also drops every edge touching it. */
export async function confirmDeleteNode(tabId: string, nodeId: string, _key: string): Promise<void> {
  await confirmDeleteBlocks(tabId, [nodeId]);
}
```

- [ ] **Step 5: SelectionBar component** — create `src/components/flow/SelectionBar.tsx`:

```tsx
import { AnimatePresence, motion } from "motion/react";
import { Panel } from "@xyflow/react";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";

/** Floating group-action bar; visible only while 2+ blocks are selected and no run is live. */
export function SelectionBar({ tabId, onCopy, onDuplicate, onDelete, onAlign, onDistribute }: {
  tabId: string;
  onCopy: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAlign: (axis: "x" | "y") => void;
  onDistribute: (axis: "x" | "y") => void;
}) {
  const count = useApp((state) => state.flowTabs[tabId]?.selectedNodeIds.length ?? 0);
  const running = useApp((state) => state.flowTabs[tabId]?.running ?? false);
  const visible = count >= 2 && !running;
  return (
    <Panel position="bottom-center" className="flow-selection-panel">
      <AnimatePresence>
        {visible && (
          <motion.div
            className="flow-selection-bar"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          >
            <span className="flow-selection-count">{count} selected</span>
            <button type="button" className="tool-btn icon-only" title="Copy (⌘C)" onClick={onCopy}><Icon name="copy" size={14} /></button>
            <button type="button" className="tool-btn icon-only" title="Duplicate" onClick={onDuplicate}><Icon name="duplicate" size={14} /></button>
            <button type="button" className="tool-btn icon-only danger" title="Delete…" onClick={onDelete}><Icon name="trash" size={14} /></button>
            <span className="flow-selection-divider" />
            <button type="button" className="tool-btn icon-only" title="Align in a row" onClick={() => onAlign("y")}><Icon name="align-h" size={14} /></button>
            <button type="button" className="tool-btn icon-only" title="Align in a column" onClick={() => onAlign("x")}><Icon name="align-v" size={14} /></button>
            <button type="button" className="tool-btn icon-only" title="Distribute horizontally" disabled={count < 3} onClick={() => onDistribute("x")}><Icon name="dist-h" size={14} /></button>
            <button type="button" className="tool-btn icon-only" title="Distribute vertically" disabled={count < 3} onClick={() => onDistribute("y")}><Icon name="dist-v" size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}
```

- [ ] **Step 6: Canvas wiring** — in `src/components/flow/FlowCanvas.tsx`:

Imports: add `alignNodes, distributeNodes, duplicateGraphElements, DEFAULT_NODE_SIZE, type NodeSize` to the `../../lib/flow/canvas` import; add `import { runPositionTween, type TweenTarget } from "./positionTween";`, `import { SelectionBar } from "./SelectionBar";`, `import { confirmDeleteBlocks } from "./nodeActions";`.

Inside `Canvas` (after `copyBlocks`):

```ts
  const TWEEN_MS = 300;
  const tweenCancel = useRef<(() => void) | null>(null);
  useEffect(() => () => tweenCancel.current?.(), []);

  const measuredSizes = useCallback((): Map<string, NodeSize> => new Map(getNodes().map((node) => [node.id, {
    width: node.measured?.width ?? DEFAULT_NODE_SIZE.width,
    height: node.measured?.height ?? DEFAULT_NODE_SIZE.height,
  }])), [getNodes]);

  // Slide blocks to their target spots, then commit ONE store patch (a single undo step).
  const animateToPositions = useCallback((targetNodes: FlowNode[], thenFit: boolean) => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    tweenCancel.current?.();
    const targetById = new Map(targetNodes.map((node) => [node.id, node.position]));
    const targets: TweenTarget[] = getNodes().flatMap((node) => {
      const to = targetById.get(node.id);
      if (!to || (to.x === node.position.x && to.y === node.position.y)) return [];
      return [{ id: node.id, from: { ...node.position }, to: { ...to } }];
    });
    if (targets.length === 0) return;
    tweenCancel.current = runPositionTween(targets, TWEEN_MS, (positions) => {
      setNodes((local) => local.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }));
    }, () => {
      tweenCancel.current = null;
      const fresh = useApp.getState().flowTabs[tabId];
      if (!fresh) return;
      updateFlowTab(tabId, { flow: { ...fresh.flow, nodes: commitNodePositions(fresh.flow.nodes, targetNodes) } });
      if (thenFit) void fitView({ padding: 0.2, duration: 300 });
    });
  }, [tabId, getNodes, fitView, updateFlowTab]);

  const duplicateBlocks = useCallback((ids: readonly string[]) => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running || ids.length === 0) return;
    const pasted = duplicateGraphElements(
      current.flow.nodes, current.flow.edges, new Set(ids), nextElementId, { x: PASTE_OFFSET, y: PASTE_OFFSET },
    );
    if (!pasted) return;
    updateFlowTab(tabId, {
      flow: {
        ...current.flow,
        nodes: [...current.flow.nodes, ...pasted.nodes],
        edges: [...current.flow.edges, ...pasted.edges],
      },
      selectedNodeIds: pasted.nodes.map((node) => node.id),
    });
  }, [tabId, updateFlowTab]);

  const alignSelection = useCallback((axis: "x" | "y") => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    animateToPositions(alignNodes(current.flow.nodes, new Set(current.selectedNodeIds), axis, measuredSizes()), false);
  }, [tabId, animateToPositions, measuredSizes]);

  const distributeSelection = useCallback((axis: "x" | "y") => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    animateToPositions(distributeNodes(current.flow.nodes, new Set(current.selectedNodeIds), axis, measuredSizes()), false);
  }, [tabId, animateToPositions, measuredSizes]);
```

Also add `commitNodePositions` to the existing `../../lib/flow/canvas` import if not present (it is — line 26).

Mount inside `<ReactFlow>` children, after `<Controls …/>`:

```tsx
      <SelectionBar
        tabId={tabId}
        onCopy={() => copyBlocks(new Set(useApp.getState().flowTabs[tabId]?.selectedNodeIds ?? []))}
        onDuplicate={() => duplicateBlocks(useApp.getState().flowTabs[tabId]?.selectedNodeIds ?? [])}
        onDelete={() => void confirmDeleteBlocks(tabId, useApp.getState().flowTabs[tabId]?.selectedNodeIds ?? [])}
        onAlign={alignSelection}
        onDistribute={distributeSelection}
      />
```

- [ ] **Step 7: CSS** — append to the flow section of `src/styles/views.css` (near `.flow-canvas-wrap` rules):

```css
/* Floating multi-select action bar */
.flow-selection-panel { margin-bottom: 14px; }
.flow-selection-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--surface-panel);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
}
.flow-selection-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 0 6px;
  white-space: nowrap;
}
.flow-selection-divider {
  width: 1px;
  height: 16px;
  background: var(--border-default);
  margin: 0 4px;
}
.flow-selection-bar .tool-btn.danger:hover { color: var(--status-danger); border-color: var(--status-danger); }
```

(Match surrounding token names — check the file's flow section uses `--surface-panel` / `--border-default` / `--status-danger`; adjust to the tokens actually present there.)

- [ ] **Step 8: Verify** — Run:

```bash
node --experimental-strip-types --test src/components/flowCanvas.contract.test.mjs src/lib/flow/canvas.test.mjs
npx tsc --noEmit
```

Expected: new bar test PASSES; no new failures; tsc clean of new errors.

- [ ] **Step 9: Commit** (exclude views.css)

```bash
git add src/components/flow/SelectionBar.tsx src/components/flow/FlowCanvas.tsx src/components/flow/nodeActions.ts src/ui/Icon.tsx src/components/flowCanvas.contract.test.mjs
git commit -m "feat(flows): floating selection bar with group copy/duplicate/delete and align/distribute"
```

---

### Task 7: Multi-aware context menu (and un-stale its contract test)

**Files:**
- Modify: `src/components/flow/FlowCanvas.tsx` (context-menu render, lines ~473-484)
- Test: `src/components/flowCanvas.contract.test.mjs` (rewrite stale test 7)

**Interfaces:**
- Consumes: `copyBlocks`, `duplicateBlocks`, `confirmDeleteBlocks` (Task 6).

- [ ] **Step 1: Rewrite the stale contract test** — replace the body of `"flow blocks open a right-click context menu with a copy option"` (it asserts markup that predates the `<ContextMenu>` component and fails at baseline):

```js
test("flow blocks open a right-click context menu with group-aware actions", async () => {
  const canvas = await readFile(new URL("components/flow/FlowCanvas.tsx", src), "utf8");
  assert.match(canvas, /onNodeContextMenu/);
  assert.match(canvas, /setNodeMenu\(\{ x: event\.clientX, y: event\.clientY, nodeId: canvasNode\.id \}\)/);
  assert.match(canvas, /<ContextMenu/);
  // right-clicking inside a 2+ selection targets the whole group; outside it, just that block
  assert.match(canvas, /selectedNodeIds\.includes\(nodeMenu\.nodeId\) && [\s\S]*?length > 1/);
  assert.match(canvas, /Copy \$\{many \? `\$\{menuIds\.length\} blocks` : "block"\}/);
  assert.match(canvas, /label: `Duplicate/);
  assert.match(canvas, /danger: true/);
  // menu copy and ⌘C share one path; delete confirms via the shared blocks helper
  assert.match(canvas, /copyBlocks\(new Set\(menuIds\)\)/);
  assert.match(canvas, /confirmDeleteBlocks\(tabId, menuIds\)/);
});
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/components/flowCanvas.contract.test.mjs` → rewritten test FAILS (implementation pending).

- [ ] **Step 3: Implement** — replace the `{nodeMenu && (…)}` block inside `<AnimatePresence>`:

```tsx
        {nodeMenu && (() => {
          const selection = useApp.getState().flowTabs[tabId]?.selectedNodeIds ?? [];
          const menuIds = selection.includes(nodeMenu.nodeId) && selection.length > 1
            ? selection
            : [nodeMenu.nodeId];
          const many = menuIds.length > 1;
          return (
            <ContextMenu
              x={nodeMenu.x}
              y={nodeMenu.y}
              onClose={() => setNodeMenu(null)}
              items={[
                { icon: "copy", label: `Copy ${many ? `${menuIds.length} blocks` : "block"}`, strong: true, kbd: "⌘C", onClick: () => copyBlocks(new Set(menuIds)) },
                { icon: "duplicate", label: `Duplicate ${many ? `${menuIds.length} blocks` : "block"}`, onClick: () => duplicateBlocks(menuIds) },
                { icon: "trash", label: `Delete ${many ? `${menuIds.length} blocks` : "block"}…`, danger: true, onClick: () => void confirmDeleteBlocks(tabId, menuIds) },
              ]}
            />
          );
        })()}
```

- [ ] **Step 4: Run to verify pass** — same command → PASSES (only pre-existing test 8 failure remains until Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/components/flow/FlowCanvas.tsx src/components/flowCanvas.contract.test.mjs
git commit -m "feat(flows): group-aware block context menu with duplicate and delete"
```

---

### Task 8: dagre layout engine — `layoutGraph`

**Files:**
- Modify: `package.json` (+ lockfile) — add `@dagrejs/dagre`
- Modify: `src/lib/flow/canvas.ts` (replace `autoLayoutNodes` with `layoutGraph`)
- Modify: `src/components/views/FlowView.tsx` (drop the now-dead `autoLayoutNodes` import so tsc passes; the arrange button keeps compiling by calling `layoutGraph` with an empty size map until Task 9 rewires it)
- Test: `src/lib/flow/canvas.test.mjs`

**Interfaces:**
- Produces: `type LayoutDirection = "LR" | "TB"` and `layoutGraph(nodes: readonly FlowNode[], edges: readonly FlowEdge[], direction: LayoutDirection, sizes: ReadonlyMap<string, NodeSize>): FlowNode[]` (same changed/unchanged return contract; loop blocks with back-edges leave the chain lane: below it for LR, right of it for TB).
- `autoLayoutNodes` is DELETED.

- [ ] **Step 1: Install** — `npm install @dagrejs/dagre`. Then verify types ship: `ls node_modules/@dagrejs/dagre/index.d.ts` — if absent, create `src/types/dagre.d.ts` containing `declare module "@dagrejs/dagre";` and include it via existing tsconfig `include` (check `tsconfig.json` covers `src`).

- [ ] **Step 2: Write failing tests** — in `src/lib/flow/canvas.test.mjs`, DELETE the existing `autoLayoutNodes` tests (search `autoLayoutNodes`) and add:

```js
import { layoutGraph } from "./canvas.ts"; // add to import block, remove autoLayoutNodes

const sizedNode = (id, type = "delay") => ({ id, key: id, type, position: { x: 0, y: 0 }, config: type === "loop" ? { count: 2 } : { ms: 1 } });
const uniformSizes = (nodes, width = 200, height = 80) => new Map(nodes.map((node) => [node.id, { width, height }]));

test("layoutGraph LR advances ranks left→right and TB top→bottom", () => {
  const nodes = [sizedNode("a"), sizedNode("b"), sizedNode("c")];
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
  const nodes = [sizedNode("root"), sizedNode("s1"), sizedNode("s2")];
  const edges = [
    { id: "e1", source: "root", target: "s1" },
    { id: "e2", source: "root", target: "s2" },
  ];
  const lr = layoutGraph(nodes, edges, "LR", uniformSizes(nodes));
  assert.equal(lr[1].position.x, lr[2].position.x); // same rank
  assert.notEqual(lr[1].position.y, lr[2].position.y); // separated within it
});

test("layoutGraph pushes looped-back loop blocks off the chain lane", () => {
  const nodes = [sizedNode("a"), sizedNode("b"), sizedNode("loop", "loop")];
  const edges = [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "loop" },
    { id: "e3", source: "loop", target: "a" }, // back-edge closes the circle
  ];
  const lr = layoutGraph(nodes, edges, "LR", uniformSizes(nodes));
  const chainBottom = Math.max(lr[0].position.y, lr[1].position.y) + 80;
  assert.ok(lr[2].position.y >= chainBottom); // LR: loop drops below the chain
  const tb = layoutGraph(nodes, edges, "TB", uniformSizes(nodes));
  const chainRight = Math.max(tb[0].position.x, tb[1].position.x) + 200;
  assert.ok(tb[2].position.x >= chainRight); // TB: loop swings right of the chain
});

test("layoutGraph keeps the unchanged-input contract", () => {
  const nodes = [sizedNode("a")];
  const once = layoutGraph(nodes, [], "LR", uniformSizes(nodes));
  const twice = layoutGraph(once, [], "LR", uniformSizes(nodes));
  assert.deepEqual(once, twice); // idempotent
  assert.notEqual(layoutGraph([], [], "LR", new Map()).length, undefined); // empty graph returns []
});
```

- [ ] **Step 3: Run to verify failure** — `node --experimental-strip-types --test src/lib/flow/canvas.test.mjs` → FAIL.

- [ ] **Step 4: Implement** — in `src/lib/flow/canvas.ts`, add `import dagre from "@dagrejs/dagre";` at the top and REPLACE `autoLayoutNodes` (lines 113-170, including `LAYOUT_COL/LAYOUT_ROW` constants) with:

```ts
export type LayoutDirection = "LR" | "TB";

const LAYOUT_NODE_SEP = 48;   // gap between blocks sharing a rank
const LAYOUT_RANK_SEP = 90;   // gap between successive ranks
const LAYOUT_MARGIN = 60;
const LOOP_LANE_GAP = 60;     // clearance pushing loop blocks off the chain lane

/** Layered auto-layout via dagre; direction picks the main axis (LR or TB). */
export function layoutGraph(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  direction: LayoutDirection,
  sizes: ReadonlyMap<string, NodeSize>,
): FlowNode[] {
  if (nodes.length === 0) return [];
  // loop back-edges close circles on purpose; layout walks the acyclic remainder, same as
  // the engine — otherwise any flow with a loop would knot the layered ranking
  const layoutEdges = dagEdges({ nodes, edges });
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    nodesep: LAYOUT_NODE_SEP,
    ranksep: LAYOUT_RANK_SEP,
    marginx: LAYOUT_MARGIN,
    marginy: LAYOUT_MARGIN,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { ...(sizes.get(node.id) ?? DEFAULT_NODE_SIZE) });
  for (const edge of layoutEdges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  // A looped-back loop block leaves the chain lane so its back wire routes outside the
  // blocks: below the chain when arranging LR, to the right of it when arranging TB
  const loopIds = new Set(
    [...loopBackEdgeMap({ nodes, edges })]
      .filter(([, backs]) => backs.length > 0)
      .map(([id]) => id),
  );
  let laneEdge = -Infinity;
  for (const node of nodes) {
    if (loopIds.has(node.id)) continue;
    const placed = graph.node(node.id);
    laneEdge = Math.max(laneEdge, direction === "LR" ? placed.y + placed.height / 2 : placed.x + placed.width / 2);
  }

  let changed = false;
  const nextNodes = nodes.map((node) => {
    const placed = graph.node(node.id);
    // dagre reports centers; flow nodes store top-left corners
    let x = placed.x - placed.width / 2;
    let y = placed.y - placed.height / 2;
    if (loopIds.has(node.id) && laneEdge > -Infinity) {
      if (direction === "LR") y = Math.max(y, laneEdge + LOOP_LANE_GAP);
      else x = Math.max(x, laneEdge + LOOP_LANE_GAP);
    }
    x = Math.round(x);
    y = Math.round(y);
    if (node.position.x === x && node.position.y === y) return node;
    changed = true;
    return { ...node, position: { x, y } };
  });
  return changed ? nextNodes : [...nodes];
}
```

Keep the `dagEdges` / `loopBackEdgeMap` / `topoOrder` imports as needed (`topoOrder` may become unused — remove it from the import if so).

- [ ] **Step 5: Keep FlowView compiling** — in `src/components/views/FlowView.tsx` change the import `autoLayoutNodes` → `layoutGraph` and the `arrange` function body: `const nodes = autoLayoutNodes(current.flow.nodes, current.flow.edges);` → `const nodes = layoutGraph(current.flow.nodes, current.flow.edges, "LR", new Map());` (temporary until Task 9).

- [ ] **Step 6: Run to verify pass**

```bash
node --experimental-strip-types --test src/lib/flow/canvas.test.mjs
npx tsc --noEmit
```

Expected: PASS / no new tsc errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/flow/canvas.ts src/lib/flow/canvas.test.mjs src/components/views/FlowView.tsx
git commit -m "feat(flows): dagre-powered layoutGraph with LR/TB directions"
```

---

### Task 9: Arrange UI — split button, direction memory, animated arrange

**Files:**
- Modify: `src/store.ts` (arrange-direction pref), `src/components/views/FlowView.tsx` (split button + arrangeApi ref), `src/components/flow/FlowCanvas.tsx` (arrangeApi implementation)
- Modify: `src/styles/views.css` (DO NOT COMMIT)
- Test: `src/components/flowCanvas.contract.test.mjs` (also fixes stale test 8's Arrange assertions if any break — they assert `dagEdges`/`loopBackEdgeMap` in the helper, which still hold)

**Interfaces:**
- Consumes: `layoutGraph`, `animateToPositions`, `measuredSizes` (Tasks 6/8).
- Produces: store fields `flowArrangeDir: LayoutDirection` + `setFlowArrangeDir(dir: LayoutDirection): void` (persisted at `requestsmin:flow-arrange-dir`); `FlowCanvas` prop `arrangeApi?: MutableRefObject<((direction: LayoutDirection) => void) | null>`.

- [ ] **Step 1: Write failing contract test** — append to `src/components/flowCanvas.contract.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/components/flowCanvas.contract.test.mjs` → new test FAILS.

- [ ] **Step 3: Store pref** — in `src/store.ts` add to `AppState` (near `requestHorizontal`):

```ts
  flowArrangeDir: "LR" | "TB"; // last-used Arrange direction for flow canvases
  setFlowArrangeDir: (dir: "LR" | "TB") => void;
```

and in the store creation (near the other localStorage-backed prefs):

```ts
  flowArrangeDir: localStorage.getItem("requestsmin:flow-arrange-dir") === "TB" ? "TB" : "LR",
  setFlowArrangeDir: (dir) => {
    localStorage.setItem("requestsmin:flow-arrange-dir", dir);
    set({ flowArrangeDir: dir });
  },
```

- [ ] **Step 4: Canvas arrange implementation** — in `src/components/flow/FlowCanvas.tsx`:

Add to `Canvas` props (and the outer `FlowCanvas` wrapper props, pass-through):

```ts
  arrangeApi?: MutableRefObject<((direction: LayoutDirection) => void) | null>;
```

with `import type { MutableRefObject } from "react";` and `import type { LayoutDirection } from "../../lib/flow/canvas";` (add `layoutGraph` to the value import). Implement after `animateToPositions`:

```ts
  useEffect(() => {
    if (!arrangeApi) return;
    arrangeApi.current = (direction) => {
      const current = useApp.getState().flowTabs[tabId];
      if (!current || current.running || current.flow.nodes.length === 0) return;
      animateToPositions(layoutGraph(current.flow.nodes, current.flow.edges, direction, measuredSizes()), true);
    };
    return () => { arrangeApi.current = null; };
  }, [arrangeApi, tabId, animateToPositions, measuredSizes]);
```

- [ ] **Step 5: FlowView split button** — in `src/components/views/FlowView.tsx`:

Remove the old `arrange` function and the `layoutGraph` import (canvas owns layout now). Add:

```tsx
  const arrangeApi = useRef<((direction: LayoutDirection) => void) | null>(null);
  const arrangeDir = useApp((state) => state.flowArrangeDir);
  const setFlowArrangeDir = useApp((state) => state.setFlowArrangeDir);
  const [arrangeMenu, setArrangeMenu] = useState(false);
  const arrangeWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!arrangeMenu) return;
    const onDown = (event: PointerEvent) => {
      if (arrangeWrapRef.current && !arrangeWrapRef.current.contains(event.target as Node)) setArrangeMenu(false);
    };
    const onBlur = () => setArrangeMenu(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [arrangeMenu]);

  const runArrange = (direction: LayoutDirection) => {
    setArrangeMenu(false);
    if (direction !== arrangeDir) setFlowArrangeDir(direction);
    arrangeApi.current?.(direction);
  };
```

(import `LayoutDirection` type from `../../lib/flow/canvas`, `useEffect`/`useRef`/`useState` already imported.)

Replace the Arrange button markup with:

```tsx
        <div className="split-btn" ref={arrangeWrapRef}>
          <button
            type="button"
            className="tool-btn icon-only"
            onClick={() => runArrange(arrangeDir)}
            disabled={ft.running || ft.flow.nodes.length === 0}
            title={`Arrange (${arrangeDir === "LR" ? "left → right" : "top → bottom"})`}
          >
            <Icon name="wand" />
          </button>
          <button
            type="button"
            className="tool-btn icon-only split-btn-caret"
            onClick={() => setArrangeMenu((open) => !open)}
            disabled={ft.running || ft.flow.nodes.length === 0}
            aria-haspopup="menu"
            aria-expanded={arrangeMenu}
            title="Arrange direction"
          >
            <Icon name="chevron-down" size={12} />
          </button>
          {arrangeMenu && (
            <div className="actions-menu-pop split-btn-menu" role="menu">
              <div role="menuitem" className={`actions-menu-item ${arrangeDir === "LR" ? "active" : ""}`} onMouseDown={(e) => { e.preventDefault(); runArrange("LR"); }}>
                <Icon name="chevron-right" size={14} />
                <span>Left → right</span>
              </div>
              <div role="menuitem" className={`actions-menu-item ${arrangeDir === "TB" ? "active" : ""}`} onMouseDown={(e) => { e.preventDefault(); runArrange("TB"); }}>
                <Icon name="chevron-down" size={14} />
                <span>Top → bottom</span>
              </div>
            </div>
          )}
        </div>
```

Pass the ref to the canvas: `<FlowCanvas tabId={tabId} active={active} arrangeApi={arrangeApi} onRunNode={…} />`.

- [ ] **Step 6: CSS** — append to `src/styles/views.css` near `.actions-menu`:

```css
.split-btn { position: relative; display: inline-flex; }
.split-btn .tool-btn:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.split-btn .split-btn-caret {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  margin-left: -1px;
  padding-inline: 3px;
}
.split-btn-menu { right: 0; left: auto; min-width: 150px; }
```

(Verify `.actions-menu-pop` is absolutely positioned relative to its wrapper; mirror whatever top/offset it uses.)

- [ ] **Step 7: Verify**

```bash
node --experimental-strip-types --test src/components/flowCanvas.contract.test.mjs src/lib/flow/canvas.test.mjs
npx tsc --noEmit
```

Expected: new test PASSES; stale test 8 status unchanged-or-better; no new tsc errors.

- [ ] **Step 8: Commit** (exclude views.css)

```bash
git add src/store.ts src/components/views/FlowView.tsx src/components/flow/FlowCanvas.tsx src/components/flowCanvas.contract.test.mjs
git commit -m "feat(flows): split-button arrange with remembered direction and animated layout"
```

---

### Task 10: Selection visuals

**Files:**
- Modify: `src/styles/views.css` (DO NOT COMMIT)
- Test: `src/components/flowCanvas.contract.test.mjs`

- [ ] **Step 1: Write failing contract test** — append:

```js
test("multi-select visuals: accent rubber-band and a clear selected ring", async () => {
  const css = await readFile(new URL("styles/views.css", src), "utf8");
  assert.match(css, /\.react-flow__selection/);
  assert.match(css, /\.react-flow__nodesselection-rect/);
  assert.match(css, /\.react-flow__node\.selected \.flow-node[^}]*box-shadow/s);
});
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/components/flowCanvas.contract.test.mjs` → FAILS.

- [ ] **Step 3: Implement** — read the current rule at `src/styles/views.css:1131` (`.react-flow__node.selected .flow-node`) and REPLACE it with an accent ring + glow, then add the rubber-band styling next to it:

```css
.react-flow__node.selected .flow-node {
  border-color: var(--accent-primary);
  box-shadow:
    0 0 0 1px var(--accent-primary),
    0 6px 18px color-mix(in srgb, var(--accent-primary) 22%, transparent);
}
.flow-canvas-wrap .react-flow__selection,
.flow-canvas-wrap .react-flow__nodesselection-rect {
  background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  border: 1px dashed var(--accent-primary);
  border-radius: 4px;
}
```

(If the codebase avoids `color-mix`, mimic however it does translucent accents — check for `rgba`/`color-mix` usage near the flow section and copy that idiom. Preserve whatever other declarations the existing selected rule carries.)

- [ ] **Step 4: Run to verify pass** — same command → PASSES.

- [ ] **Step 5: No commit** — views.css stays uncommitted (user WIP); commit only the test:

```bash
git add src/components/flowCanvas.contract.test.mjs
git commit -m "test(flows): contract for multi-select visuals"
```

---

### Task 11: Full verification

- [ ] **Step 1: Full frontend test sweep**

```bash
node --experimental-strip-types --test src/**/*.test.mjs 2>&1 | tail -20
```

(If globbing misbehaves in the shell, list the files explicitly.) Compare against the Task 1 baseline: every pre-existing failure may remain; ZERO new failures. Fix regressions before proceeding.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: tsc + vite succeed. tsc errors originating in the user's WIP files (unrelated to this work) are recorded, not fixed.

- [ ] **Step 3: Report** — summarize in the final message: what shipped, test results vs baseline, uncommitted files (views.css, Inspector.tsx) and why, remaining pre-existing failures worth a follow-up task.
