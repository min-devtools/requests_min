# Remove Monaco JSON Editor Vim Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `[vim]` button from the `JsonEditor` header toolbar and update the Settings description text accordingly.

**Architecture:** Edit `JsonEditor.tsx` to remove the vim toggle button and unused state binding while maintaining the monaco-vim initialization logic when `vimMode` is enabled. Edit `SettingsView.tsx` to update the description text for Vim mode.

**Tech Stack:** React, TypeScript, Monaco Editor, Zustand (`useApp` store).

## Global Constraints

- Preserve all other toolbar buttons (`fill sample`, `format`, `minify`, `validate`).
- Maintain existing Vim mode functionality in Monaco editor when enabled via Settings.

---

### Task 1: Remove Vim button from JsonEditor and update Settings description

**Files:**
- Modify: `src/ui/JsonEditor.tsx:15-16,98`
- Modify: `src/components/views/SettingsView.tsx:95`

- [ ] **Step 1: Remove toggleVimMode and vim button element from JsonEditor.tsx**

In `src/ui/JsonEditor.tsx`:
Remove `const toggleVimMode = useApp((state) => state.toggleVimMode);` from line 16.
Remove `<button type="button" className={vimMode ? "active" : ""} onClick={toggleVimMode} title="Vim mode" aria-label="Vim mode" aria-pressed={vimMode}>vim</button>` from line 98 inside `.json-editor-tools`.

- [ ] **Step 2: Update SettingsView.tsx Vim mode description**

In `src/components/views/SettingsView.tsx`:
Change `<span>Modal editing via monaco-vim in the query editor. Toggle also lives in the editor footer.</span>` to `<span>Modal editing via monaco-vim in the query editor.</span>`.

- [ ] **Step 3: Verify build / typecheck**

Run: `npm run build` or `npx tsc --noEmit` to verify no broken imports or type errors.

- [ ] **Step 4: Commit changes**

```bash
git add src/ui/JsonEditor.tsx src/components/views/SettingsView.tsx docs/superpowers
git commit -m "refactor: remove vim button from JSON editor toolbar"
```
