# Toggle Request Editor Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking an HTTP or gRPC editor tab expands the editor to leave the response dock at its minimum height; double-clicking again restores the prior vertical split.

**Architecture:** Keep the existing CSS variable based vertical split. Add a small exported helper in `ResizeHandles.tsx` that measures the active request screen, remembers its current editor height for the current expansion cycle, and updates the existing `--request-top` and `requestsmin:request-top` storage key. `RequestView.tsx` binds the helper to editor-tab `onDoubleClick`; column layout remains unchanged.

**Tech Stack:** React 18, TypeScript, CSS Grid, Node built-in test runner.

## Global Constraints

- Do not change the column response layout (`request-x`); it has no bottom dock to collapse.
- Reuse `--request-top` and `requestsmin:request-top`; do not add application state or dependencies.
- The expanded response area must retain the existing 170px CSS minimum.
- HTTP Body, Headers, Params, Auth and gRPC Message, Metadata tabs must toggle the same split.

---

### Task 1: Cover Tab-Triggered Split Toggling

**Files:**
- Modify: `src/components/requestWorkspace.test.mjs:35-48`
- Modify: `src/components/ResizeHandles.tsx:1-64`
- Modify: `src/components/views/RequestView.tsx:201-206,285-288`

**Interfaces:**
- Consumes: the existing `startResize(event, axis)` helper and `requestHorizontal` boolean.
- Produces: `toggleRequestEditorSize(event: React.MouseEvent, horizontal: boolean): void`, called by each HTTP and gRPC editor tab's `onDoubleClick`.

- [ ] **Step 1: Write the failing test**

Extend `response dock resizer persists a bounded vertical split` to load `RequestView.tsx` and assert the toggle interface and bindings:

```js
assert.match(handles, /export function toggleRequestEditorSize\(event: React\.MouseEvent, horizontal: boolean\)/);
assert.match(handles, /if \(horizontal\) return/);
assert.match(handles, /requestsmin:request-top/);
assert.match(view, /onDoubleClick=\{\(event\) => toggleRequestEditorSize\(event, horizontal\)\}/);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test src/components/requestWorkspace.test.mjs`

Expected: FAIL because `toggleRequestEditorSize` and the `onDoubleClick` bindings do not exist.

- [ ] **Step 3: Implement the minimal toggle helper**

In `src/components/ResizeHandles.tsx`, add a module-scoped `let expandedRequestTop: number | null = null;` and this export after `startResize`:

```tsx
export function toggleRequestEditorSize(event: React.MouseEvent, horizontal: boolean) {
  if (horizontal) return;
  const screen = (event.currentTarget as HTMLElement).closest(".request-screen.active") as HTMLElement | null;
  if (!screen) return;

  const editorPane = screen.querySelector(".editor-pane") as HTMLElement | null;
  if (!editorPane) return;

  if (expandedRequestTop === null) {
    expandedRequestTop = editorPane.getBoundingClientRect().height;
    const next = Math.max(39, Math.round(screen.getBoundingClientRect().height - 86));
    document.body.style.setProperty("--request-top", `${next}px`);
    localStorage.setItem("requestsmin:request-top", String(next));
    return;
  }

  document.body.style.setProperty("--request-top", `${Math.round(expandedRequestTop)}px`);
  localStorage.setItem("requestsmin:request-top", String(Math.round(expandedRequestTop)));
  expandedRequestTop = null;
}
```

The `86px` matches the vertical resize maximum already used by `startResize`, preserving the 7px handle and the response dock's 170px minimum after the fixed request-screen rows.

- [ ] **Step 4: Bind every request editor tab**

Update the six buttons in `src/components/views/RequestView.tsx` for HTTP Body, Headers, Params, Auth and gRPC Message, Metadata. Keep each existing `onClick` and add:

```tsx
onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}
```

Update the import at line 11:

```tsx
import { startResize, toggleRequestEditorSize } from "../ResizeHandles";
```

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `node --test src/components/requestWorkspace.test.mjs`

Expected: PASS, including `response dock resizer persists a bounded vertical split`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ResizeHandles.tsx src/components/views/RequestView.tsx src/components/requestWorkspace.test.mjs
git commit -m "feat: toggle request editor size on tab double-click"
```

### Task 2: Verify Compilation and Existing Layout Contract

**Files:**
- Verify: `src/components/ResizeHandles.tsx`
- Verify: `src/components/views/RequestView.tsx`
- Verify: `src/styles/requestsmin.css`
- Verify: `src/styles/viewLayout.test.mjs`

**Interfaces:**
- Consumes: `toggleRequestEditorSize` added in Task 1.
- Produces: a compiled frontend whose existing row-grid and response-minimum contract remains intact.

- [ ] **Step 1: Run the layout contract test**

Run: `node --test src/styles/viewLayout.test.mjs`

Expected: PASS, confirming the vertical grid still uses `minmax(39px, var(--request-top))` and a `minmax(170px, 1fr)` response area.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: TypeScript compilation and Vite build complete with exit code 0.

- [ ] **Step 3: Manually verify both toggle states**

Run: `npm run dev`

Expected: In a REST or gRPC request with row layout, double-click each listed editor tab once to expand the editor with a visibly minimal response dock; double-click again to restore the height held before expansion. Switch to column layout and confirm double-click has no effect on its horizontal split.

- [ ] **Step 4: Commit only if verification required a code correction**

```bash
git add src/components/ResizeHandles.tsx src/components/views/RequestView.tsx src/components/requestWorkspace.test.mjs
git commit -m "fix: preserve request editor toggle layout"
```

Do not create this commit when no files changed during verification.

## Self-Review

- Spec coverage: Task 1 binds all six requested editor tabs and stores/restores the previous vertical split. Task 2 verifies row-layout minimums, TypeScript compilation, and that column layout is unaffected.
- Placeholder scan: no incomplete requirements or implementation placeholders remain.
- Type consistency: all call sites use `toggleRequestEditorSize(event, horizontal)` and the helper accepts `React.MouseEvent` plus `boolean`.
