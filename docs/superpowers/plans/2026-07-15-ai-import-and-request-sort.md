# AI Import and Request Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a folder path natively, generate complete module-prefixed HTTP requests from large source trees, and persist request sorting by name.

**Architecture:** Keep folder selection and sorting in the existing React views. Keep source batching, provider calls, validation, and result merging in `src-tauri/src/ai.rs`; reuse `req_reorder` for persistent ordering.

**Tech Stack:** React 18, TypeScript, Tauri 2 dialog plugin, Rust, reqwest, serde.

## Global Constraints

- Preserve manual path entry and existing request drag ordering.
- Add no dependency or configuration option.
- Never silently drop readable selected files because the source is large.
- Generated names use `[Module] Action`; payload examples are inferred from source.

---

### Task 1: AI Source Batching

**Files:**
- Modify: `src-tauri/src/ai.rs`

**Interfaces:**
- Produces: `source_batches(files: &[String], max_bytes: usize) -> Vec<String>` and `merge_drafts(target: &mut Vec<DraftEntry>, incoming: Vec<DraftEntry>)`.

- [ ] Add Rust tests proving every readable file marker reaches a batch and duplicate `rel_path` values keep the first draft.
- [ ] Run `cargo test ai::tests --lib` and verify the new tests fail.
- [ ] Implement bounded source batches, one provider request per batch, batch-numbered errors, HTTP validation, and stable de-duplication.
- [ ] Strengthen `SYSTEM_PROMPT` with exact `[Module] Action`, `{{baseUrl}}`, relative path, and JSON payload rules.
- [ ] Run `cargo test ai::tests --lib` and verify all AI tests pass.

### Task 2: Native Folder Import

**Files:**
- Modify: `src/components/views/AiImportView.tsx`
- Test: `src/components/aiCollectionFeatures.test.mjs`

**Interfaces:**
- Consumes: `open({ directory: true, multiple: false })` from `@tauri-apps/plugin-dialog`.

- [ ] Add a source test asserting the directory picker and immediate `api.aiScan(selectedDir)` flow exist.
- [ ] Run `node --test src/components/aiCollectionFeatures.test.mjs` and verify it fails.
- [ ] Add a `Choose folder` button that fills `dir` and scans the selected directory while preserving manual scan.
- [ ] Run the source test and verify it passes.

### Task 3: Persistent Name Sort

**Files:**
- Modify: `src/components/views/CollectionsView.tsx`
- Test: `src/components/aiCollectionFeatures.test.mjs`

**Interfaces:**
- Consumes: `api.reqReorder(collectionId: string, order: string[])`.

- [ ] Extend the source test to require A-Z and Z-A controls, case-insensitive name comparison, and `api.reqReorder` persistence.
- [ ] Run the source test and verify it fails.
- [ ] Add `sortRequests(direction: "asc" | "desc")`, persist relative paths, update local rows, and report errors through the existing toast.
- [ ] Run the source test and verify it passes.

### Task 4: Verification

**Files:**
- Verify all modified files.

- [ ] Run `node --test src/**/*.test.mjs` and verify all frontend source tests pass.
- [ ] Run `cargo test --lib` from `src-tauri` and verify all Rust tests pass.
- [ ] Run `npm run build` and verify TypeScript and Vite complete successfully.
- [ ] Inspect `git diff --check` and `git diff`; keep unrelated worktree changes intact.
