import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { KvEditor } from "../../ui/KvEditor";
import { JsonEditor } from "../../ui/JsonEditor";
import { JsonView } from "../../ui/JsonView";
import { JsonResponseViewer } from "../../ui/JsonResponseViewer";
import { startResize } from "../ResizeHandles";
import { useApp } from "../../store";
import {
  api, emptyGrpc, emptyHttp, emptyWs, onWsEvent,
  type GrpcCatalog, type Request,
} from "../../lib/api";

function buildCurl(request: Request): string {
  if (!request.http) return "";
  const h = request.http;
  const parts = [`curl -X ${h.method} '${h.url}'`];
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
  const [editorTab, setEditorTab] = useState<"body" | "headers" | "auth" | "params" | "metadata">("body");
  const [responseTab, setResponseTab] = useState<"pretty" | "headers" | "raw">("pretty");
  const [catalog, setCatalog] = useState<GrpcCatalog | null>(null);
  const [describing, setDescribing] = useState(false);
  const [wsLog, setWsLog] = useState<{ dir: "out" | "in" | "sys"; text: string }[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsDraft, setWsDraft] = useState("");
  const wsSid = useMemo(() => `ws-${tabId}`, [tabId]);

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

  const describe = async () => {
    if (!request.grpc) return;
    setDescribing(true);
    try {
      const endpoint = request.grpc.protoSource === "reflection" ? request.grpc.endpoint : null;
      const files = request.grpc.protoSource === "files" ? request.grpc.protoFiles : [];
      const c = await api.grpcDescribe(endpoint, files, request.grpc.insecure);
      setCatalog(c);
      showToast("Described", `${c.services.length} service(s) found.`);
    } catch (err) {
      showToast("Describe failed", String(err), "err");
    } finally {
      setDescribing(false);
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

  return (
    <section className={`content request-screen protocol-${request.protocol} ${active ? "active" : ""}`}>
      <div className="protocol-rail">
        <button type="button" className={`protocol-pill ${request.protocol === "http" ? "active" : ""}`} onClick={() => setProtocol("http")}>
          <span className="status-dot" /> REST
        </button>
        <button type="button" className={`protocol-pill ${request.protocol === "grpc" ? "active" : ""}`} onClick={() => setProtocol("grpc")}>
          <span className="status-dot orange" /> gRPC
        </button>
        <button type="button" className={`protocol-pill ${request.protocol === "ws" ? "active" : ""}`} onClick={() => setProtocol("ws")}>
          <span className="status-dot orange" /> WebSocket
        </button>
        <span className="protocol-spacer" />
        <input
          className="path-input"
          style={{ width: 220 }}
          value={request.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>

      {request.protocol === "http" && request.http && (
        <>
          <div className="request-head">
            <select className={`method-select method-${request.http.method.toLowerCase()}`} value={request.http.method} onChange={(e) => update({ http: { ...request.http!, method: e.target.value } })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => <option key={m}>{m}</option>)}
            </select>
            <input className="query-path-input" value={request.http.url} onChange={(e) => update({ http: { ...request.http!, url: e.target.value } })} placeholder="{{baseUrl}}/v1/resource" />
            <ToolButton className="request-copy" onClick={() => navigator.clipboard?.writeText(buildCurl(request)).then(() => showToast("Copied", "cURL command copied."))}><Icon name="copy" /> Copy cURL</ToolButton>
          </div>
          <section className="editor-pane">
            <div className="editor-tabs">
              <button type="button" className={editorTab === "body" ? "active" : ""} onClick={() => setEditorTab("body")}><Icon name="braces" size={13} /> Body</button>
              <button type="button" className={editorTab === "headers" ? "active" : ""} onClick={() => setEditorTab("headers")}><Icon name="activity" size={13} /> Headers <span className="tab-count">{request.http.headers.length}</span></button>
              <button type="button" className={editorTab === "params" ? "active" : ""} onClick={() => setEditorTab("params")}><Icon name="key" size={13} /> Params <span className="tab-count">{request.http.params.length}</span></button>
              <button type="button" className={editorTab === "auth" ? "active" : ""} onClick={() => setEditorTab("auth")}><Icon name="key" size={13} /> Auth</button>
              <span className="editor-meta"><span>{request.http.insecure ? "TLS verify off" : "TLS verify on"}</span></span>
            </div>
            {editorTab === "body" && (
              <div className="body-editor">
                <div className="body-type-tabs">
                  {(["none", "json", "text", "form"] as const).map((t) => (
                    <button key={t} type="button" className={request.http!.body.type === t ? "active" : ""}
                      onClick={() => update({ http: { ...request.http!, body: { ...request.http!.body, type: t } } })}>{t}</button>
                  ))}
                </div>
                {request.http.body.type === "form" ? (
                  <KvEditor items={request.http.body.fields ?? []} onChange={(fields) => update({ http: { ...request.http!, body: { ...request.http!.body, fields } } })} />
                ) : request.http.body.type !== "none" ? (
                  <JsonEditor
                    value={request.http.body.content ?? ""}
                    onChange={(content) => update({ http: { ...request.http!, body: { ...request.http!.body, content } } })}
                    language={request.http.body.type === "json" ? "json" : "plaintext"}
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
                  <div className="form-row"><label>Token</label><input value={request.http.auth.token ?? ""} onChange={(e) => update({ http: { ...request.http!, auth: { ...request.http!.auth, token: e.target.value } } })} placeholder="{{accessToken}}" /></div>
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
          </section>
        </>
      )}

      {request.protocol === "grpc" && grpc && (
        <>
          <div className="request-head">
            <select className="method-select" style={{ width: 100 }} value={grpc.protoSource} onChange={(e) => update({ grpc: { ...grpc, protoSource: e.target.value as any } })}>
              <option value="reflection">reflection</option>
              <option value="files">.proto files</option>
            </select>
            {grpc.protoSource === "reflection" ? (
              <input className="query-path-input" value={grpc.endpoint} onChange={(e) => update({ grpc: { ...grpc, endpoint: e.target.value } })} placeholder="{{grpcHost}}:50051" />
            ) : (
              <input className="query-path-input" value={grpc.protoFiles.join(", ")} onChange={(e) => update({ grpc: { ...grpc, protoFiles: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} placeholder="/abs/path/a.proto, /abs/path/b.proto" />
            )}
            <ToolButton onClick={describe} disabled={describing}>{describing ? "Describing…" : "Describe"}</ToolButton>
          </div>
          <section className="editor-pane">
            <div className="editor-tabs">
              <button type="button" className={editorTab === "body" ? "active" : ""} onClick={() => setEditorTab("body")}><Icon name="braces" size={13} /> Message</button>
              <button type="button" className={editorTab === "metadata" ? "active" : ""} onClick={() => setEditorTab("metadata")}><Icon name="key" size={13} /> Metadata <span className="tab-count">{grpc.metadata.length}</span></button>
              <span className="editor-meta"><span>{grpc.service && grpc.method ? `${grpc.service}/${grpc.method}` : "no method selected"}</span></span>
            </div>
            {editorTab === "body" && (
              <div style={{ minHeight: 0, display: "grid", gridTemplateRows: catalog ? "auto 1fr" : "1fr" }}>
                {catalog && (
                  <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--line)" }}>
                    <select className="method-select" style={{ width: 180 }} value={grpc.service} onChange={(e) => update({ grpc: { ...grpc, service: e.target.value, method: "" } })}>
                      <option value="">select service…</option>
                      {catalog.services.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                    <select className="method-select" style={{ width: 180 }} value={grpc.method} disabled={!selectedService}
                      onChange={(e) => {
                        const m = selectedService?.methods.find((x) => x.name === e.target.value);
                        update({ grpc: { ...grpc, method: e.target.value, message: m?.inputTemplate ?? grpc.message } });
                      }}>
                      <option value="">select method…</option>
                      {selectedService?.methods.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                    </select>
                  </div>
                )}
                <JsonEditor value={grpc.message} onChange={(message) => update({ grpc: { ...grpc, message } })} />
              </div>
            )}
            {editorTab === "metadata" && <KvEditor items={grpc.metadata} onChange={(metadata) => update({ grpc: { ...grpc, metadata } })} keyPlaceholder="metadata key" />}
          </section>
        </>
      )}

      {request.protocol === "ws" && request.ws && (
        <>
          <div className="request-head">
            <input className="query-path-input" value={request.ws.url} onChange={(e) => update({ ws: { ...request.ws!, url: e.target.value } })} placeholder="wss://{{wsHost}}/socket" />
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
          <div className="bottom-resizer" title="Resize response" onPointerDown={(event) => startResize(event, "request")} />
          <section className="response">
            <div className="response-head">
              <strong>Response</strong>
              {rt.response && "status" in rt.response && (
                <span className={`response-status ${rt.response.status < 300 ? "ok" : rt.response.status < 500 ? "warn" : "err"}`}>{rt.response.status}</span>
              )}
              {rt.response && "statusCode" in rt.response && <span className="response-status ok">{rt.response.statusCode}</span>}
              {rt.error && <span className="response-status err">{rt.error}</span>}
              <span className="response-meta">
                {rt.response && <span>{rt.response.timeMs}ms</span>}
                <button type="button" className={responseTab === "pretty" ? "active" : ""} onClick={() => setResponseTab("pretty")}>Pretty</button>
                <button type="button" className={responseTab === "raw" ? "active" : ""} onClick={() => setResponseTab("raw")}>Raw</button>
                <button type="button" className={responseTab === "headers" ? "active" : ""} onClick={() => setResponseTab("headers")}>Headers</button>
              </span>
            </div>
            <div className="response-body">
              {!rt.response && !rt.error && <div className="response-empty">{rt.running ? "sending…" : "send a request to see the response"}</div>}
              {rt.response && "body" in rt.response && responseTab !== "headers" && (
                responseTab === "pretty" ? <JsonResponseViewer value={tryPretty(rt.response.body)} /> : <JsonView className="response-code json-tree" value={rt.response.body} />
              )}
              {rt.response && "bodyJson" in rt.response && responseTab !== "headers" && (
                responseTab === "pretty" ? <JsonResponseViewer value={tryPretty(rt.response.bodyJson)} /> : <JsonView className="response-code json-tree" value={rt.response.bodyJson} />
              )}
              {rt.response && responseTab === "headers" && (
                <table>
                  <thead><tr><th>Name</th><th>Value</th></tr></thead>
                  <tbody>{rt.response.headers.map((h, i) => <tr key={i}><td>{h.key}</td><td>{h.value}</td></tr>)}</tbody>
                </table>
              )}
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
