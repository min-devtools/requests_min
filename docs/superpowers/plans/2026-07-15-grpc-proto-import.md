# gRPC Proto Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select multiple local `.proto` files, immediately load their services and methods, and widen every gRPC source/service/method selector enough to show useful labels.

**Architecture:** Use Tauri's official dialog plugin for native multi-file selection and keep the existing `protoFiles` request field as the source of truth. Refactor the existing describe operation to accept an optional file list so both the Describe button and file import share one catalog-loading path. Scope layout rules to gRPC-specific classes so HTTP method sizing remains unchanged.

**Tech Stack:** React 18, TypeScript, Tauri 2, `@tauri-apps/plugin-dialog`, `tauri-plugin-dialog`, CSS, Node test runner.

## Global Constraints

- The picker accepts multiple files and filters to the `.proto` extension.
- Selecting files updates `grpc.protoFiles` and loads the catalog immediately.
- Cancelling the picker does not change request state or run describe.
- Existing manual path editing and the Describe button remain available.
- No unrelated refactoring or compatibility layer.

---

### Task 1: Native proto file picker and catalog loading

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs:27-31`
- Modify: `src-tauri/capabilities/default.json:6-10`
- Modify: `src/components/views/RequestView.tsx:1-108,243-280`
- Test: `src/components/requestWorkspace.test.mjs`

**Interfaces:**
- Consumes: `open({ multiple: true, filters: [{ name: "Protocol Buffers", extensions: ["proto"] }] })` from `@tauri-apps/plugin-dialog`.
- Produces: `describe(protoFiles?: string[]): Promise<void>` and `importProtoFiles(): Promise<void>` inside `RequestView`.

- [ ] **Step 1: Write the failing regression test**

Add a Node test that checks the dialog import, multi-select filter, state update, immediate describe, and wider class hooks:

```js
test("gRPC imports multiple proto files, describes them immediately, and uses readable selectors", async () => {
  const [view, styles, cargo, backend, capability] = await Promise.all([
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
    readFile(new URL("../src-tauri/Cargo.toml", root), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("../src-tauri/capabilities/default.json", root), "utf8"),
  ]);

  assert.match(view, /import \{ open \} from "@tauri-apps\/plugin-dialog"/);
  assert.match(view, /multiple: true/);
  assert.match(view, /extensions: \["proto"\]/);
  assert.match(view, /await describe\(files\)/);
  assert.match(view, />Import \.proto</);
  assert.match(view, /grpc-source-select/);
  assert.match(view, /grpc-catalog-select/);
  assert.match(styles, /\.grpc-source-select/);
  assert.match(styles, /\.grpc-catalog-select/);
  assert.match(cargo, /tauri-plugin-dialog/);
  assert.match(backend, /tauri_plugin_dialog::init/);
  assert.match(capability, /dialog:allow-open/);
});
```

- [ ] **Step 2: Run the regression test and verify failure**

Run: `node --test src/components/requestWorkspace.test.mjs`

Expected: FAIL because the dialog import and gRPC-specific classes do not exist.

- [ ] **Step 3: Install the official dialog plugin**

Run: `npm install @tauri-apps/plugin-dialog@^2.1.0`

Run: `cargo add tauri-plugin-dialog@2`

Expected: frontend and Rust manifests and lockfiles include the Tauri dialog plugin.

- [ ] **Step 4: Register and authorize the dialog plugin**

Add `.plugin(tauri_plugin_dialog::init())` beside the store plugin in `src-tauri/src/lib.rs` and add `"dialog:allow-open"` to `src-tauri/capabilities/default.json`.

- [ ] **Step 5: Implement shared describe and import behavior**

Import `open`, change `describe` to accept an optional `protoFiles` argument, and add:

```tsx
const importProtoFiles = async () => {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Protocol Buffers", extensions: ["proto"] }],
  });
  if (!selected) return;
  const files = Array.isArray(selected) ? selected : [selected];
  update({ grpc: { ...grpc!, protoSource: "files", protoFiles: files } });
  await describe(files);
};
```

Render an `Import .proto` button beside the proto path and Describe button. Add `grpc-source-select` to the source selector and `grpc-catalog-select` to service and method selectors.

- [ ] **Step 6: Add responsive widths**

Add scoped rules in `src/styles/requestsmin.css`:

```css
.request-head .grpc-source-select { width: 144px; }
.grpc-catalog-row { min-width: 0; display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.grpc-catalog-select { width: clamp(220px, 32vw, 420px); min-width: 0; }
```

Use `grpc-catalog-row` instead of the inline row styles. At narrow available widths, selectors can shrink rather than overflow.

- [ ] **Step 7: Run focused tests**

Run: `node --test src/components/requestWorkspace.test.mjs`

Expected: all tests pass.

- [ ] **Step 8: Run full verification**

Run: `npm run build`

Expected: TypeScript and Vite build complete successfully.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests pass.
