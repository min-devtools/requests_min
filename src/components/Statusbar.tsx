import { useEffect, useState } from "react";
import { useApp } from "../store";
import { api, type GhStatus } from "../lib/api";
import { syncNow } from "../lib/ghSync";
import { Icon } from "../ui/Icon";
import { version } from "../../package.json";

export function Statusbar() {
  const { tabs, activeTabId, requestTabs, collections, activeCollectionId, activeEnv, syncDirty } = useApp();
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const rt = activeTab?.kind === "request" ? requestTabs[activeTabId] : null;
  const collection = collections.find((c) => c.id === activeCollectionId);
  const env = activeEnv;

  // refresh gh status on tab switch and whenever the pending-sync flag flips
  useEffect(() => { api.ghStatus().then(setGh).catch(() => setGh(null)); }, [activeTabId, syncDirty]);

  const onSync = async () => {
    if (syncing || !syncDirty) return;
    setSyncing(true);
    try { await syncNow(); } finally { setSyncing(false); }
  };

  return (
    <footer className="statusbar">
      <div>
        <span>{collection ? collection.name : "no collection"}</span>
        <span style={{ color: env ? "var(--green)" : "var(--text-3)" }}>{env ?? "no environment"}</span>
      </div>
      <div>
        <span>{rt ? `${rt.request.protocol.toUpperCase()} ${rt.request.http?.url ?? rt.request.grpc?.endpoint ?? rt.request.ws?.url ?? ""}` : "—"}</span>
        <span>{rt?.running ? "sending…" : rt?.response ? "done" : "idle"}</span>
      </div>
      <div className="right-status">
        {gh?.connected && (
          <button type="button" className="sync-status" title={syncDirty ? "Local changes pending — click to sync now" : "Collections synced with GitHub"} onClick={onSync} disabled={!syncDirty || syncing}>
            <Icon name="github" size={13} className={syncDirty ? "soft-orange" : "soft-green"} />
            <span className={`sync-badge ${syncDirty ? "dirty" : "synced"}`}>{syncing ? "syncing…" : syncDirty ? "dirty" : "synced"}</span>
          </button>
        )}
        <span>UTF-8</span>
        <span>v{version}</span>
        <a className="credit" href="https://www.linkedin.com/in/ngthminh-dev/" target="_blank" rel="noreferrer">by @ngthminhdev</a>
      </div>
    </footer>
  );
}
