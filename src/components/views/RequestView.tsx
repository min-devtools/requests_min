import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { KvEditor } from "../../ui/KvEditor";
import { JsonEditor } from "../../ui/JsonEditor";
import { JsonView } from "../../ui/JsonView";
import { SectionVeil } from "../../ui/SectionVeil";
import { JsonResponseViewer } from "../../ui/JsonResponseViewer";
import { EnvInput } from "../../ui/EnvInput";
import { Combobox } from "../../ui/Combobox";
import { LoadingBar } from "../../ui/LoadingBar";
import { startResize, toggleRequestEditorSize } from "../ResizeHandles";
import { useApp } from "../../store";
import {
  api, emptyGrpc, emptyHttp, emptyWs, onWsEvent,
  type GrpcCatalog, type KV, type ProtoSource, type Request,
} from "../../lib/api";
import { mergeIntoTemplate } from "../../lib/protoMerge";
import { isGrpcurl, parseGrpcurl } from "../../lib/grpcurl";

// URL <-> Params two-way sync (Postman-style). Params are canonical for send (backend
// appends them to the base url); the URL bar is a derived view. Raw (no encoding) so
// {{vars}} stay readable — the backend encodes at send.
const splitUrl = (url: string) => {
  const q = url.indexOf("?");
  return q === -1 ? { base: url, query: "" } : { base: url.slice(0, q), query: url.slice(q + 1) };
};
const extractPathParams = (url: string, previous: KV[] = []): KV[] => {
  const values = new Map(previous.map((param) => [param.key, param]));
  const names = [...url.matchAll(/\/:([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  return [...new Set(names)].map((key) => values.get(key) ?? { key, value: "", enabled: true });
};
const renderPathParams = (url: string, params: KV[] = []): string =>
  params.filter((param) => param.enabled !== false && param.key)
    .reduce((target, param) => target.replaceAll(`:${param.key}`, param.value), url);
const safeDecode = (s: string): string => {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
};
const queryToParams = (query: string): KV[] =>
  query === "" ? [] : query.split("&").map((seg) => {
    const eq = seg.indexOf("=");
    return eq === -1
      ? { key: safeDecode(seg), value: "", enabled: true }
      : { key: safeDecode(seg.slice(0, eq)), value: safeDecode(seg.slice(eq + 1)), enabled: true };
  });
const paramsToQuery = (params: KV[]): string =>
  params.filter((p) => p.enabled !== false && (p.key || p.value)).map((p) => `${p.key}=${p.value}`).join("&");
const fullUrl = (base: string, params: KV[]): string => {
  const q = paramsToQuery(params);
  return q ? `${splitUrl(base).base}?${q}` : base;
};

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

// Mirrors the backend's prepare_http: auth tab wins, form body is urlencoded.
export function buildCurl(request: Request): string {
  if (!request.http) return "";
  const h = request.http;
  const auth = h.auth;
  let url = fullUrl(renderPathParams(h.url, h.pathParams), h.params);
  if (auth.type === "apiKey" && auth.addTo === "query" && auth.key) {
    url += `${url.includes("?") ? "&" : "?"}${auth.key}=${auth.value ?? ""}`;
  }
  const parts = [`curl -X ${h.method} ${shellQuote(url)}`];
  for (const kv of h.headers) if (kv.enabled !== false && kv.key) parts.push(`-H ${shellQuote(`${kv.key}: ${kv.value}`)}`);
  if (auth.type === "bearer" && auth.token) parts.push(`-H ${shellQuote(`Authorization: Bearer ${auth.token}`)}`);
  if (auth.type === "basic" && (auth.username || auth.password)) parts.push(`-u ${shellQuote(`${auth.username ?? ""}:${auth.password ?? ""}`)}`);
  if (auth.type === "apiKey" && (auth.addTo ?? "header") === "header" && auth.key) parts.push(`-H ${shellQuote(`${auth.key}: ${auth.value ?? ""}`)}`);
  if ((h.body.type === "json" || h.body.type === "text") && h.body.content) parts.push(`-d ${shellQuote(h.body.content)}`);
  if (h.body.type === "form") {
    for (const f of h.body.fields ?? []) if (f.enabled !== false && f.key) parts.push(`--data-urlencode ${shellQuote(`${f.key}=${f.value}`)}`);
  }
  return parts.join(" \\\n  ");
}

export function buildGrpcurl(request: Request): string {
  if (!request.grpc) return "";
  const grpc = request.grpc;
  const target = grpc.endpoint.replace(/^https?:\/\//, "");
  const parts = ["grpcurl"];
  if (!grpc.endpoint.startsWith("https://")) parts.push("-plaintext");
  for (const file of grpc.protoFiles) parts.push("-proto", shellQuote(file));
  for (const item of grpc.metadata) if (item.enabled !== false && item.key) parts.push("-H", shellQuote(`${item.key}: ${item.value}`));
  parts.push("-d", shellQuote(grpc.message || "{}"), target, `${grpc.service}/${grpc.method}`);
  return parts.join(" ");
}

export function RequestView({ tabId, active, embedded = false }: { tabId: string; active: boolean; embedded?: boolean }) {
  const rt = useApp((s) => s.requestTabs[tabId]);
  const updateRequestTab = useApp((s) => s.updateRequestTab);
  const showToast = useApp((s) => s.showToast);
  const [editorTab, setEditorTab] = useState<"body" | "headers" | "auth" | "params" | "cookies" | "metadata" | "proto">("body");
  const [urlDraft, setUrlDraft] = useState<string | null>(null); // local while typing the URL, so it isn't reformatted mid-edit
  const [responseTab, setResponseTab] = useState<"pretty" | "headers" | "cookies" | "raw" | "preview">("pretty");
  const [reqCookies, setReqCookies] = useState<KV[]>([]);
  const [catalog, setCatalog] = useState<GrpcCatalog | null>(null);
  const [describing, setDescribing] = useState(false);
  const [descError, setDescError] = useState<string | null>(null); // persists in the panel; toasts vanish
  const [protoMenu, setProtoMenu] = useState<{ x: number; y: number } | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null); // source rename buffer, saved on blur
  const [wsLog, setWsLog] = useState<{ dir: "out" | "in" | "sys"; text: string; ts: number }[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsDraft, setWsDraft] = useState("");
  const wsLogRef = useRef<HTMLDivElement>(null);
  const [variableNames, setVariableNames] = useState<string[]>([]);
  const wsSid = useMemo(() => `ws-${tabId}`, [tabId]);
  const env = useApp((s) => s.activeEnv);
  const envVersion = useApp((s) => s.envVersion);
  const protoSources = useApp((s) => s.protoSources);
  const reloadProtoSources = useApp((s) => s.reloadProtoSources);
  const openConfirm = useApp((s) => s.openConfirm);
  const requestHorizontal = useApp((s) => s.requestHorizontal);
  const toggleRequestLayout = useApp((s) => s.toggleRequestLayout);

  useEffect(() => {
    if (!env) { setVariableNames([]); return; }
    Promise.all([api.envRead(env), api.secretRead(env)])
      .then(([vars, secrets]) => setVariableNames([...new Set([...Object.keys(vars), ...Object.keys(secrets)])]))
      .catch(() => setVariableNames([]));
  }, [env, envVersion]);

  // Open a gRPC request → load its source's catalog straight from the backend cache or describe endpoint
  useEffect(() => {
    const g = rt?.request.grpc;
    if (!g) return;
    let live = true;

    const matchedSource = g.sourceId ? null : protoSources.find((source) => {
      if (g.protoFiles.length > 0 && source.kind === "files") {
        return source.files.length === g.protoFiles.length && source.files.every((f) => g.protoFiles.includes(f));
      }
      if (source.endpoint && g.endpoint) {
        const cleanSrc = source.endpoint.replace(/^grpcs?:\/\//i, "").replace(/^https?:\/\//i, "").trim().toLowerCase();
        const cleanReq = g.endpoint.replace(/^grpcs?:\/\//i, "").replace(/^https?:\/\//i, "").trim().toLowerCase();
        return Boolean(cleanSrc) && cleanSrc === cleanReq;
      }
      return false;
    });

    const sid = g.sourceId || matchedSource?.id;
    if (!sid && !g.endpoint.trim() && g.protoFiles.length === 0) return;

    setDescribing(true);
    const useSource = !!sid;
    api.grpcDescribe(env, sid ?? null, false, useSource ? null : g.endpoint, useSource ? [] : g.protoFiles, g.insecure)
      .then((c) => {
        if (live) {
          setCatalog(c);
          setDescError(null);
          if (matchedSource && !g.sourceId) {
            updateGrpc({ sourceId: matchedSource.id });
          }
        }
      })
      .catch((e) => { if (live) { setDescError(String(e)); } })
      .finally(() => { if (live) setDescribing(false); });
    return () => { live = false; };
  }, [tabId, rt?.request.grpc?.sourceId, rt?.request.grpc?.endpoint, rt?.request.grpc?.service, env, envVersion, protoSources]);

  // close the proto "New source" menu on any outside click (same pattern as RequestContextMenu)
  useEffect(() => {
    if (!protoMenu) return;
    const close = () => setProtoMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [protoMenu]);

  // ponytail: 1000-entry cap keeps long ws sessions from growing the DOM/state unbounded
  const pushWs = (dir: "out" | "in" | "sys", text: string) =>
    setWsLog((l) => [...l.slice(-999), { dir, text, ts: Date.now() }]);

  useEffect(() => {
    const p = onWsEvent(wsSid, (e) => {
      if (e.kind === "open") { setWsConnected(true); pushWs("sys", "connected"); }
      if (e.kind === "message") pushWs("in", e.data);
      if (e.kind === "closed") { setWsConnected(false); pushWs("sys", "closed"); }
      if (e.kind === "error") pushWs("sys", `error: ${e.data}`);
    });
    return () => {
      void p.then((unlisten) => unlisten());
      // closing the tab must close its socket — otherwise the backend stream
      // outlives the view and keeps burning until the app quits (idempotent)
      void api.wsClose(wsSid);
    };
  }, [wsSid]);

  // keep the newest ws message in view
  useEffect(() => { wsLogRef.current?.scrollTo(0, wsLogRef.current.scrollHeight); }, [wsLog.length]);

  // protocol can change from outside (the flow dock's Step-key protocol dropdown), so reset the
  // editor tab to a tab that exists in the new protocol instead of leaving a stale (e.g. "proto") one
  useEffect(() => { setEditorTab("body"); }, [rt?.request.protocol]);

  // cookies the jar will attach for this url (refresh on tab open / url change / after send)
  const reqUrl = rt?.request.http?.url ?? "";
  const lastResponse = rt?.response ?? null;
  useEffect(() => {
    if (editorTab !== "cookies") return;
    api.cookiesFor(reqUrl).then(setReqCookies).catch(() => setReqCookies([]));
  }, [editorTab, reqUrl, lastResponse]);

  // imported/loaded requests can have url path params (":id") with an empty pathParams
  // list (never touched in the Params tab) — normalize once so Send substitutes real
  // values instead of the literal ":id" segment, without waiting for a URL edit.
  useEffect(() => {
    if (!rt?.request.http) return;
    const derived = extractPathParams(rt.request.http.url, rt.request.http.pathParams);
    if (JSON.stringify(derived) === JSON.stringify(rt.request.http.pathParams ?? [])) return;
    updateRequestTab(tabId, { request: { ...rt.request, http: { ...rt.request.http, pathParams: derived } } });
  }, [tabId, reqUrl]);

  // pretty-printing a multi-MB body is too expensive to redo on every keystroke re-render
  const prettyBody = useMemo(() => {
    if (!lastResponse) return "";
    return tryPretty("body" in lastResponse ? lastResponse.body : lastResponse.bodyJson);
  }, [lastResponse]);

  if (!rt) return null;
  const request = rt.request;
  const httpPathParams = extractPathParams(request.http?.url ?? "", request.http?.pathParams);
  const update = (patch: Partial<Request>) => updateRequestTab(tabId, { request: { ...request, ...patch } });
  // merge into the FRESHEST grpc — importProtoFiles + describe patch grpc in the same tick,
  // so building from the stale `request.grpc` snapshot would clobber the just-imported protoFiles.
  const updateGrpc = (patch: Partial<NonNullable<Request["grpc"]>>) => {
    const cur = useApp.getState().requestTabs[tabId]?.request;
    if (cur?.grpc) updateRequestTab(tabId, { request: { ...cur, grpc: { ...cur.grpc, ...patch } } });
  };

  const setProtocol = (protocol: Request["protocol"]) => {
    if (protocol === request.protocol) return;
    setEditorTab("body");
    update({
      protocol,
      http: protocol === "http" ? request.http ?? emptyHttp() : request.http,
      grpc: protocol === "grpc" ? request.grpc ?? emptyGrpc() : request.grpc,
      ws: protocol === "ws" ? request.ws ?? emptyWs() : request.ws,
    });
  };

  // paste a whole `grpcurl …` into any address bar → switch to gRPC and fill it
  const applyGrpcurl = (text: string): boolean => {
    const parsed = parseGrpcurl(text.replace(/\\(\s|$)/g, "$1"));
    if (!parsed?.grpc) return false;
    setEditorTab("body");
    if (parsed.grpc.protoFiles.length === 0) {
      update({ protocol: "grpc", grpc: parsed.grpc });
      showToast("Imported", "grpcurl parsed into request.");
      return true;
    }
    const matchingSource = protoSources.find((source) => source.kind === "files"
      && source.files.length === parsed.grpc!.protoFiles.length
      && source.files.every((file) => parsed.grpc!.protoFiles.includes(file)));
    const source = matchingSource ?? {
      id: crypto.randomUUID(),
      name: parsed.grpc.protoFiles[0].split("/").pop() ?? "proto",
      kind: "files" as const,
      files: parsed.grpc.protoFiles,
      importPaths: [],
      endpoint: "",
      insecure: false,
    };
    setCatalog(null);
    setDescError(null);
    update({ protocol: "grpc", grpc: { ...parsed.grpc, sourceId: source.id, protoFiles: [] } });
    void (async () => {
      if (!matchingSource) await saveSource(source);
      await describeSource(source.id, true);
    })();
    showToast("Imported", "grpcurl parsed into request.");
    return true;
  };

  // Describe resolves the schema from the request's shared ProtoSource (cached on the backend;
  // force=true re-describes). Falls back to the legacy inline endpoint/protoFiles for old requests.
  const describe = async (force = false) => {
    const g = request.grpc;
    if (!g) return;
    const useSource = !!g.sourceId;
    if (!useSource && g.protoFiles.length === 0 && !g.endpoint.trim()) {
      showToast("Describe failed", "Select a proto source, import .proto, or enter an endpoint.", "err");
      return;
    }
    setDescribing(true);
    try {
      const c = await api.grpcDescribe(env, g.sourceId ?? null, force,
        useSource ? null : g.endpoint, useSource ? [] : g.protoFiles, g.insecure);
      setCatalog(c);
      showToast("Described", `${c.services.length} service(s) found.`);
    } catch (err) {
      showToast("Describe failed", String(err), "err");
    } finally {
      setDescribing(false);
    }
  };

  const pickProtoFiles = () => open({ multiple: true, filters: [{ name: "Protocol Buffers", extensions: ["proto"] }] })
    .then((sel) => (sel ? (Array.isArray(sel) ? sel : [sel]) : []));

  const pickProtoDir = () => open({ directory: true })
    .then((sel) => (sel ? (Array.isArray(sel) ? sel : [sel]) : []));

  const saveSource = async (src: ProtoSource) => { await api.protoSourceSave(src); await reloadProtoSources(); };

  // Create a shared source from a folder (preferred: imports auto-resolve) or picked files.
  const createFilesSource = async (folder: boolean) => {
    try {
      const picked = folder ? await pickProtoDir() : await pickProtoFiles();
      if (!picked.length) return;
      const src: ProtoSource = {
        id: crypto.randomUUID(),
        name: picked[0].split("/").pop() ?? "proto",
        kind: "files", files: picked, importPaths: [], endpoint: "", insecure: false,
      };
      await saveSource(src);
      selectSource(src.id, true);
    } catch (err) {
      showToast("Import failed", String(err), "err");
    }
  };

  // Create a reflection source from the request's current endpoint.
  const createReflectionSource = async () => {
    const g = request.grpc;
    if (!g) return;
    const src: ProtoSource = {
      id: crypto.randomUUID(),
      name: (g.endpoint || "reflection").replace(/^https?:\/\//, ""),
      kind: "reflection", files: [], importPaths: [], endpoint: g.endpoint, insecure: g.insecure,
    };
    await saveSource(src);
    selectSource(src.id, true);
  };

  // Bind request → source. Reset service/method (they belong to the old schema); the effect re-describes.
  const selectSource = (id: string, forceDescribe = false) => {
    setCatalog(null);
    setDescError(null);
    updateGrpc({ sourceId: id, service: "", method: "" });
    if (forceDescribe) void describeSource(id, true);
  };

  // Describe a specific source id (used right after create/select, before render state settles).
  const describeSource = async (id: string, force: boolean) => {
    setDescribing(true);
    try {
      const c = await api.grpcDescribe(env, id, force, null, [], false);
      setCatalog(c);
      setDescError(null);
      showToast("Described", `${c.services.length} service(s) found.`);
    } catch (err) {
      setDescError(String(err));
      showToast("Describe failed", String(err), "err");
    } finally {
      setDescribing(false);
    }
  };

  const addFilesToSource = async (src: ProtoSource, folder: boolean) => {
    try {
      const picked = folder ? await pickProtoDir() : await pickProtoFiles();
      if (!picked.length) return;
      const files = [...new Set([...src.files, ...picked])];
      await saveSource({ ...src, files });
      await describeSource(src.id, true);
    } catch (err) {
      showToast("Import failed", String(err), "err");
    }
  };

  // Extra include root (-I) for imports that don't live under a picked folder (monorepo protos).
  const addImportPath = async (src: ProtoSource) => {
    try {
      const picked = await pickProtoDir();
      if (!picked.length) return;
      await saveSource({ ...src, importPaths: [...new Set([...src.importPaths, ...picked])] });
      await describeSource(src.id, true);
    } catch (err) {
      showToast("Import failed", String(err), "err");
    }
  };

  const deleteSource = async (src: ProtoSource) => {
    if (!(await openConfirm({ title: "Delete Proto Source?", message: `"${src.name}" will be removed everywhere it's used.`, danger: true, confirmLabel: "Delete" }))) return;
    await api.protoSourceDelete(src.id);
    await reloadProtoSources();
    if (request.grpc?.sourceId === src.id) { setCatalog(null); updateGrpc({ sourceId: undefined }); }
  };

  // Migrate a legacy request (inline protoFiles, no sourceId) into a shared source.
  const convertLegacy = async () => {
    const g = request.grpc;
    if (!g?.protoFiles.length) return;
    const src: ProtoSource = {
      id: crypto.randomUUID(),
      name: g.protoFiles[0].split("/").pop() ?? "proto",
      kind: "files", files: g.protoFiles, importPaths: [], endpoint: "", insecure: false,
    };
    await saveSource(src);
    setCatalog(null);
    updateGrpc({ sourceId: src.id, protoFiles: [] });
    void describeSource(src.id, true);
  };

  const wsConnect = async () => {
    if (!request.ws) return;
    try {
      await api.wsConnect(wsSid, request.ws.url, request.ws.headers);
    } catch (err) {
      showToast("Connect failed", String(err), "err");
    }
  };
  const wsSend = async () => {
    if (!wsDraft.trim()) return;
    try {
      await api.wsSend(wsSid, wsDraft);
      pushWs("out", wsDraft);
      setWsDraft("");
    } catch (err) {
      showToast("Send failed", String(err), "err");
    }
  };
  const wsClose = async () => { try { await api.wsClose(wsSid); } catch { /* already closed */ } };

  const grpc = request.grpc;
  const selectedService = catalog?.services.find((s) => s.name === grpc?.service);
  const currentSource = protoSources.find((s) => s.id === grpc?.sourceId) ?? null;
  const grpcMethodDef = selectedService?.methods.find((m) => m.name === grpc?.method) ?? null;
  const horizontal = !embedded && requestHorizontal && request.protocol !== "ws";

  return (
    <section className={`content request-screen protocol-${request.protocol} ${embedded ? "embedded" : ""} ${horizontal ? "layout-cols" : ""} ${active ? "active" : ""}`}>
      {/* embedded (flow dock) drops the whole rail: protocol lives in the Step-key row, name == step key */}
      {!embedded && (
        <div className="protocol-rail">
          <button type="button" className={`protocol-pill ${request.protocol === "http" ? "active" : ""}`} onClick={() => setProtocol("http")}>
            <span className="status-dot" /> REST
          </button>
          <button type="button" className={`protocol-pill ${request.protocol === "grpc" ? "active" : ""}`} onClick={() => setProtocol("grpc")}>
            <span className="status-dot orange" /> gRPC
          </button>
          <button type="button" className={`protocol-pill ${request.protocol === "ws" ? "active" : ""}`} onClick={() => setProtocol("ws")}>
            <span className="status-dot purple" /> WebSocket
          </button>
          <span className="protocol-spacer" />
          <input
            className="path-input"
            style={{ width: 220 }}
            value={request.name}
            onChange={(e) => update({ name: e.target.value })}
          />
          {request.protocol !== "ws" && (
            <button type="button" className="tool-btn icon-only" title={requestHorizontal ? "Stack response below (rows)" : "Response beside editor (columns)"} aria-label="Toggle response layout" onClick={toggleRequestLayout}>
              <Icon name={requestHorizontal ? "rows" : "panel-right"} />
            </button>
          )}
        </div>
      )}

      {request.protocol === "http" && request.http && (
        <>
          <div className="request-head">
            <select className={`method-select method-${request.http.method.toLowerCase()}`} value={request.http.method} onChange={(e) => update({ http: { ...request.http!, method: e.target.value } })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => <option key={m}>{m}</option>)}
            </select>
            <EnvInput className="query-path-input"
              value={urlDraft ?? fullUrl(request.http.url, request.http.params)}
              onChange={(text) => {
                // paste a `grpcurl ...` → switch protocol to gRPC and fill it
                if (isGrpcurl(text)) { setUrlDraft(null); applyGrpcurl(text); return; }
                // paste a whole `curl ...` into the URL bar → parse it and fill method/url/params/headers/body/auth
                if (/^\s*curl\s/i.test(text)) {
                  setUrlDraft(null);
                  // single-line <input> collapses newlines to spaces, leaving stray `\ ` from `\`-continuations
                  api.importCurl(text.replace(/\\(\s|$)/g, "$1"))
                    .then((parsed) => {
                      if (parsed.http) {
                        // importCurl leaves the query on the url; split it into the Params tab like manual entry does
                        const { base, query } = splitUrl(parsed.http.url);
                        update({ http: { ...parsed.http, url: base, pathParams: extractPathParams(base, parsed.http.pathParams), params: [...parsed.http.params, ...queryToParams(query)] } });
                      }
                      showToast("Imported", "cURL parsed into request.");
                    })
                    .catch((err) => showToast("Import failed", String(err), "err"));
                  return;
                }
                // typing/pasting a query in the URL splits it live into the Params tab (and vice-versa, since the value is derived from params)
                // disabled params aren't in the URL, so keep them instead of wiping them on every URL edit
                setUrlDraft(text);
                const { base, query } = splitUrl(text);
                const disabledParams = request.http!.params.filter((p) => p.enabled === false);
                update({ http: { ...request.http!, url: base, pathParams: extractPathParams(base, request.http!.pathParams), params: [...queryToParams(query), ...disabledParams] } });
              }}
              onBlur={() => setUrlDraft(null)}
              placeholder="{{baseUrl}}/v1/resource" variableNames={variableNames} />
            <ToolButton iconOnly={embedded} className="request-copy" title="Copy cURL" onClick={() => navigator.clipboard?.writeText(buildCurl(request)).then(() => showToast("Copied", "cURL command copied."))}><Icon name="copy" />{!embedded && " Copy cURL"}</ToolButton>
            {/* pinned to the bottom edge of the head row; overlay, never a grid child (see .request-screen rows) */}
            <LoadingBar active={rt.running} />
          </div>
          <section className="editor-pane">
            <div className="editor-tabs">
              <button type="button" className={editorTab === "body" ? "active" : ""} onClick={() => setEditorTab("body")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="braces" size={13} /> Body</button>
              <button type="button" className={editorTab === "headers" ? "active" : ""} onClick={() => setEditorTab("headers")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="activity" size={13} /> Headers <span className="tab-count">{request.http.headers.length}</span></button>
              <button type="button" className={editorTab === "params" ? "active" : ""} onClick={() => setEditorTab("params")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="key" size={13} /> Params <span className="tab-count">{httpPathParams.length + request.http.params.length}</span></button>
              <button type="button" className={editorTab === "auth" ? "active" : ""} onClick={() => setEditorTab("auth")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="key" size={13} /> Auth</button>
              <button type="button" className={editorTab === "cookies" ? "active" : ""} onClick={() => setEditorTab("cookies")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="list" size={13} /> Cookies <span className="tab-count">{reqCookies.length}</span></button>
              {editorTab === "body" && (
                <div className="body-type-tabs">
                  {(["none", "json", "text", "form"] as const).map((t) => (
                    <button key={t} type="button" className={request.http!.body.type === t ? "active" : ""}
                      onClick={() => update({ http: { ...request.http!, body: { ...request.http!.body, type: t } } })}>{t}</button>
                  ))}
                </div>
              )}
              {/* narrow-dock fallback: buttons collapse into these selects via @container (embedded only) */}
              {embedded && (
                <select className="editor-tab-select" value={editorTab} onChange={(e) => setEditorTab(e.target.value as typeof editorTab)}>
                  <option value="body">Body</option>
                  <option value="headers">Headers ({request.http.headers.length})</option>
                  <option value="params">Params ({httpPathParams.length + request.http.params.length})</option>
                  <option value="auth">Auth</option>
                  <option value="cookies">Cookies ({reqCookies.length})</option>
                </select>
              )}
              {embedded && editorTab === "body" && (
                <select className="body-type-select" value={request.http.body.type}
                  onChange={(e) => update({ http: { ...request.http!, body: { ...request.http!.body, type: e.target.value as typeof request.http.body.type } } })}>
                  {["none", "json", "text", "form"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>
            {editorTab === "body" && (
              <div className="body-editor">
                {request.http.body.type === "form" ? (
                  <KvEditor items={request.http.body.fields ?? []} onChange={(fields) => update({ http: { ...request.http!, body: { ...request.http!.body, fields } } })} />
                ) : request.http.body.type !== "none" ? (
                    <JsonEditor
                      value={request.http.body.content ?? ""}
                      onChange={(content) => update({ http: { ...request.http!, body: { ...request.http!.body, content } } })}
                      language={request.http.body.type === "json" ? "json" : "plaintext"}
                      variableNames={variableNames}
                  />
                ) : <div className="empty-note">No body for this request.</div>}
              </div>
            )}
            {editorTab === "headers" && <KvEditor items={request.http.headers} onChange={(headers) => update({ http: { ...request.http!, headers } })} />}
            {editorTab === "params" && (
              <KvEditor
                items={[...httpPathParams, ...request.http.params]}
                lockedCount={httpPathParams.length}
                onChange={(rows) => update({
                  http: {
                    ...request.http!,
                    pathParams: rows.slice(0, httpPathParams.length),
                    params: rows.slice(httpPathParams.length),
                  },
                })}
              />
            )}
            {editorTab === "auth" && (
              <div className="auth-editor">
                <div className="form-row">
                  <label>Type</label>
                  <select value={request.http.auth.type} onChange={(e) => update({ http: { ...request.http!, auth: { type: e.target.value as any } } })}>
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="basic">Basic auth</option>
                    <option value="apiKey">API key</option>
                  </select>
                </div>
                {request.http.auth.type === "bearer" && (
                  <div className="form-row"><label>Token</label><EnvInput value={request.http.auth.token ?? ""} onChange={(token) => update({ http: { ...request.http!, auth: { ...request.http!.auth, token } } })} placeholder="{{accessToken}}" variableNames={variableNames} /></div>
                )}
                {request.http.auth.type === "basic" && (
                  <>
                    <div className="form-row"><label>Username</label><input value={request.http.auth.username ?? ""} onChange={(e) => update({ http: { ...request.http!, auth: { ...request.http!.auth, username: e.target.value } } })} /></div>
                    <div className="form-row"><label>Password</label><input value={request.http.auth.password ?? ""} onChange={(e) => update({ http: { ...request.http!, auth: { ...request.http!.auth, password: e.target.value } } })} /></div>
                  </>
                )}
                {request.http.auth.type === "apiKey" && (
                  <>
                    <div className="form-row"><label>Key</label><input value={request.http.auth.key ?? ""} onChange={(e) => update({ http: { ...request.http!, auth: { ...request.http!.auth, key: e.target.value } } })} /></div>
                    <div className="form-row"><label>Value</label><input value={request.http.auth.value ?? ""} onChange={(e) => update({ http: { ...request.http!, auth: { ...request.http!.auth, value: e.target.value } } })} /></div>
                    <div className="form-row"><label>Add to</label>
                      <select value={request.http.auth.addTo ?? "header"} onChange={(e) => update({ http: { ...request.http!, auth: { ...request.http!.auth, addTo: e.target.value as any } } })}>
                        <option value="header">Header</option>
                        <option value="query">Query param</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}
            {editorTab === "cookies" && (
              <div className="cookies-panel">
                <div className="cookies-head">
                  <span>Cookies sent to <code>{reqUrl || "this request"}</code> from the shared jar.</span>
                  <ToolButton onClick={() => void api.cookiesClear().then(() => setReqCookies([])).then(() => showToast("Cookies cleared", "Jar emptied."))}><Icon name="trash" size={13} /> Clear all</ToolButton>
                </div>
                {reqCookies.length === 0
                  ? <div className="empty-note">No cookies for this URL yet. Send a request that returns Set-Cookie.</div>
                  : <table className="cookies-table"><tbody>{reqCookies.map((c, i) => <tr key={i}><td>{c.key}</td><td>{c.value}</td></tr>)}</tbody></table>}
              </div>
            )}
          </section>
        </>
      )}

      {request.protocol === "grpc" && grpc && (
        <>
          <div className="request-head">
            <EnvInput className="query-path-input" value={grpc.endpoint} onChange={(endpoint) => { if (isGrpcurl(endpoint)) { applyGrpcurl(endpoint); return; } update({ grpc: { ...grpc, endpoint } }); }} placeholder="{{grpcHost}}:50051  (or paste a grpcurl command)" variableNames={variableNames} />
            {catalog && (
              <div className="grpc-method-pickers">
                <Combobox
                  value={grpc.service}
                  options={catalog.services.map((service) => service.name)}
                  placeholder="Select service..."
                  onChange={(service) => update({ grpc: { ...grpc, service, method: "" } })}
                />
                <Combobox
                  value={grpc.method}
                  options={selectedService?.methods.map((method) => method.name) ?? []}
                  placeholder="Select method..."
                  disabled={!selectedService}
                  onChange={(method) => {
                    const selectedMethod = selectedService?.methods.find((item) => item.name === method);
                    // keep overlapping fields from the current payload instead of wiping it
                    const message = selectedMethod ? mergeIntoTemplate(grpc.message, selectedMethod.inputTemplate) : grpc.message;
                    update({ grpc: { ...grpc, method, message } });
                  }}
                />
              </div>
            )}
            <LoadingBar active={rt.running} />
          </div>
          <section className="editor-pane">
            <div className="editor-tabs">
              <button type="button" className={editorTab === "body" ? "active" : ""} onClick={() => setEditorTab("body")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="braces" size={13} /> Message</button>
              <button type="button" className={editorTab === "metadata" ? "active" : ""} onClick={() => setEditorTab("metadata")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="key" size={13} /> Metadata <span className="tab-count">{grpc.metadata.length}</span></button>
              <button type="button" className={editorTab === "proto" ? "active" : ""} onClick={() => setEditorTab("proto")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="braces" size={13} /> Proto {currentSource && <span className={`proto-dot${descError ? " err" : catalog ? " ok" : ""}`} />}</button>
              {embedded && (
                <select className="editor-tab-select" value={editorTab === "metadata" || editorTab === "proto" ? editorTab : "body"} onChange={(e) => setEditorTab(e.target.value as typeof editorTab)}>
                  <option value="body">Message</option>
                  <option value="metadata">Metadata ({grpc.metadata.length})</option>
                  <option value="proto">Proto</option>
                </select>
              )}
            </div>
            {editorTab === "body" && (
              <JsonEditor
                value={grpc.message}
                onChange={(message) => update({ grpc: { ...grpc, message } })}
                variableNames={variableNames}
                onFillSample={grpcMethodDef ? () => {
                  let pretty = grpcMethodDef.inputTemplate;
                  try { pretty = JSON.stringify(JSON.parse(grpcMethodDef.inputTemplate), null, 2); } catch { /* keep raw */ }
                  update({ grpc: { ...grpc, message: pretty } });
                } : undefined}
              />
            )}
            {editorTab === "metadata" && <KvEditor items={grpc.metadata} onChange={(metadata) => update({ grpc: { ...grpc, metadata } })} keyPlaceholder="metadata key" />}
            {editorTab === "proto" && (
              <div className="proto-panel">
                <div className="proto-actions">
                  <select
                    className="method-select proto-source-select"
                    value={grpc.sourceId ?? ""}
                    onChange={(e) => { if (e.target.value) selectSource(e.target.value); }}
                  >
                    <option value="" disabled>Select proto source…</option>
                    {protoSources.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} · {s.kind === "files" ? "proto" : "reflection"}</option>
                    ))}
                  </select>
                  <ToolButton
                    variant="primary"
                    disabled={describing}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setProtoMenu((m) => (m ? null : { x: r.left, y: r.bottom + 4 }));
                    }}
                  ><Icon name="plus" size={13} /> New</ToolButton>
                  {currentSource && (
                    <ToolButton iconOnly title="Re-describe" onClick={() => void describeSource(currentSource.id, true)} disabled={describing}>
                      <Icon name="refresh" size={13} />
                    </ToolButton>
                  )}
                </div>
                {protoMenu && (
                  <div className="index-context-menu" style={{ left: protoMenu.x, top: protoMenu.y }} onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" className="context-item" onClick={() => { setProtoMenu(null); void createFilesSource(true); }}><Icon name="folder" /><strong>Import proto folder</strong></button>
                    <button type="button" className="context-item" onClick={() => { setProtoMenu(null); void createFilesSource(false); }}><Icon name="braces" /><strong>Import .proto files</strong></button>
                    <button type="button" className="context-item" onClick={() => { setProtoMenu(null); void createReflectionSource(); }}><Icon name="plug" /><strong>From reflection endpoint</strong></button>
                  </div>
                )}

                {!currentSource ? (
                  grpc.protoFiles.length ? (
                    <div className="proto-source-detail">
                      <div className="empty-note">Legacy request: {grpc.protoFiles.length} inline .proto file(s). Convert to a shared proto source for quick switching and caching.</div>
                      <ul className="proto-files">
                        {grpc.protoFiles.map((f) => (<li key={f}><span className="proto-path" title={f}>{f}</span></li>))}
                      </ul>
                      <div className="proto-source-foot">
                        <ToolButton onClick={() => void describe(false)} disabled={describing}>{describing ? "Describing…" : "Describe"}</ToolButton>
                        <ToolButton variant="primary" onClick={() => void convertLegacy()}>Convert to source</ToolButton>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-note">
                      No proto source. Create one from <b>.proto</b> files or a <b>reflection</b> endpoint — once created, pick it from the dropdown and reuse it across requests.
                    </div>
                  )
                ) : (
                  <div className="proto-source-detail">
                    <input
                      className="query-path-input"
                      value={nameDraft ?? currentSource.name}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => {
                        const next = nameDraft?.trim();
                        if (next && next !== currentSource.name) void saveSource({ ...currentSource, name: next });
                        setNameDraft(null);
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      placeholder="Source name"
                    />
                    {currentSource.kind === "files" ? (
                      <>
                        <ul className="proto-files">
                          {currentSource.files.map((f) => (
                            <li key={f}>
                              <Icon name={f.endsWith(".proto") ? "braces" : "folder"} size={13} />
                              <span className="proto-path" title={f}>{f}</span>
                              <button type="button" className="proto-remove" aria-label="Remove"
                                onClick={() => void saveSource({ ...currentSource, files: currentSource.files.filter((p) => p !== f) }).then(() => describeSource(currentSource.id, true))}>✕</button>
                            </li>
                          ))}
                          {currentSource.importPaths.map((p) => (
                            <li key={p}>
                              <Icon name="folder" size={13} />
                              <span className="proto-path" title={p}>-I {p}</span>
                              <button type="button" className="proto-remove" aria-label="Remove import path"
                                onClick={() => void saveSource({ ...currentSource, importPaths: currentSource.importPaths.filter((x) => x !== p) }).then(() => describeSource(currentSource.id, true))}>✕</button>
                            </li>
                          ))}
                          {currentSource.files.length === 0 && <li className="empty-note" style={{ border: 0 }}>No .proto files.</li>}
                        </ul>
                        <div className="proto-actions">
                          <ToolButton onClick={() => void addFilesToSource(currentSource, true)} disabled={describing}><Icon name="folder" size={13} /> Add folder</ToolButton>
                          <ToolButton onClick={() => void addFilesToSource(currentSource, false)} disabled={describing}><Icon name="braces" size={13} /> Add files</ToolButton>
                          <ToolButton onClick={() => void addImportPath(currentSource)} disabled={describing} title="Extra include root (-I) for resolving imports">Add import path</ToolButton>
                        </div>
                      </>
                    ) : (
                      <EnvInput
                        className="query-path-input"
                        value={currentSource.endpoint}
                        onChange={(endpoint) => void saveSource({ ...currentSource, endpoint })}
                        placeholder="{{grpcHost}}:50051"
                        variableNames={variableNames}
                      />
                    )}
                    {catalog?.warnings?.length ? (
                      <ul className="proto-files proto-warnings">
                        {catalog.warnings.map((w) => (
                          <li key={w}><Icon name="x" size={13} /><span className="proto-path">{w}</span></li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="proto-source-foot">
                      <span className={`proto-note${descError ? " err" : ""}`}>
                        {describing ? "Describing…"
                          : descError ?? (catalog
                            ? `${catalog.services.length} service(s)${catalog.warnings?.length ? ` · ${catalog.warnings.length} file(s) skipped` : ""}`
                            : "not described")}
                      </span>
                      <ToolButton variant="danger" onClick={() => void deleteSource(currentSource)}><Icon name="trash" size={13} /> Delete source</ToolButton>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {request.protocol === "ws" && request.ws && (
        <>
          <div className="request-head">
            <EnvInput className="query-path-input" value={request.ws.url} onChange={(url) => update({ ws: { ...request.ws!, url } })} placeholder="wss://{{wsHost}}/socket" variableNames={variableNames} />
            {!wsConnected ? <ToolButton variant="primary" onClick={wsConnect}>Connect</ToolButton> : <ToolButton variant="danger" onClick={wsClose}>Disconnect</ToolButton>}
          </div>
          <section className="editor-pane" style={{ gridTemplateRows: "39px 1fr auto" }}>
            <div className="editor-tabs">
              <span className="editor-meta" style={{ marginLeft: 0 }}>
                <span className={wsConnected ? "soft-green" : "soft-orange"}>{wsConnected ? "connected" : "disconnected"}</span>
              </span>
              <button type="button" disabled={wsLog.length === 0} onClick={() => setWsLog([])}>Clear</button>
            </div>
            <div className="ws-log" ref={wsLogRef}>
              {wsLog.length === 0 && <div className="empty-note">No messages yet. Connect and send one.</div>}
              {wsLog.map((m, i) => <div key={i} className={`ws-msg ${m.dir}`}><span className="dir">{m.dir}</span><span>{m.text}</span><time>{new Date(m.ts).toLocaleTimeString()}</time></div>)}
            </div>
            <div className="ws-compose">
              <input value={wsDraft} onChange={(e) => setWsDraft(e.target.value)} placeholder="Message to send…" onKeyDown={(e) => e.key === "Enter" && void wsSend()} />
              <ToolButton variant="primary" disabled={!wsConnected} onClick={wsSend}><Icon name="send" /> Send</ToolButton>
            </div>
          </section>
        </>
      )}

      {request.protocol !== "ws" && (() => {
        const contentType = rt.response?.headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "";
        const isHtml = /text\/html/i.test(contentType);
        // "preview" only exists for html responses; fall back to pretty when the response changes underneath it
        const shownTab = responseTab === "preview" && !isHtml ? "pretty" : responseTab;
        return (
        <>
          <div className="bottom-resizer" title="Resize response" onPointerDown={(event) => startResize(event, horizontal ? "request-x" : "request")} />
          <section className={`response ${rt.running ? "loading" : ""}`}>
            <div className="response-head" onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}>
              <strong>Response</strong>
              {rt.response && "status" in rt.response && (
                <span className={`response-status ${rt.response.status < 300 ? "ok" : rt.response.status < 500 ? "warn" : "err"}`}>{rt.response.status}</span>
              )}
              {rt.response && "statusCode" in rt.response && <span className="response-status ok">{rt.response.statusCode}</span>}
              <span className="response-meta">
                {rt.response && <span className="metric-duration">{rt.response.timeMs}ms</span>}
                {rt.response && "sizeBytes" in rt.response && <span className="metric-size">{fmtBytes(rt.response.sizeBytes)}</span>}
                {rt.response && (
                  <button type="button" title="Copy response body" aria-label="Copy response body"
                    onClick={() => {
                      const body = "body" in rt.response! ? rt.response!.body : rt.response!.bodyJson;
                      void navigator.clipboard?.writeText(shownTab === "pretty" ? prettyBody : body).then(() => showToast("Copied", "Response body copied."));
                    }}><Icon name="copy" size={13} /> Copy</button>
                )}
                <button type="button" title="Pretty" className={shownTab === "pretty" ? "active" : ""} onClick={() => setResponseTab("pretty")}><Icon name="braces" size={13} /> Pretty</button>
                <button type="button" title="Raw" className={shownTab === "raw" ? "active" : ""} onClick={() => setResponseTab("raw")}><Icon name="code" size={13} /> Raw</button>
                {isHtml && <button type="button" title="Preview" className={shownTab === "preview" ? "active" : ""} onClick={() => setResponseTab("preview")}><Icon name="sparkles" size={13} /> Preview</button>}
                <button type="button" title="Headers" className={shownTab === "headers" ? "active" : ""} onClick={() => setResponseTab("headers")}><Icon name="activity" size={13} /> Headers</button>
                <button type="button" title="Cookies" className={shownTab === "cookies" ? "active" : ""} onClick={() => setResponseTab("cookies")}><Icon name="list" size={13} /> Cookies</button>
              </span>
            </div>
            <div className="response-body">
              <SectionVeil on={rt.running} label="Sending…" />
              {!rt.response && !rt.error && <div className="response-empty">{rt.running ? "sending…" : "send a request to see the response"}</div>}
              {rt.response && (shownTab === "pretty" || shownTab === "raw") && (
                shownTab === "pretty"
                  ? <JsonResponseViewer value={prettyBody} />
                  : <JsonView className="response-code json-tree" value={"body" in rt.response ? rt.response.body : rt.response.bodyJson} />
              )}
              {rt.response && shownTab === "preview" && "body" in rt.response && (
                <iframe className="response-preview" sandbox="" srcDoc={rt.response.body} title="HTML preview" />
              )}
              {rt.response && shownTab === "headers" && (
                <table>
                  <thead><tr><th>Name</th><th>Value</th></tr></thead>
                  <tbody>{rt.response.headers.map((h, i) => <tr key={i}><td>{h.key}</td><td>{h.value}</td></tr>)}</tbody>
                </table>
              )}
              {rt.response && shownTab === "cookies" && (() => {
                const cookies = parseSetCookies(rt.response.headers);
                return cookies.length === 0
                  ? <div className="response-empty">No Set-Cookie in this response.</div>
                  : <table><thead><tr><th>Name</th><th>Value</th><th>Attributes</th></tr></thead>
                      <tbody>{cookies.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.value}</td><td>{c.attrs}</td></tr>)}</tbody></table>;
              })()}
            </div>
          </section>
        </>
        );
      })()}
    </section>
  );
}

function tryPretty(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Split each Set-Cookie response header into name / value / remaining attributes.
function parseSetCookies(headers: KV[]): { name: string; value: string; attrs: string }[] {
  return headers.filter((h) => h.key.toLowerCase() === "set-cookie").map((h) => {
    const semi = h.value.indexOf(";");
    const pair = semi === -1 ? h.value : h.value.slice(0, semi);
    const attrs = semi === -1 ? "" : h.value.slice(semi + 1).trim();
    const eq = pair.indexOf("=");
    return eq === -1
      ? { name: pair.trim(), value: "", attrs }
      : { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs };
  });
}
