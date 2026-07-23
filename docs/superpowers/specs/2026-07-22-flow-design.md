# Flow — E2E API scenario runner (design)

Date: 2026-07-22 · Status: proposal, chưa implement

## 1. Bối cảnh: source hiện tại (đã đọc trực tiếp)

Stack: Tauri 2 + React 18 + Zustand (một store `useApp`) + Monaco. Không router, không dnd-lib, không animation-lib. Backend Rust: `http.rs`, `grpc.rs`, `collection.rs`, `ws.rs`…

Các facts quyết định thiết kế:

| Fact (file) | Hệ quả cho Flow |
|---|---|
| `Request = {name, protocol, http?, grpc?, ws?}` là JSON tự chứa, lưu file `~/RequestsMin/collections/<id>/<relPath>` (`api.ts`, `collection.rs`) | Snapshot = `structuredClone(request)` — miễn phí |
| Env resolve (`{{var}}`) nằm ở **Rust**: FE chỉ gửi tên env, backend đọc env + secrets rồi `interpolate`, **error khi thiếu var** (`collection.rs:86`, `http.rs:112`) | FE phải resolve `{{steps.*}}`/`{{vars.*}}` TRƯỚC khi invoke, để lại `{{envVar}}` cho backend → MVP không cần sửa backend |
| `grpc_unary(env, part)` — chỉ unary; streaming flags có trong catalog nhưng chưa chạy (`grpc.rs`) | Flow v1 chỉ hỗ trợ gRPC unary |
| WS là dạng session tương tác (connect/send), `runActiveRequest` từ chối ws | Loại WS khỏi Flow v1 |
| Sidebar drag dùng HTML5 `dataTransfer` payload JSON `{kind:"request", collectionId, relPath}` (`Sidebar.tsx:240`) | Canvas chỉ cần `onDrop` đọc cùng payload — không cần dnd lib |
| Tab system: `TabDef{kind}`, request tab multi-instance qua `requestTabs: Record<id, RequestTabState>`; view giữ sống bằng prop `active` (`store.ts`, `App.tsx`) | Thêm `kind: "flow"` + `flowTabs` theo đúng pattern |
| `RequestView` chỉ phụ thuộc store qua `requestTabs[tabId]` (`RequestView.tsx:77`) | Panel edit node request tái dùng được `RequestView` qua adapter (entry ephemeral trong `requestTabs`) |
| History sanitize secrets + cap body 50k trước khi vào localStorage (`store.ts:143`) | Run result của Flow tái dùng `sanitizeForStorage`/cap pattern |
| Cookie jar dùng chung toàn app (`http.rs:11`) | Step trong flow tự động dính cookie của nhau (thường là điều muốn) — ghi rõ trong docs |
| `grpc` request có `sourceId` → ProtoSource dùng chung, backend đọc từ disk lúc chạy | Proto source KHÔNG snapshot được nếu không sửa backend → v1 coi proto source là "infra" (như env), giữ reference |
| Timeout HTTP cố định connect 8s / total 60s trong backend; không có lệnh abort | Per-step timeout FE bằng `Promise.race` (request thật vẫn chạy hết ở backend); abort thật = phase 3 |

## 2. Tên feature

**Flow** (đề xuất). Ngắn, hợp tab title, thư mục `flows/`, quen thuộc (Postman Flows). "Scenario" nghiêng về testing — một Flow cụ thể user có thể tự đặt tên "Scenario: signup". "Workflow" dài và trùng nghĩa CI.

## 3. UX

- **Saved Flows** là một workspace tab singleton (như Collections/History): list flow đã lưu + New / Open / Rename / Duplicate / Delete / **Export**. Entry "Saved Flows" thêm vào WORKSPACE_NAV của sidebar. Click flow → mở flow tab.
- **Export flow**: nút Export trong Saved Flows → save dialog (`@tauri-apps/plugin-dialog` đã có) → backend copy file flow JSON (self-contained, snapshot nằm trong file) ra đường dẫn chọn.
- **⌘Enter** khi flow tab active = chạy **cả flow**. Chạy một node riêng: click node → nút ▶ trên node/panel.
- Flow tab (multi-instance như request tab): toolbar (Run ▶ / Cancel ■ / env hiển thị từ statusbar hiện có / Save ⌘S / trạng thái dirty) + canvas chiếm phần chính + panel phải (chi tiết node được chọn) + drawer dưới (Run report, mở sau khi chạy).
- Kéo request từ sidebar thả vào canvas → tạo request node (snapshot tại thời điểm thả). Toolbar nút "+ node" cho các block khác.
- Node hiển thị: icon protocol, step key (`login`), method/URL rút gọn, badge trạng thái. Trạng thái: `idle | running | success | failed | skipped` → class CSS trên node; edge đang truyền dữ liệu dùng animated edge của React Flow (SVG dash animation, không cần lib).
- Panel chi tiết node request: tab **Edit** (mount `RequestView` qua adapter) / **Resolved input** (request sau khi thay steps.* + env, secrets che `••••` như `resolveRequestTarget`) / **Response** (status, headers, body, timing — tái dùng `JsonResponseViewer`).
- Run report: bảng step → status/time/assertion pass-fail, tổng thời gian, click row nhảy tới node, response cuối của scenario.

