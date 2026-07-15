import { useEffect, useState } from "react";
import { Kv } from "../ui/Kv";
import { ToolButton } from "../ui/ToolButton";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import { api, type GhStatus } from "../lib/api";

export function Inspector() {
  const { tabs, activeTabId, requestTabs, activeEnv, setActiveEnv, showToast, envVersion } = useApp();
  const [vars, setVars] = useState<Record<string, string>>({});
  const [envs, setEnvs] = useState<string[]>([]);
  const [gh, setGh] = useState<GhStatus | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const rt = activeTab?.kind === "request" ? requestTabs[activeTabId] : null;
  const env = activeEnv;

  useEffect(() => {
    api.envList().then(setEnvs).catch(() => setEnvs([]));
  }, [activeTabId, envVersion]);

  useEffect(() => {
    if (!env) { setVars({}); return; }
    api.envRead(env).then(setVars).catch(() => setVars({}));
  }, [env, envVersion]);

  useEffect(() => { api.ghStatus().then(setGh).catch(() => setGh(null)); }, [activeTabId]);

  return (
    <aside className="inspector">
      <div className="inspector-head">Context</div>
      <div className="inspector-scroll">
        <div className="stack">
          <section className="panel">
            <h3>Active environment</h3>
            <div className="kv"><span>Environment</span><select className="method-select" value={env ?? ""} onChange={(event) => setActiveEnv(event.target.value || null)}><option value="">none selected</option>{envs.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>
            {envs.length === 0 && <div className="empty-note">No environments yet. Create one in the Environments tab.</div>}
            {env && Object.keys(vars).length === 0 && <div className="empty-note">No variables set.</div>}
            {Object.entries(vars).map(([k, v]) => (
              <Kv key={k} label={k}>{v || "(empty)"}</Kv>
            ))}
          </section>

          {rt && (
            <section className="panel">
              <h3>Request</h3>
              <Kv label="Protocol">{rt.request.protocol.toUpperCase()}</Kv>
              <Kv label="Saved">{rt.relPath ?? "not saved yet"}</Kv>
              {rt.response && "status" in rt.response && <Kv label="Status" className={`metric-status ${rt.response.status < 300 ? "ok" : rt.response.status < 500 ? "warn" : "err"}`}>{rt.response.status}</Kv>}
              {rt.response && "statusCode" in rt.response && <Kv label="Status" className={`metric-status ${rt.response.statusCode === "OK" ? "ok" : "err"}`}>{rt.response.statusCode}</Kv>}
              {rt.response && <Kv label="Duration" className="metric-duration">{rt.response.timeMs}ms</Kv>}
              {rt.response && "sizeBytes" in rt.response && <Kv label="Size" className="metric-size">{rt.response.sizeBytes} bytes</Kv>}
              {rt.error && <div className="err-note">{rt.error}</div>}
            </section>
          )}

          <section className="panel">
            <h3>GitHub sync</h3>
            <Kv label="Repo">{gh?.repo ? gh.repo.split("/").pop() : "not configured"}</Kv>
            <Kv label="Login">{gh?.login ?? "—"}</Kv>
            <Kv label="Last SHA">{gh?.lastSha ? gh.lastSha.slice(0, 7) : "—"}</Kv>
            <ToolButton
              style={{ marginTop: 8, width: "100%" }}
              disabled={!gh?.connected}
              onClick={async () => {
                try {
                  const res = await api.ghPull(false);
                  showToast(res.conflict ? "Pull blocked" : "Pulled", res.conflict ? "Local changes conflict with remote." : "Collections are up to date.");
                } catch (err) {
                  showToast("Pull failed", String(err), "err");
                }
              }}
            >
              <Icon name="github" /> Pull latest
            </ToolButton>
          </section>
        </div>
      </div>
    </aside>
  );
}
