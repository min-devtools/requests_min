import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { api, type GhStatus } from "../lib/api";
import { syncNow } from "../lib/ghSync";
import { Icon } from "../ui/Icon";

export function Statusbar() {
  // derived primitives — re-render on target/status changes, not on every store write
  const { activeTabId, collectionName, env, syncDirty, target, running, hasResponse } = useApp(useShallow((s) => {
    const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
    const rt = activeTab?.kind === "request" ? s.requestTabs[s.activeTabId] : null;
    return {
      activeTabId: s.activeTabId,
      collectionName: s.collections.find((c) => c.id === s.activeCollectionId)?.name ?? null,
      env: s.activeEnv,
      syncDirty: s.syncDirty,
      target: rt ? `${rt.request.protocol.toUpperCase()} ${rt.request.http?.url ?? rt.request.grpc?.endpoint ?? rt.request.ws?.url ?? ""}` : null,
      running: rt?.running ?? false,
      hasResponse: !!rt?.response,
    };
  }));
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

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
        <span>{collectionName ?? "no collection"}</span>
        <span style={{ color: env ? "var(--green)" : "var(--text-3)" }}>{env ?? "no environment"}</span>
      </div>
      <div>
        <span>{target ?? "—"}</span>
        <span>{running ? "sending…" : hasResponse ? "done" : "idle"}</span>
      </div>
      <div className="right-status">
        {gh?.connected && (
          <button type="button" className="sync-status" title={syncDirty ? "Local changes pending — click to sync now" : "Collections synced with GitHub"} onClick={onSync} disabled={!syncDirty || syncing}>
            <Icon name="github" size={13} className={syncDirty ? "soft-orange" : "soft-green"} />
            <span className={`sync-badge ${syncDirty ? "dirty" : "synced"}`}>{syncing ? "syncing…" : syncDirty ? "dirty" : "synced"}</span>
          </button>
        )}
        <span>UTF-8</span>
        <span>v{__APP_VERSION__}</span>
        <a className="credit" href="https://www.linkedin.com/in/ngthminh-dev/" target="_blank" rel="noreferrer">by @ngthminhdev</a>
      </div>
    </footer>
  );
}
