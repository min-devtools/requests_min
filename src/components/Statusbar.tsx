import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { api, type GhStatus } from "../lib/api";
import { syncNow } from "../lib/ghSync";
import { Icon } from "../ui/Icon";
import { UpdateBadge } from "../lib/updateCheck";

export function Statusbar() {
  // derived primitives — re-render on target/status changes, not on every store write
  const { activeTabId, collectionName, env, syncDirty } = useApp(useShallow((s) => {
    return {
      activeTabId: s.activeTabId,
      collectionName: s.collections.find((c) => c.id === s.activeCollectionId)?.name ?? null,
      env: s.activeEnv,
      syncDirty: s.syncDirty,
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
      <div className="right-status">
        {gh?.connected && (
          <button type="button" className="sync-status" title={syncDirty ? "Local changes pending — click to sync now" : "Collections synced with GitHub"} onClick={onSync} disabled={!syncDirty || syncing}>
            <Icon name="github" size={13} className={syncDirty ? "soft-orange" : "soft-green"} />
            <span className={`sync-badge ${syncDirty ? "dirty" : "synced"}`}>{syncing ? "syncing…" : syncDirty ? "dirty" : "synced"}</span>
          </button>
        )}
        <span>UTF-8</span>
        <span>v{__APP_VERSION__}</span>
        <UpdateBadge repo="min-devtools/requests_min" />
        <a className="credit" href="https://www.linkedin.com/in/ngthminh-dev/" target="_blank" rel="noreferrer">by @ngthminhdev</a>
      </div>
    </footer>
  );
}
