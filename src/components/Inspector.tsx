import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ToolButton } from "../ui/ToolButton";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import { api, type GrpcResponse, type HttpResponse } from "../lib/api";
import { saveActiveRequest } from "../lib/runRequest";
import { buildCurl, buildGrpcurl } from "./views/RequestView";
import { requestVariableNames, resolveRequestTarget } from "../lib/requestVariables";
import { JsonTreePanel } from "../ui/JsonTreePanel";
import { NodePanel } from "./flow/NodePanel";
import { TransformPanel } from "./flow/TransformPanel";

const runStatusClass = (entry: { status: string; error: string | null }) => {
  if (entry.error) return "err";
  const code = Number(entry.status);
  if (Number.isFinite(code)) return code < 300 ? "ok" : code < 500 ? "warn" : "err";
  return entry.status === "OK" ? "ok" : "err"; // gRPC status name — anything but OK is a failure
};

type StepResponse = HttpResponse | GrpcResponse;
const stepResponseStatus = (r: StepResponse) => "status" in r ? `HTTP ${r.status}` : `gRPC ${r.statusCode}`;
const stepResponseClass = (r: StepResponse) => "status" in r
  ? (r.status < 300 ? "ok" : r.status < 500 ? "warn" : "err")
  : (r.statusCode === "OK" ? "ok" : "err");
// response body is stored as a raw string — parse for the tree view, fall back to the raw text
const stepResponseBody = (r: StepResponse): unknown => {
  const raw = "body" in r ? r.body : r.bodyJson;
  try { return JSON.parse(raw); } catch { return raw; }
};

const relativeTime = (timestamp: number) => {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
};

