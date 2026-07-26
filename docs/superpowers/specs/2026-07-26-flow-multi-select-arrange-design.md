# Flow Multi-Select + Arrange 2.0 Design Spec

## Overview

Two problems in the Flows canvas:

1. **Multi-select is broken at the root.** The store keeps a single `selectedNodeId`; `FlowCanvas` derives every node's `selected` flag from it and re-syncs local React Flow state on every store change, so Ctrl+click / Shift+drag multi-selection collapses back to one node immediately. The layers below (multi copy/paste, group drag, group delete) already support sets and start working the moment selection survives.
2. **Arrange produces ugly layouts.** `autoLayoutNodes` places blocks at `column = longest-path depth, row = visit order` with fixed 300×150 cells — no crossing reduction, no parent alignment, one direction only.

Goals (user priority: beautiful + smooth): true multi-select with group actions, a floating selection bar, align/distribute tools, and a rebuilt Arrange with Left→Right / Top→Bottom directions, real node sizes, and animated transitions.

Out of scope: flow engine, flow file format (selection stays session-only), undo/redo mechanics (reuse `updateFlowTab` snapshots).

## 1. Selection state: `selectedNodeIds: string[]`

- `FlowTabState.selectedNodeId: string | null` → `selectedNodeIds: string[]`, ordered by selection recency (last element = most recent). Empty array = nothing selected. `panelNodeId` unchanged.
- Session load (`loadSession`) resets it to `[]`. Session save omits it (as today).
- `updateFlowTab` node-removal cleanup filters removed ids out of the array (replaces the null-out).
- `FlowCanvas.storeNodes` derives `selected: selectedNodeIds.includes(node.id)`.
- `onNodesChange` applies changes locally first, then computes the next selection array from select/remove changes (append newly selected preserving recency order, drop deselected/removed) and writes it to the store only when it actually changed (shallow compare).
- Every current writer of `selectedNodeId` switches mechanically: add-node / drop / paste select `[newNodeId]` (paste selects **all** pasted nodes), `RunReport` click selects `[node.id]`, pane click writes `[]`.
- `Inspector`'s `panelNodeId ?? selectedNodeId` fallback becomes `panelNodeId ?? selectedNodeIds.at(-1)`.

### Dock behavior (user decision)

- Selection becomes exactly 1 node that `opensDock` → open/retarget dock (`panelNodeId`, `dockTab: "step"`), as today.
- Selection becomes ≥ 2 → close the dock (`panelNodeId: null`).
- Selection becomes empty → leave `panelNodeId` as-is (matches today's pane-click behavior).

### Gestures

React Flow defaults already provide the chosen scheme; no config changes: drag on pane = pan, **Shift+drag** = rubber-band selection, **Ctrl/⌘+click** = toggle node in selection. Group drag (all selected move), Delete key (removes all selected), and ⌘C (copies all selected) already handle sets.

## 2. Keyboard

In the existing key handler effect (active tab only, skipped when focus is in an input/textarea/contentEditable or a text selection exists):

- **⌘/Ctrl+A**: select all nodes (store write + local flags). Allowed while running (selection-only).
- **Escape**: clear selection if any (`[]`). Only when no context menu is open (menu's own Esc wins).
- ⌘C/⌘V unchanged.

## 3. Floating selection bar

New component `SelectionBar` rendered inside `.flow-canvas-wrap`, bottom-center overlay. Visible when `selectedNodeIds.length ≥ 2` **and** not running; mounted via `AnimatePresence` with a slide-up/fade `motion.div` (~180ms) in/out.

Contents:

- Count badge: `N selected`.
- **Copy** — reuses `copyBlocks` path (toast included).
- **Duplicate** — copy + paste in one store patch with a +40/+40 offset; new nodes become the selection.
- **Delete** — confirm dialog `Delete N steps? Their connections are removed too.` (danger), then one `removeGraphElements` patch. (Delete key stays instant — it is undoable.)
- Divider, then **Align horizontal** (equal `y`), **Align vertical** (equal `x`), **Distribute horizontal**, **Distribute vertical** (equalize gaps; distribute buttons disabled below 3 selected). One undoable store patch each; positions animate (see §5 animation).

Pure helpers in `lib/flow/canvas.ts`: `alignNodes(nodes, ids, axis)` and `distributeNodes(nodes, ids, axis)` operating on node centers using measured sizes when available (fallback to stored position + default size).

## 4. Context menu

`onNodeContextMenu`:

- Right-clicked node **inside** current multi-selection (≥2): keep selection; menu shows `Copy N blocks` (⌘C), `Duplicate N blocks`, `Delete N blocks…` (danger, confirm — same path as the bar).
- Otherwise: selection becomes just that node; menu shows `Copy block` (⌘C), `Duplicate block`, `Delete block…` (danger, confirm via `confirmDeleteNode`).

All actions route through the same handlers as the selection bar.

## 5. Arrange 2.0

New dependency: **`@dagrejs/dagre`** (small, synchronous, the React Flow community standard for layered layouts). elkjs was considered and rejected: better only on large graphs, ~20× heavier, async API complicates the animation path.

- New `layoutGraph(nodes, edges, direction, sizes)` in `lib/flow/canvas.ts` replaces `autoLayoutNodes`:
  - Feeds dagre the acyclic remainder (`dagEdges`, as today) with `rankdir: "LR" | "TB"`, tuned `nodesep`/`ranksep`, and **measured node sizes** from React Flow (`node.measured`), falling back to sensible defaults pre-measure.
  - Keeps the loop-block offset heuristic post-layout so loop-back wires route outside the chain: LR pushes loop blocks below their rank's rows; TB pushes them right of their rank's columns.
  - Returns new positions only when changed (same contract as today).
- Toolbar: Arrange becomes a **split button** — main click arranges with the last-used direction; the chevron opens a small menu `Left → Right` / `Top → Bottom`. Last direction persists in the app store alongside other UI prefs.
- **Animated transition:** node positions tween from current to target over ~300ms ease-out (rAF interpolation through local React Flow state), then commit **one** `updateFlowTab` patch (single undo step), then `fitView({ duration: 300 })`. Arrange disabled mid-run (as today); a second Arrange during the tween cancels and restarts it.
- Align/Distribute (§3) reuse the same tween-then-commit path.

## 6. Visual polish

- Rubber-band selection rectangle themed: accent border + low-alpha accent fill (`--accent-primary`), overriding React Flow defaults for both light/dark.
- `.react-flow__node.selected .flow-node` gets a clearer accent ring (2px ring + subtle glow) instead of the current border-only look.
- Selection bar styled like existing floating surfaces (panel background, `--border-default`, shadow, 6px radius, existing icon buttons).

## 7. Testing strategy

`node --experimental-strip-types --test` per existing conventions:

- `src/lib/flow/canvas.test.mjs`: `alignNodes` / `distributeNodes` (centers, ordering, <3 no-op), `layoutGraph` LR/TB with mocked sizes (ranks advance on the main axis, loop offset heuristic, no-change identity return), duplicate-selection helper if extracted.
- `src/store.flow.test.mjs`: `selectedNodeIds` cleanup on node removal, session load resets to `[]`.
- Contract tests (`flowCanvas.contract.test.mjs`, `nodePanel.contract.test.mjs`, `flowRunUi.contract.test.mjs`, `flowsPhase1.test.mjs`): update `selectedNodeId` assertions to the array form; add assertions for ⌘A/Esc handler, selection bar (AnimatePresence + count badge), multi context menu labels, dagre usage in `layoutGraph`, split-button markup, selection-rect CSS override.
- `npm run build` (tsc + vite) passes.
