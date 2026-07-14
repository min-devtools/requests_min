# RequestsMin

Postman/Bruno-like desktop API client with an ElasticMin-family, keyboard-first desktop UI.

## Stack

- **Shell**: Tauri 2 (Rust backend)
- **Frontend**: React 18 + TypeScript + Vite with the shared ElasticMin design language
- **Persistence**: plain files under `~/RequestsMin/` (see below); GitHub PAT + sync state via tauri-plugin-store (`gh.json`)
- **REST**: reqwest · **WebSocket**: tokio-tungstenite · **gRPC**: tonic + prost-reflect (dynamic messages) + protox (pure-Rust `.proto` compile, no `protoc`)

## Features (backend commands)

| Area | Commands |
|---|---|
| Collections | `col_list/create/rename/delete` |
| Requests | `req_list/read/write/delete/move` |
| Environments | `env_list/read/write/delete` |
| Secrets (local-only) | `secret_read/write` |
| REST | `http_request` |
| WebSocket | `ws_connect/send/close` + `ws:{sessionId}` events |
| gRPC (unary) | `grpc_describe`, `grpc_unary` |
| Import | `import_curl`, `import_postman`, `import_openapi` |
| Export | `export_postman`, `export_curl` |
| Draft save | `col_save_draft` |
| AI from source | `ai_scan`, `ai_generate` |
| GitHub sync | `gh_set_token/status/configure/push/pull` |

Every command returns `Result<T, String>`. Typed wrappers in `src/lib/api.ts`.

## Data on disk

```
~/RequestsMin/
  collections/<id>/
    collection.json              # { id, name, order }
    environments/<env>.json      # { "vars": { ... } }
    <folder>/<request>.json      # one request per file (http | grpc | ws)
  secrets/<id>/<env>.json        # { "vars": { ... } } — LOCAL ONLY, never exported/pushed
```

`{{var}}` is resolved in Rust at send time (precedence: secrets > env vars; unresolved = error listing missing names).
JSON is written with sorted keys + trailing newline for clean diffs.
Override the data root with env `REQUESTS_MIN_HOME` (tests use a tempdir).

Secrets live **outside** `collections/`, so GitHub push/export cannot leak them by construction.

## Run

```bash
npm install
npm run tauri dev      # dev app (smoke page)
npm run tauri build    # release bundle
```

Build and ad-hoc sign an internal Apple Silicon macOS app:

```bash
./bundle-macos.sh
```

Output: `src-tauri/target/release/bundle/macos/RequestsMin.app`.

Replace `src/assets/logo.png` with a square PNG (1024×1024 recommended) before bundling. The script regenerates every Tauri platform icon from this source and the same image is used in the app titlebar.

Rust tests (pure logic — importers, curl parser, interpolation, sorted writer, gRPC dynamic roundtrip, tree collection):

```bash
cd src-tauri && cargo test
```

## Module layout

```
src-tauri/src/
  lib.rs          command registration
  collection.rs   model, file I/O, {{var}} interpolation
  secrets.rs      local-only env secrets
  http.rs         REST runner
  ws.rs           WebSocket sessions + Tauri events
  grpc.rs         reflection / .proto describe + dynamic unary call
  import/         curl.rs, postman.rs, openapi.rs (+ export in postman.rs/curl.rs)
  ai.rs           source scan + LLM (OpenAI-compatible) generate
  github.rs       Git Data API push/pull (single repo as storage)
src/lib/api.ts    typed invoke() wrappers
```

## Status

Backend and desktop UI are integrated. The UI includes REST/gRPC/WebSocket workspaces, collections, environments, request history, import/export, AI import, GitHub sync, settings, command palette, resizable panels, compact density, and light/dark themes.
Protocol runners (REST/WS/gRPC) and GitHub sync are manually smoke-tested via the dev app.
