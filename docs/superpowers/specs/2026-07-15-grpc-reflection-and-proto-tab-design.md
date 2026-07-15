# gRPC: reflection in path bar + Proto tab

**Date:** 2026-07-15
**File touched:** `src/components/views/RequestView.tsx` (+ small CSS in `src/styles/requestsmin.css`)
**Backend / data model:** unchanged.

## Problem

gRPC needs a schema source — either **reflection** (endpoint) or **.proto files**. Today a `protoSource` `<select>` in the path bar switches between the two, so the endpoint input and the files input are mutually exclusive. Filling both means switching the select back and forth. Annoying.

Note: `endpoint` is always the send target regardless of source (backend sends the RPC to `endpoint` even when the schema comes from files). Only the *schema source* differs.

## Goal

Endpoint and proto files visible at the same time, no mode-switch:

- **Path bar** always shows the reflection **endpoint** input + a **Describe** button.
- **Proto files** move into a new **Proto** tab beside `Message` / `Metadata`.
- The Proto tab holds Import + the file list + its own Describe.

## Source resolution — last Describe wins

`protoSource` stays in the model but is no longer a user-facing toggle. It is set implicitly by whichever Describe the user last ran:

- Path-bar **Describe** → `protoSource = "reflection"`, describes from `endpoint`.
- Proto tab **Describe** / **Import** → `protoSource = "files"`, describes from `protoFiles`.

Send (`grpc_unary`) already reads `part.proto_source`; setting it on describe is enough. No backend change.

## UI changes (`RequestView.tsx`)

### 1. Path bar (`request.protocol === "grpc"` head)

Remove the `protoSource` `<select>`, the files text input, and the files-only Import button. Result:

```
[ endpoint EnvInput  {{grpcHost}}:50051 ] [ Describe ]
```

Describe button calls `describe("reflection")`.

### 2. Editor tabs

Add a third tab after Metadata:

```
Message   Metadata {n}   Proto {protoFiles.length}
```

New `editorTab` union member: `"proto"`. Count badge shows `grpc.protoFiles.length`.

### 3. Proto tab body (`editorTab === "proto"`)

Replaces the JSON editor area. Layout:

- **Import .proto** button (opens the native multi-file `.proto` dialog — existing `importProtoFiles`).
- **File list**: one row per `protoFiles` entry — the path + a ✕ button that removes that entry from `protoFiles`.
- **Describe** button → `describe("files")`, disabled when `protoFiles` is empty.
- Empty state (`protoFiles.length === 0`): an `.empty-note` — "No .proto files. Import to load."

Manual comma-path text editing is dropped — Import is the path. (Add back only if requested.)

### 4. `describe` refactor

```ts
const describe = async (source: "reflection" | "files", selectedFiles?: string[]) => {
  if (!request.grpc) return;
  setDescribing(true);
  try {
    const files = source === "files" ? (selectedFiles ?? request.grpc.protoFiles) : [];
    const endpoint = source === "reflection" ? request.grpc.endpoint : null;
    const c = await api.grpcDescribe(endpoint, files, request.grpc.insecure);
    setCatalog(c);
    update({ grpc: { ...request.grpc, protoSource: source } }); // last describe wins
    showToast("Described", `${c.services.length} service(s) found.`);
  } catch (err) {
    showToast("Describe failed", String(err), "err");
  } finally {
    setDescribing(false);
  }
};
```

`importProtoFiles` sets `protoFiles` (source no longer forced in the setter) then calls `describe("files", files)`.

The shared `describing` flag disables both Describe buttons while a describe is in flight — acceptable (only one runs at a time).

### 5. Service/method pickers

Unchanged — stay in the `.editor-tabs` row, render when `catalog` exists, fed by whichever Describe ran last.

## CSS (`requestsmin.css`)

Small block for the Proto panel: file-row (path + remove button) and the Import/Describe button row. Reuse `.empty-note`, `.tool-btn`/`ToolButton`, and existing spacing tokens. No new layout primitives.

## Testing

- `describe("reflection")` with an endpoint → catalog populated, `protoSource === "reflection"`.
- `describe("files")` / Import → `protoSource === "files"`, pickers update.
- Switching which Describe you run flips the effective source with no select.
- Proto tab count badge reflects `protoFiles.length`; ✕ removes a file.
- Existing gRPC send still resolves schema via `part.proto_source`.

Extend the existing `requestWorkspace.test.mjs` gRPC cases where they cover describe/source; add a case asserting `protoSource` follows the last describe.

## Out of scope

- Backend / `GrpcPart` model changes.
- Per-file enable/disable, drag-reorder of proto files.
- Manual path text entry.