## 4. Data model

Lưu file: `~/RequestsMin/flows/<id>.json` (cạnh `collections/`, `environments/`).

```ts
interface Flow {
  version: 1;
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface FlowNode {
  id: string;            // nội bộ, bất biến
  key: string;           // step key user đặt, unique, dùng trong {{steps.<key>...}}
  type: "request" | "delay" | "transform" | "setVars" | "condition" | "assert" | "log";
  position: { x: number; y: number };
  config: NodeConfig;    // union theo type
}

// request node
{
  request: Request;                       // SNAPSHOT — structuredClone lúc thả
  origin?: { collectionId; relPath };     // chỉ để hiển thị "from …" + nút re-sync thủ công
  timeoutMs?: number;
  retry?: { count: number; delayMs: number };
  onError?: "stop" | "continue";          // default stop
}
// delay:     { ms: number }
// transform: { code: string }            // body của (steps, vars) => object, merge vào vars
// setVars:   { entries: {key, value}[] } // value hỗ trợ {{...}}
// condition: { expr: string }            // boolean, 2 out-handle true/false
// assert:    { checks: {path, op: "eq"|"neq"|"contains"|"exists"|"lt"|"gt", expected}[] }
// log:       { template: string }

interface FlowEdge { id: string; source: string; target: string; sourceHandle?: "true" | "false" }
```

Runtime (không lưu vào file flow):

```ts
interface StepResult {
  status: "idle" | "running" | "success" | "failed" | "skipped";
  startedAt?: number; timeMs?: number;
  resolvedRequest?: Request;              // input đã resolve (secrets che khi persist)
  response?: HttpResponse | GrpcResponse;
  error?: string;
  assertions?: { desc: string; pass: boolean; actual?: string }[];
  vars?: Record<string, unknown>;         // output của transform/setVars
}
interface FlowRun {
  id: string; startedAt: number; totalMs?: number;
  status: "running" | "success" | "failed" | "cancelled";
  steps: Record<nodeId, StepResult>;
}
```

`FlowTabState` (zustand, mirror `RequestTabState`): `{ flowId, flow, original: string, dirty, run: FlowRun | null, running, selectedNodeId }`. Dirty = so JSON như `computeDirty`. Session persist flow tabs như request tabs (run bị drop). Last run có thể persist sanitize-hoá (phase 2).

## 5. Execution engine

`src/lib/flow/engine.ts` — thuần TS frontend, mirror pattern `runRequest.ts` (đọc/ghi store qua `useApp.getState()`).

1. **Validate** trước khi chạy: topo-sort (Kahn) — fail = cycle; cảnh báo node mồ côi; step key trùng; node ws.
2. Chạy **tuần tự theo topo order**. Node chỉ chạy khi ≥1 incoming edge "active" (edge active khi source success/continue-on-error và, với condition, đúng nhánh). Không thỏa → `skipped`.
3. Request node: clone snapshot → thay `{{steps.*}}`/`{{vars.*}}` (FE) → `api.httpRequest(env, resolved)` hoặc `api.grpcUnary(env, resolved.grpc)` (env backend resolve như cũ) → lưu StepResult. Retry loop + `Promise.race` timeout ở FE.
4. Context tham chiếu: `steps.<key>.response.status | .body (JSON.parse nếu được) | .bodyText | .headers.<name> | .timeMs`, `steps.<key>.request…`, và `vars.<name>`. Path resolve bằng hàm dot-path nhỏ (~20 dòng), không cần JSONPath lib.
5. `transform`/`condition`/`assert` expr chạy bằng `new Function("steps", "vars", code)` trong webview (app local, code của chính user — chấp nhận; wrap try/catch thành step fail).
6. **Cancel**: cờ trên FlowRun, check giữa các step; delay dùng sleep chia nhỏ/abortable. Request đang bay không hủy được (backend chưa hỗ trợ) — UI ghi "cancelling…" đến khi step hiện tại xong. Abort thật: phase 3 (thêm lệnh cancel + `tokio::select` trong `http_request`).
7. Run-from-node / rerun-one-node: dùng `steps` của run trước cho phần upstream, đánh dấu "stale" trong report (phase 2).

Env resolve 2 tầng — quyết định quan trọng nhất: **FE chỉ resolve `steps.*`/`vars.*`; `{{envVar}}` để nguyên cho backend** như request thường → không đụng `interpolate`/secrets ở Rust, MVP zero backend-change cho execution path.

