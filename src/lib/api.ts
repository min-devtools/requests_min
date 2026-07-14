import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface KV { key: string; value: string; enabled?: boolean }

export interface HttpAuth {
  type: "none" | "bearer" | "basic" | "apiKey";
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: "header" | "query";
}
export interface HttpBody {
  type: "none" | "json" | "text" | "form";
  content?: string;
  fields?: KV[];
}
export interface HttpPart {
  method: string;
  url: string;
  headers: KV[];
  params: KV[];
  auth: HttpAuth;
  body: HttpBody;
  insecure: boolean;
}
export interface GrpcPart {
  endpoint: string;
  protoSource: "reflection" | "files";
  protoFiles: string[];
  service: string;
  method: string;
  message: string;
  metadata: KV[];
  insecure: boolean;
}
export interface WsPart { url: string; headers: KV[]; savedMessages: string[] }

export interface Request {
  name: string;
  protocol: "http" | "grpc" | "ws";
  http?: HttpPart;
  grpc?: GrpcPart;
  ws?: WsPart;
}
export interface CollectionMeta { id: string; name: string; order: string[] }
export interface ReqEntry { relPath: string; name: string; protocol: string; method: string }

export const emptyHttp = (): HttpPart => ({
  method: "GET", url: "", headers: [], params: [],
  auth: { type: "none" }, body: { type: "none" }, insecure: false,
});
export const emptyGrpc = (): GrpcPart => ({
  endpoint: "", protoSource: "reflection", protoFiles: [], service: "", method: "",
  message: "{}", metadata: [], insecure: false,
});
export const emptyWs = (): WsPart => ({ url: "", headers: [], savedMessages: [] });
export const emptyRequest = (protocol: Request["protocol"] = "http", name = "New request"): Request => ({
  name,
  protocol,
  http: protocol === "http" ? emptyHttp() : undefined,
  grpc: protocol === "grpc" ? emptyGrpc() : undefined,
  ws: protocol === "ws" ? emptyWs() : undefined,
});

let onMutate: (() => void) | undefined;
export const setOnMutate = (cb: () => void) => { onMutate = cb; };
const mutated = <T,>(p: Promise<T>): Promise<T> => p.then((v) => { onMutate?.(); return v; });

export const api = {
  ping: () => invoke<string>("ping"),
  listFonts: () => invoke<string[]>("list_fonts"),
  colList: () => invoke<CollectionMeta[]>("col_list"),
  colCreate: (name: string) => mutated(invoke<CollectionMeta>("col_create", { name })),
  colRename: (id: string, name: string) => mutated(invoke<void>("col_rename", { id, name })),
  colDelete: (id: string) => mutated(invoke<void>("col_delete", { id })),
  reqList: (collectionId: string) => invoke<ReqEntry[]>("req_list", { collectionId }),
  reqRead: (collectionId: string, relPath: string) => invoke<Request>("req_read", { collectionId, relPath }),
  reqWrite: (collectionId: string, relPath: string, request: Request) => mutated(invoke<void>("req_write", { collectionId, relPath, request })),
  reqDelete: (collectionId: string, relPath: string) => mutated(invoke<void>("req_delete", { collectionId, relPath })),
  reqMove: (collectionId: string, from: string, to: string) => mutated(invoke<void>("req_move", { collectionId, from, to })),
  envList: () => invoke<string[]>("env_list"),
  envRead: (env: string) => invoke<Record<string, string>>("env_read", { env }),
  envWrite: (env: string, vars: Record<string, string>) => mutated(invoke<void>("env_write", { env, vars })),
  envDelete: (env: string) => mutated(invoke<void>("env_delete", { env })),
  secretRead: (env: string) => invoke<Record<string, string>>("secret_read", { env }),
  secretWrite: (env: string, vars: Record<string, string>) => invoke<void>("secret_write", { env, vars }),
  httpRequest: (env: string | null, request: Request) =>
    invoke<HttpResponse>("http_request", { env, request }),
  wsConnect: (sessionId: string, url: string, headers: KV[]) => invoke<void>("ws_connect", { sessionId, url, headers }),
  wsSend: (sessionId: string, text: string) => invoke<void>("ws_send", { sessionId, text }),
  wsClose: (sessionId: string) => invoke<void>("ws_close", { sessionId }),
  grpcDescribe: (endpoint: string | null, protoFiles: string[], insecure: boolean) =>
    invoke<GrpcCatalog>("grpc_describe", { endpoint, protoFiles, insecure }),
  grpcUnary: (env: string | null, part: GrpcPart) =>
    invoke<GrpcResponse>("grpc_unary", { env, part }),
  importCurl: (text: string) => invoke<Request>("import_curl", { text }),
  importPostman: (text: string) => invoke<CollectionDraft>("import_postman", { text }),
  importOpenapi: (text: string) => invoke<CollectionDraft>("import_openapi", { text }),
  exportPostman: (collectionId: string) => invoke<string>("export_postman", { collectionId }),
  exportCurl: (collectionId: string, relPath: string) => invoke<string>("export_curl", { collectionId, relPath }),
  colSaveDraft: (draft: CollectionDraft) => mutated(invoke<CollectionMeta>("col_save_draft", { draft })),
  aiScan: (dir: string) => invoke<ScanResult>("ai_scan", { dir }),
  aiGenerate: (files: string[], endpoint: string, apiKey: string, model: string) =>
    invoke<DraftEntry[]>("ai_generate", { files, endpoint, apiKey, model }),
  ghSetToken: (token: string) => invoke<void>("gh_set_token", { token }),
  ghStatus: () => invoke<GhStatus>("gh_status"),
  ghConfigure: (repo: string) => invoke<void>("gh_configure", { repo }),
  ghPush: (message: string | null) => invoke<string>("gh_push", { message }),
  ghPull: (force: boolean) => invoke<PullResult>("gh_pull", { force }),
};

export interface ScanHit { path: string; reason: string }
export interface ScanResult { files: ScanHit[]; truncated: boolean }
export interface GhStatus { connected: boolean; login: string | null; repo: string | null; lastSha: string | null }
export interface PullResult { updated: boolean; conflict: boolean; remoteSha: string }

export interface DraftEntry { relPath: string; request: Request }
export interface CollectionDraft { name: string; requests: DraftEntry[] }

export interface GrpcMethod { name: string; inputType: string; outputType: string; clientStreaming: boolean; serverStreaming: boolean; inputTemplate: string }
export interface GrpcService { name: string; methods: GrpcMethod[] }
export interface GrpcCatalog { services: GrpcService[] }
export interface GrpcResponse { statusCode: string; headers: KV[]; trailers: KV[]; bodyJson: string; timeMs: number }

export interface HttpResponse { status: number; headers: KV[]; body: string; timeMs: number; sizeBytes: number }
export interface WsEvent { kind: "open" | "message" | "closed" | "error"; data: string; ts: number }
export const onWsEvent = (sessionId: string, cb: (e: WsEvent) => void) =>
  listen(`ws:${sessionId}`, (ev) => cb(ev.payload as WsEvent));