export function Inspector() {
  const {
    activeEnv, setActiveEnv, envVersion, history,
    openTab, showToast, updateFlowTab,
  } = useApp(useShallow((s) => ({
    activeEnv: s.activeEnv, setActiveEnv: s.setActiveEnv, envVersion: s.envVersion, history: s.history,
    openTab: s.openTab, showToast: s.showToast, updateFlowTab: s.updateFlowTab,
  })));
  const activeTab = useApp((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  // live tab state — the inspector previews the request as it's typed, so this re-renders per edit by design
  const rt = useApp((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.kind === "request" ? s.requestTabs[s.activeTabId] ?? null : null;
  });
  const activeTabId = useApp((s) => s.activeTabId);
  const ft = useApp((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.kind === "flow" ? s.flowTabs[s.activeTabId] ?? null : null;
  });
  // which dock tab is shown is driven by the store (canvas click → step, report row → result)
  const dockTab = ft?.dockTab ?? "step";
  // opening a step reveals a collapsed dock and widens a slim one (session-only — drag to override)
  useEffect(() => {
    if (!ft?.panelNodeId) return;
    const state = useApp.getState();
    if (state.rightCollapsed) state.toggleRight();
    const width = Number(localStorage.getItem("requestsmin:right-w")) || 0;
    if (width < 480) document.body.style.setProperty("--right-w", "520px");
  }, [ft?.panelNodeId]);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [envs, setEnvs] = useState<string[]>([]);
  const [revealSecrets, setRevealSecrets] = useState(false);
  const request = rt?.request;
  const variableNames = request ? requestVariableNames(request) : [];
  const unresolved = variableNames.filter((name) => !(name in secrets) && !(name in vars));
  const resolvedTarget = request ? resolveRequestTarget(request, vars, secrets, revealSecrets) : "";
  const recentRuns = rt ? history.filter((entry) => entry.collectionId === rt.collectionId && entry.request.name === request?.name).slice(0, 8) : [];
  // the open dock step decides which editor (request vs transform) renders in Step detail
  const panelNode = ft ? ft.flow.nodes.find((node) => node.id === ft.panelNodeId) ?? null : null;
  // flow tabs surface the selected step's resolved input here instead of inside the drawer
  const flowStepId = ft ? ft.panelNodeId ?? ft.selectedNodeId : null;
  const flowStep = ft && flowStepId ? ft.flow.nodes.find((node) => node.id === flowStepId) ?? null : null;
  const flowResult = ft && flowStep ? ft.run?.steps[flowStep.id] ?? null : null;

  useEffect(() => {
    api.envList().then(setEnvs).catch(() => setEnvs([]));
  }, [activeTab?.id, envVersion]);

  useEffect(() => {
    if (!activeEnv) { setVars({}); setSecrets({}); return; }
    Promise.all([api.envRead(activeEnv), api.secretRead(activeEnv)])
      .then(([nextVars, nextSecrets]) => { setVars(nextVars); setSecrets(nextSecrets); })
      .catch(() => { setVars({}); setSecrets({}); });
  }, [activeEnv, envVersion]);

  const copyCommand = async () => {
    if (!request || request.protocol === "ws") return;
    try {
      const command = request.protocol === "grpc" ? buildGrpcurl(request) : buildCurl(request);
      await navigator.clipboard.writeText(command);
      showToast("Copied", `${request.protocol === "grpc" ? "grpcurl" : "cURL"} command copied.`);
    } catch (error) {
      showToast("Copy failed", String(error), "err");
    }
  };

  const envSection = (
    <section className="inspector-environment">
      <div className="inspector-section-label"><span className={`status-dot ${activeEnv ? "" : "idle"}`} /> Environment</div>
      <div className="inspector-env-row">
        <select className="method-select" value={activeEnv ?? ""} onChange={(event) => setActiveEnv(event.target.value || null)}>
          <option value="">No environment</option>
          {envs.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button type="button" className="inspector-icon-action" title="Open environments" aria-label="Open environments" onClick={() => openTab("environments")}><Icon name="settings" size={14} /></button>
      </div>
      <span className="inspector-env-meta">{activeEnv ? `${Object.keys(vars).length} active variables` : "Requests use literal values"}</span>
    </section>
  );

  return (
    <aside className="inspector">
      <div className="inspector-head">Command center</div>
      <div className="inspector-scroll">
        {/* flow tabs relocate Environment into the Step-detail pane, so the tab switcher sits at the very top */}
        {!ft && envSection}

        {rt && request ? (
          <div className="inspector-command-body">
            {unresolved.length > 0 && <div className="inspector-variable-warning">{unresolved.length} unresolved variable{unresolved.length === 1 ? "" : "s"}</div>}

            <section className="inspector-actions">
              <div className="inspector-secondary-actions">
                <ToolButton variant="primary" onClick={() => void saveActiveRequest()}><Icon name="save" /> Save</ToolButton>
                {request.protocol !== "ws" && <ToolButton onClick={() => void copyCommand()}><Icon name="copy" /> Copy {request.protocol === "grpc" ? "grpcurl" : "cURL"}</ToolButton>}
              </div>
            </section>

            <section className="inspector-variables">
              <div className="inspector-section-heading">
                <div className="inspector-section-label">Request variables</div>
                {variableNames.some((name) => name in secrets) && (
                  <button type="button" className="inspector-reveal" aria-label="Hold to reveal secrets" title="Hold to reveal secrets"
                    onPointerDown={() => setRevealSecrets(true)} onPointerUp={() => setRevealSecrets(false)} onPointerLeave={() => setRevealSecrets(false)} onBlur={() => setRevealSecrets(false)}>
                    <Icon name="eye" size={13} />
                  </button>
                )}
              </div>
              {variableNames.length ? variableNames.map((name) => {
                const secret = name in secrets;
                const resolved = secret || name in vars;
                const value = secret ? secrets[name] : vars[name];
                return <div className={`inspector-variable-row ${resolved ? value ? "ok" : "empty" : "unresolved"}`} key={name}>
                  <span className="status-dot" />
                  <code>{`{{${name}}}`}</code>
                  <strong>{!resolved ? "Unresolved" : secret && !revealSecrets ? "••••••••" : value || "(empty)"}</strong>
                  <small>{secret ? "Secret" : resolved ? "Environment" : "Missing"}</small>
                </div>;
              }) : <div className="inspector-empty">This request does not use environment variables.</div>}
            </section>

            <section className="inspector-preview">
              <div className="inspector-section-label">Resolved preview</div>
              <div className="inspector-preview-meta">
                <span>{request.http?.method ?? request.protocol.toUpperCase()}</span>
                <small>{unresolved.length ? `${unresolved.length} unresolved` : "Ready"}</small>
              </div>
              <code className="inspector-preview-target">{resolvedTarget || "No target configured"}</code>
            </section>

            <section className="inspector-history">
              <div className="inspector-section-label">Recent runs</div>
              {recentRuns.length ? recentRuns.map((entry) => (
                <div className="inspector-run-row" key={entry.id}>
                  <strong className={runStatusClass(entry)}>{entry.status}</strong>
                  <span>{entry.timeMs === null ? "failed" : `${entry.timeMs}ms`}</span>
                  <time>{relativeTime(entry.timestamp)}</time>
                </div>
              )) : <div className="inspector-empty">Run this request to build a short timeline.</div>}
            </section>
          </div>
        ) : ft ? (
          <div className="inspector-flow">
            <div className="mini-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={dockTab === "step"} className={dockTab === "step" ? "active" : ""} onClick={() => updateFlowTab(activeTabId, { dockTab: "step" })}>Step detail</button>
              <button type="button" role="tab" aria-selected={dockTab === "result"} className={dockTab === "result" ? "active" : ""} onClick={() => updateFlowTab(activeTabId, { dockTab: "result" })}>Step Result</button>
            </div>
            {dockTab === "step" ? (
              <div className="inspector-flow-step-detail">
                {envSection}
                {panelNode?.type === "transform"
                  ? <TransformPanel tabId={activeTabId} />
                  : <NodePanel tabId={activeTabId} />}
              </div>
            ) : (
              <section className="inspector-flow-result">
                {!flowStep ? (
                  <div className="inspector-empty">Select a step to see its result.</div>
                ) : flowStep.type === "delay" ? (
                  <div className="inspector-empty">Delay steps produce no result.</div>
                ) : !flowResult ? (
                  <div className="inspector-empty">Run the flow to capture this step's result.</div>
                ) : (() => {
                  // transform steps carry an `output` (referenced as {{steps.key}}); requests carry a response
                  const isTransform = flowStep.type === "transform";
                  const bodyRef = isTransform ? `{{steps.${flowStep.key}}}` : `{{steps.${flowStep.key}.response.body}}`;
                  return (
                  <>
                    <div className="flow-result-summary">
                      <span className={`flow-result-badge status-${flowResult.status}`}>{flowResult.status}</span>
                      {flowResult.timeMs != null && <span className="flow-result-time">{flowResult.timeMs} ms</span>}
                      {flowResult.stale && <span className="flow-result-stale">stale</span>}
                      <button
                        type="button"
                        className="inspector-icon-action flow-result-copy"
                        title={`Copy ${bodyRef}`}
                        aria-label="Copy step reference"
                        onClick={() => void navigator.clipboard?.writeText(bodyRef)
                          .then(() => showToast("Copied", `${bodyRef} — paste it into a later step.`))}
                      >
                        <Icon name="copy" size={13} />
                      </button>
                    </div>

                    {flowResult.error && <div className="flow-step-error">{flowResult.error}</div>}

                    {isTransform ? (
                      flowResult.status === "success" ? (
                        <div className="flow-result-response">
                          <div className="inspector-section-label"><span>Output</span></div>
                          <JsonTreePanel value={flowResult.output ?? null} />
                        </div>
                      ) : !flowResult.error ? (
                        <div className="inspector-empty">{flowResult.status === "skipped" ? "Step was skipped." : "No output."}</div>
                      ) : null
                    ) : flowResult.response ? (
                      <div className="flow-result-response">
                        <div className="inspector-section-label">
                          <span>Response</span>
                          <span className={`flow-report-code ${stepResponseClass(flowResult.response)}`}>{stepResponseStatus(flowResult.response)}</span>
                        </div>
                        <JsonTreePanel value={stepResponseBody(flowResult.response)} />
                      </div>
                    ) : !flowResult.error ? (
                      <div className="inspector-empty">{flowResult.status === "skipped" ? "Step was skipped." : "No response captured."}</div>
                    ) : null}
                  </>
                  );
                })()}
              </section>
            )}
          </div>
        ) : (
          <section className="inspector-idle">
            <Icon name="activity" size={22} />
            <strong>{activeTab?.title ?? "Workspace"}</strong>
            <span>Open a request to inspect its run context.</span>
          </section>
        )}
      </div>
      {rt?.error && (
        <section className="inspector-error">
          <span>Last run failed</span>
          <strong>{rt.error}</strong>
        </section>
      )}
    </aside>
  );
}
