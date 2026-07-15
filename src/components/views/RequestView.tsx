import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { KvEditor } from "../../ui/KvEditor";
import { JsonEditor } from "../../ui/JsonEditor";
import { JsonView } from "../../ui/JsonView";
import { JsonResponseViewer } from "../../ui/JsonResponseViewer";
import { EnvInput } from "../../ui/EnvInput";
import { Combobox } from "../../ui/Combobox";
import { startResize, toggleRequestEditorSize } from "../ResizeHandles";
import { useApp } from "../../store";
import {
  api, emptyGrpc, emptyHttp, emptyWs, onWsEvent,
  type GrpcCatalog, type KV, type Request,
} from "../../lib/api";

// URL <-> Params two-way sync (Postman-style). Params are canonical for send (backend
// appends them to the base url); the URL bar is a derived view. Raw (no encoding) so
// {{vars}} stay readable — the backend encodes at send.
const splitUrl = (url: string) => {
  const q = url.indexOf("?");
  return q === -1 ? { base: url, query: "" } : { base: url.slice(0, q), query: url.slice(q + 1) };
};
const queryToParams = (query: string): KV[] =>
  query === "" ? [] : query.split("&").map((seg) => {
    const eq = seg.indexOf("=");
    return eq === -1 ? { key: seg, value: "", enabled: true } : { key: seg.slice(0, eq), value: seg.slice(eq + 1), enabled: true };
  });
const paramsToQuery = (params: KV[]): string =>
  params.filter((p) => p.enabled !== false && (p.key || p.value)).map((p) => `${p.key}=${p.value}`).join("&");
const fullUrl = (base: string, params: KV[]): string => {
  const q = paramsToQuery(params);
  return q ? `${splitUrl(base).base}?${q}` : base;
};

function buildCurl(request: Request): string {
  if (!request.http) return "";
  const h = request.http;
  const parts = [`curl -X ${h.method} '${fullUrl(h.url, h.params)}'`];
  for (const kv of h.headers) if (kv.enabled !== false && kv.key) parts.push(`-H '${kv.key}: ${kv.value}'`);
  if (h.auth.type === "bearer" && h.auth.token) parts.push(`-H 'Authorization: Bearer ${h.auth.token}'`);
  if (h.body.type === "json" && h.body.content) parts.push(`-d '${h.body.content.replace(/'/g, "'\\''")}'`);
  if (h.body.type === "text" && h.body.content) parts.push(`-d '${h.body.content.replace(/'/g, "'\\''")}'`);
  return parts.join(" \\\n  ");
}