## 6. Backend thay đổi (MVP)

Chỉ CRUD: `flows.rs` mới ~60 dòng — `flow_list`, `flow_read`, `flow_write`, `flow_delete` mirror `req_*` (dùng `write_sorted_json`, `safe_join` sẵn có). GitHub sync cho `flows/`: phase 2.

## 7. Package

- **`@xyflow/react`** (React Flow 12, MIT, React 18 OK): duy nhất một dep mới. Cho sẵn pan/zoom/drag/edge-routing/minimap/animated-edges/custom-node = React component. Tự viết = ~1.5–2k dòng SVG math — không đáng.
- Animation: React Flow animated edge + CSS keyframes cho viền node running (theme vars sẵn có). **Không** GSAP/Framer.
- Không thêm gì khác: dnd = HTML5 sẵn có, path resolve + topo sort tự viết vài chục dòng.

## 8. Tổ chức module

```
src/lib/flow/
  types.ts       # Flow, FlowNode, FlowRun…
  stepRefs.ts    # thay {{steps.*}}/{{vars.*}}, dot-path resolver  (+ .test.mjs)
  validate.ts    # topo sort, cycle, key trùng                    (+ .test.mjs)
  engine.ts      # run/cancel, retry/timeout
src/components/flow/
  FlowCanvas.tsx, nodes/*.tsx, NodePanel.tsx, RunReport.tsx
src/components/views/FlowView.tsx
src-tauri/src/flows.rs
store.ts         # kind "flow", flowTabs + action mirror requestTabs
Sidebar.tsx      # group Flows
```

Adapter edit-node: mount `RequestView` với entry ephemeral `requestTabs["flow:<tabId>:<nodeId>"]`, sync hai chiều với node snapshot; `saveSession` bỏ qua id prefix `flow:`. Nếu hoá ra kẹt (run/save shortcut trong RequestView trỏ nhầm ngữ cảnh) → fallback: panel tự ghép từ `KvEditor`/`JsonEditor`/`EnvInput`/`Combobox` sẵn có.

## 9. Rủi ro / edge case / giới hạn v1

- Token `{{steps.x}}` chưa resolve lọt xuống backend → lỗi "missing variables: steps.x" khó hiểu. Engine phải resolve hoặc fail sớm với message rõ ("step 'x' chưa chạy / path sai").
- Response không phải JSON → `.body` path fail: cung cấp cả `.bodyText`, message lỗi nêu content-type.
- Secrets có thể lọt vào `resolvedRequest`/response trong run result → sanitize trước khi persist (tái dùng `sanitizeForStorage` + cap 50k).
- gRPC `sourceId`: proto source là shared config — sửa source gốc ảnh hưởng flow (khác lời hứa snapshot). V1 ghi rõ: snapshot = nội dung request; env + proto source là live reference. Inline hoá cần sửa `grpc_unary` — phase sau.
- Cancel không hủy request đang bay; per-step timeout FE không cắt socket backend (60s cap của backend vẫn là trần thật).
- Cookie jar chung: flow ↔ manual request chia sẻ cookies.
- Condition merge: node có nhiều incoming — chạy khi ≥1 edge active (semantics OR, ghi rõ trong docs).
- Chỉ gRPC unary; không WS; không chạy song song (tuần tự); một run mỗi flow tab.
- Expr `new Function`: lỗi runtime user-code → step fail, không crash app.
- localStorage quota: run không persist mặc định ở MVP.

## 10. Phases

**Phase 1 — MVP (dùng được thật):** flows.rs CRUD + export; Saved Flows tab; tab kind flow + flowTabs + session; canvas React Flow, drop từ sidebar (snapshot), nối edge, xoá node/edge; node: request + delay; engine tuần tự + steps.*/vars resolve + validate cycle + cancel-giữa-step; node status màu + animated edge khi chạy; NodePanel (edit qua adapter, resolved input, response); save/rename/duplicate flow; ⌘Enter chạy flow khi tab flow active.

**Phase 2:** node transform / setVars / condition / assert / log; retry + timeout per step; RunReport drawer đầy đủ + persist last run (sanitized); run-from-node + rerun node với data run trước; GitHub sync flows/; export report JSON.

**Phase 3:** abort request thật (backend cancel command); gRPC streaming; nhánh song song; run history view; CLI/headless run.

## Quyết định đã chốt (2026-07-22)

1. Flow lưu **top-level** `~/RequestsMin/flows/`, quản lý trong tab **Saved Flows**; GitHub sync phase 2.
2. `⌘Enter` = chạy **cả flow**; chạy một node = click node rồi bấm ▶ của node đó.
3. **Export flow** thuộc Phase 1 (save dialog + copy file JSON).
4. Assert node riêng (phase 2).
