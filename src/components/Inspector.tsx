import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ToolButton } from "../ui/ToolButton";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import { api } from "../lib/api";
import { saveActiveRequest } from "../lib/runRequest";
import { buildCurl, buildGrpcurl } from "./views/RequestView";
import { requestVariableNames, resolveRequestTarget } from "../lib/requestVariables";

const runStatusClass = (entry: { status: string; error: string | null }) => {
  if (entry.error) return "err";
  const code = Number(entry.status);
  if (Number.isFinite(code)) return code < 300 ? "ok" : code < 500 ? "warn" : "err";
  return entry.status === "OK" ? "ok" : "err"; // gRPC status name — anything but OK is a failure
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
    openTab, newRequestTab, showToast,
  } = useApp(useShallow((s) => ({
    activeEnv: s.activeEnv, setActiveEnv: s.setActiveEnv, envVersion: s.envVersion, history: s.history,
    openTab: s.openTab, newRequestTab: s.newRequestTab, showToast: s.showToast,
  })));
  const activeTab = useApp((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  // live tab state — the inspector previews the request as it's typed, so this re-renders per edit by design
  const rt = useApp((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.kind === "request" ? s.requestTabs[s.activeTabId] ?? null : null;
  });
  const [vars, setVars] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [envs, setEnvs] = useState<string[]>([]);
  const [revealSecrets, setRevealSecrets] = useState(false);
  const request = rt?.request;
  const variableNames = request ? requestVariableNames(request) : [];
  const unresolved = variableNames.filter((name) => !(name in secrets) && !(name in vars));
  const resolvedTarget = request ? resolveRequestTarget(request, vars, secrets, revealSecrets) : "";
  const recentRuns = rt ? history.filter((entry) => entry.collectionId === rt.collectionId && entry.request.name === request?.name).slice(0, 8) : [];

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

  return (
    <aside className="inspector">
      <div className="inspector-head">Command center</div>
      <div className="inspector-scroll">
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
        ) : (
          <section className="inspector-idle">
            <Icon name="activity" size={22} />
            <strong>{activeTab?.title ?? "Workspace"}</strong>
            <span>Open a request to inspect its run context.</span>
            <ToolButton variant="primary" onClick={() => newRequestTab()}><Icon name="plus" /> New request</ToolButton>
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
