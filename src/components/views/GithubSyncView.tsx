import { useEffect, useState } from "react";
import { api, type GhStatus } from "../../lib/api";
import { useApp } from "../../store";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { DEFAULT_REPO } from "../../lib/ghSync";

export function GithubSyncView({ active }: { active: boolean }) {
  const { showToast, bumpReqList, reloadCollections } = useApp();
  const [status, setStatus] = useState<GhStatus | null>(null);
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState<"save" | "push" | "pull" | null>(null);
  const refresh = async () => { const next = await api.ghStatus(); setStatus(next); setRepo(next.repo ?? DEFAULT_REPO); };
  useEffect(() => { void refresh().catch(() => setStatus(null)); }, []);

  const act = async (action: "save" | "push" | "pull") => {
    setRunning(action);
    try {
      if (action === "save") {
        if (token.trim()) await api.ghSetToken(token.trim());
        if (repo.trim()) await api.ghConfigure(repo.trim());
        setToken("");
        showToast("GitHub configured", repo.trim());
      } else if (action === "push") {
        const sha = await api.ghPush(message.trim() || null);
        showToast("Pushed", `Remote commit ${sha.slice(0, 7)}.`);
      } else {
        const result = await api.ghPull(false);
        if (result.conflict) showToast("Pull blocked", "Remote and local collections conflict. Force pull only after reviewing local changes.", "warn");
        else showToast("Pulled", result.updated ? "Local collections updated." : "Already up to date.");
        await reloadCollections(); bumpReqList();
      }
      await refresh();
    } catch (err) { showToast(`${action} failed`, String(err), "err"); }
    finally { setRunning(null); }
  };

  return <section className={`content utility-view ${active ? "active" : ""}`}>
    <header className="page-head"><div><div className="eyebrow">Remote storage</div><h1>GitHub Sync</h1><p>Keep plain-file collections in one private repository. Secrets never enter this flow.</p></div><span className={`badge ${status?.connected ? "green" : "idle"}`}>{status?.connected ? `connected · ${status.login}` : "not connected"}</span></header>
    <div className="utility-grid">
      <section className="workspace-card"><h3>Connection</h3><div className="form-stack"><label>Personal access token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" /></label><label>Repository<input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={DEFAULT_REPO} /></label></div><div className="card-actions"><ToolButton variant="primary" disabled={running !== null || (!token.trim() && !repo.trim())} onClick={() => void act("save")}>{running === "save" ? "Saving…" : "Save connection"}</ToolButton></div></section>
      <section className="workspace-card"><h3>Synchronization</h3><div className="sync-summary"><div><span>Repository</span><strong>{status?.repo ?? "not configured"}</strong></div><div><span>Last SHA</span><strong>{status?.lastSha?.slice(0, 7) ?? "—"}</strong></div></div><label className="commit-field">Commit message<input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Update API collections" /></label><div className="card-actions"><ToolButton disabled={!status?.connected || running !== null} onClick={() => void act("pull")}><Icon name="refresh" /> {running === "pull" ? "Pulling…" : "Pull"}</ToolButton><ToolButton variant="primary" disabled={!status?.connected || running !== null} onClick={() => void act("push")}><Icon name="github" /> {running === "push" ? "Pushing…" : "Push"}</ToolButton></div></section>
    </div>
  </section>;
}