export function RequestView({ tabId, active }: { tabId: string; active: boolean }) {
  const rt = useApp((s) => s.requestTabs[tabId]);
  const updateRequestTab = useApp((s) => s.updateRequestTab);
  const showToast = useApp((s) => s.showToast);
  const [editorTab, setEditorTab] = useState<"body" | "headers" | "auth" | "params" | "cookies" | "metadata" | "proto">("body");
  const [urlDraft, setUrlDraft] = useState<string | null>(null); // local while typing the URL, so it isn't reformatted mid-edit
  const [responseTab, setResponseTab] = useState<"pretty" | "headers" | "cookies" | "raw">("pretty");
  const [reqCookies, setReqCookies] = useState<KV[]>([]);
  const [catalog, setCatalog] = useState<GrpcCatalog | null>(null);
  const [describing, setDescribing] = useState(false);
  const [wsLog, setWsLog] = useState<{ dir: "out" | "in" | "sys"; text: string }[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsDraft, setWsDraft] = useState("");
  const [variableNames, setVariableNames] = useState<string[]>([]);
  const wsSid = useMemo(() => `ws-${tabId}`, [tabId]);
  const env = useApp((s) => s.activeEnv);
  const envVersion = useApp((s) => s.envVersion);
  const requestHorizontal = useApp((s) => s.requestHorizontal);
  const toggleRequestLayout = useApp((s) => s.toggleRequestLayout);

  useEffect(() => {
    if (!env) { setVariableNames([]); return; }
    Promise.all([api.envRead(env), api.secretRead(env)])
      .then(([vars, secrets]) => setVariableNames([...new Set([...Object.keys(vars), ...Object.keys(secrets)])]))
      .catch(() => setVariableNames([]));
  }, [env, envVersion]);

  useEffect(() => {
    const p = onWsEvent(wsSid, (e) => {
      if (e.kind === "open") { setWsConnected(true); setWsLog((l) => [...l, { dir: "sys", text: "connected" }]); }
      if (e.kind === "message") setWsLog((l) => [...l, { dir: "in", text: e.data }]);
      if (e.kind === "closed") { setWsConnected(false); setWsLog((l) => [...l, { dir: "sys", text: "closed" }]); }
      if (e.kind === "error") setWsLog((l) => [...l, { dir: "sys", text: `error: ${e.data}` }]);
    });
    return () => { void p.then((unlisten) => unlisten()); };
  }, [wsSid]);

  if (!rt) return null;
  const request = rt.request;
  const update = (patch: Partial<Request>) => updateRequestTab(tabId, { request: { ...request, ...patch } });

  // cookies the jar will attach for this url (refresh on tab open / url change / after send)
  const reqUrl = request.http?.url ?? "";
  const lastResponse = rt.response;
  useEffect(() => {
    if (editorTab !== "cookies") return;
    api.cookiesFor(reqUrl).then(setReqCookies).catch(() => setReqCookies([]));
  }, [editorTab, reqUrl, lastResponse]);

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

  // Source is set by whichever Describe runs last — reflection (path bar) or files (Proto tab).
  const describe = async (source: "reflection" | "files", selectedFiles?: string[]) => {
    if (!request.grpc) return;
    setDescribing(true);
    try {
      const files = source === "files" ? (selectedFiles ?? request.grpc.protoFiles) : [];
      const endpoint = source === "reflection" ? request.grpc.endpoint : null;
      const c = await api.grpcDescribe(env, endpoint, files, request.grpc.insecure);
      setCatalog(c);
      update({ grpc: { ...request.grpc, protoSource: source } }); // last describe wins
      showToast("Described", `${c.services.length} service(s) found.`);
    } catch (err) {
      showToast("Describe failed", String(err), "err");
    } finally {
      setDescribing(false);
    }
  };

  const importProtoFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Protocol Buffers", extensions: ["proto"] }],
      });
      if (!selected || !request.grpc) return;
      const picked = Array.isArray(selected) ? selected : [selected];
      const files = [...new Set([...request.grpc.protoFiles, ...picked])];
      update({ grpc: { ...request.grpc, protoFiles: files } });
      await describe("files", files);
    } catch (err) {
      showToast("Import failed", String(err), "err");
    }
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
      setWsLog((l) => [...l, { dir: "out", text: wsDraft }]);
      setWsDraft("");
    } catch (err) {
      showToast("Send failed", String(err), "err");
    }
  };
  const wsClose = async () => { try { await api.wsClose(wsSid); } catch { /* already closed */ } };

  const grpc = request.grpc;
  const selectedService = catalog?.services.find((s) => s.name === grpc?.service);
  const horizontal = requestHorizontal && request.protocol !== "ws";

  return (
    <section className={`content request-screen protocol-${request.protocol} ${horizontal ? "layout-cols" : ""} ${active ? "active" : ""}`}>
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

      {request.protocol === "http" && request.http && (
        <>
          <div className="request-head">
            <select className={`method-select method-${request.http.method.toLowerCase()}`} value={request.http.method} onChange={(e) => update({ http: { ...request.http!, method: e.target.value } })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => <option key={m}>{m}</option>)}
            </select>
            <EnvInput className="query-path-input"
              value={urlDraft ?? fullUrl(request.http.url, request.http.params)}
              onChange={(text) => {
                // paste a whole `curl ...` into the URL bar → parse it and fill method/url/params/headers/body/auth
                if (/^\s*curl\s/i.test(text)) {
                  setUrlDraft(null);
                  // single-line <input> collapses newlines to spaces, leaving stray `\ ` from `\`-continuations
                  api.importCurl(text.replace(/\\(\s|$)/g, "$1"))
                    .then((parsed) => { if (parsed.http) update({ http: parsed.http }); showToast("Imported", "cURL parsed into request."); })
                    .catch((err) => showToast("Import failed", String(err), "err"));
                  return;
                }
                // typing/pasting a query in the URL splits it live into the Params tab (and vice-versa, since the value is derived from params)
                setUrlDraft(text);
                const { base, query } = splitUrl(text);
                update({ http: { ...request.http!, url: base, params: queryToParams(query) } });
              }}
              onBlur={() => setUrlDraft(null)}
              placeholder="{{baseUrl}}/v1/resource" variableNames={variableNames} />
            <ToolButton className="request-copy" onClick={() => navigator.clipboard?.writeText(buildCurl(request)).then(() => showToast("Copied", "cURL command copied."))}><Icon name="copy" /> Copy cURL</ToolButton>
            {/* pinned to the bottom edge of the head row; overlay, never a grid child (see .request-screen rows) */}
            <div className={`req-progress ${rt.running ? "on" : ""}`}><span /></div>
          </div>
          <section className="editor-pane">
            <div className="editor-tabs">
              <button type="button" className={editorTab === "body" ? "active" : ""} onClick={() => setEditorTab("body")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="braces" size={13} /> Body</button>
              <button type="button" className={editorTab === "headers" ? "active" : ""} onClick={() => setEditorTab("headers")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="activity" size={13} /> Headers <span className="tab-count">{request.http.headers.length}</span></button>
              <button type="button" className={editorTab === "params" ? "active" : ""} onClick={() => setEditorTab("params")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="key" size={13} /> Params <span className="tab-count">{request.http.params.length}</span></button>
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
            {editorTab === "params" && <KvEditor items={request.http.params} onChange={(params) => update({ http: { ...request.http!, params } })} />}
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
            <EnvInput className="query-path-input" value={grpc.endpoint} onChange={(endpoint) => update({ grpc: { ...grpc, endpoint } })} placeholder="{{grpcHost}}:50051" variableNames={variableNames} />
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
                    update({ grpc: { ...grpc, method, message: selectedMethod?.inputTemplate ?? grpc.message } });
                  }}
                />
              </div>
            )}
            <ToolButton onClick={() => void describe("reflection")} disabled={describing}>{describing ? "Describing…" : "Describe"}</ToolButton>
          </div>
          <section className="editor-pane">
            <div className="editor-tabs">
              <button type="button" className={editorTab === "body" ? "active" : ""} onClick={() => setEditorTab("body")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="braces" size={13} /> Message</button>
              <button type="button" className={editorTab === "metadata" ? "active" : ""} onClick={() => setEditorTab("metadata")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="key" size={13} /> Metadata <span className="tab-count">{grpc.metadata.length}</span></button>
              <button type="button" className={editorTab === "proto" ? "active" : ""} onClick={() => setEditorTab("proto")} onDoubleClick={(event) => toggleRequestEditorSize(event, horizontal)}><Icon name="braces" size={13} /> Proto <span className="tab-count">{grpc.protoFiles.length}</span></button>
            </div>
            {editorTab === "body" && (
              <JsonEditor value={grpc.message} onChange={(message) => update({ grpc: { ...grpc, message } })} variableNames={variableNames} />
            )}
            {editorTab === "metadata" && <KvEditor items={grpc.metadata} onChange={(metadata) => update({ grpc: { ...grpc, metadata } })} keyPlaceholder="metadata key" />}
            {editorTab === "proto" && (
              <div className="proto-panel">
                <div className="proto-actions">
                  <ToolButton variant="primary" onClick={() => void importProtoFiles()} disabled={describing}><Icon name="braces" size={13} /> {describing ? "Describing…" : "Import .proto"}</ToolButton>
                  <ToolButton onClick={() => void describe("files")} disabled={describing || grpc.protoFiles.length === 0}>Describe</ToolButton>
                </div>
                {grpc.protoFiles.length === 0 ? (
                  <div className="empty-note">No .proto files. Import to load and describe.</div>
                ) : (
                  <ul className="proto-files">
                    {grpc.protoFiles.map((f) => (
                      <li key={f}>
                        <span className="proto-path" title={f}>{f}</span>
                        <button type="button" className="proto-remove" aria-label="Remove file" onClick={() => update({ grpc: { ...grpc, protoFiles: grpc.protoFiles.filter((p) => p !== f) } })}>✕</button>
                      </li>
                    ))}
                  </ul>
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
            </div>
            <div className="ws-log">
              {wsLog.length === 0 && <div className="empty-note">No messages yet. Connect and send one.</div>}
              {wsLog.map((m, i) => <div key={i} className={`ws-msg ${m.dir}`}><span className="dir">{m.dir}</span><span>{m.text}</span></div>)}
            </div>
            <div className="ws-compose">
              <input value={wsDraft} onChange={(e) => setWsDraft(e.target.value)} placeholder="Message to send…" onKeyDown={(e) => e.key === "Enter" && void wsSend()} />
              <ToolButton variant="primary" disabled={!wsConnected} onClick={wsSend}><Icon name="send" /> Send</ToolButton>
            </div>
          </section>
        </>
      )}

      {request.protocol !== "ws" && (
        <>
          <div className="bottom-resizer" title="Resize response" onPointerDown={(event) => startResize(event, horizontal ? "request-x" : "request")} />
          <section className={`response ${rt.running ? "loading" : ""}`}>
            <div className="response-head">
              <strong>Response</strong>
              {rt.response && "status" in rt.response && (
                <span className={`response-status ${rt.response.status < 300 ? "ok" : rt.response.status < 500 ? "warn" : "err"}`}>{rt.response.status}</span>
              )}
              {rt.response && "statusCode" in rt.response && <span className="response-status ok">{rt.response.statusCode}</span>}
              {rt.error && <span className="response-status err">{rt.error}</span>}
              <span className="response-meta">
                {rt.response && <span>{rt.response.timeMs}ms</span>}
                <button type="button" className={responseTab === "pretty" ? "active" : ""} onClick={() => setResponseTab("pretty")}><Icon name="braces" size={13} /> Pretty</button>
                <button type="button" className={responseTab === "raw" ? "active" : ""} onClick={() => setResponseTab("raw")}><Icon name="code" size={13} /> Raw</button>
                <button type="button" className={responseTab === "headers" ? "active" : ""} onClick={() => setResponseTab("headers")}><Icon name="list" size={13} /> Headers</button>
                <button type="button" className={responseTab === "cookies" ? "active" : ""} onClick={() => setResponseTab("cookies")}><Icon name="list" size={13} /> Cookies</button>
              </span>
            </div>
            <div className="response-body">
              {!rt.response && !rt.error && <div className="response-empty">{rt.running ? "sending…" : "send a request to see the response"}</div>}
              {rt.response && "body" in rt.response && (responseTab === "pretty" || responseTab === "raw") && (
                responseTab === "pretty" ? <JsonResponseViewer value={tryPretty(rt.response.body)} /> : <JsonView className="response-code json-tree" value={rt.response.body} />
              )}
              {rt.response && "bodyJson" in rt.response && (responseTab === "pretty" || responseTab === "raw") && (
                responseTab === "pretty" ? <JsonResponseViewer value={tryPretty(rt.response.bodyJson)} /> : <JsonView className="response-code json-tree" value={rt.response.bodyJson} />
              )}
              {rt.response && responseTab === "headers" && (
                <table>
                  <thead><tr><th>Name</th><th>Value</th></tr></thead>
                  <tbody>{rt.response.headers.map((h, i) => <tr key={i}><td>{h.key}</td><td>{h.value}</td></tr>)}</tbody>
                </table>
              )}
              {rt.response && responseTab === "cookies" && (() => {
                const cookies = parseSetCookies(rt.response.headers);
                return cookies.length === 0
                  ? <div className="response-empty">No Set-Cookie in this response.</div>
                  : <table><thead><tr><th>Name</th><th>Value</th><th>Attributes</th></tr></thead>
                      <tbody>{cookies.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.value}</td><td>{c.attrs}</td></tr>)}</tbody></table>;
              })()}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function tryPretty(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
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
