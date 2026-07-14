import { useEffect, useState } from "react";
import { Kv } from "../ui/Kv";
import { ToolButton } from "../ui/ToolButton";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import { api, type GhStatus } from "../lib/api";

export function Inspector() {
  const { tabs, activeTabId, requestTabs, activeCollectionId, activeEnvByCollection, collections, showToast } = useApp();
  const [vars, setVars] = useState<Record<string, string>>({});
  const [gh, setGh] = useState<GhStatus | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const rt = activeTab?.kind === "request" ? requestTabs[activeTabId] : null;
  const collectionId = rt?.collectionId ?? activeCollectionId;
  const env = collectionId ? activeEnvByCollection[collectionId] : null;
  const collection = collections.find((c) => c.id === collectionId);

  useEffect(() => {
    if (!collectionId || !env) { setVars({}); return; }
    api.envRead(collectionId, env).then(setVars).catch(() => setVars({}));
  }, [collectionId, env]);

  useEffect(() => { api.ghStatus().then(setGh).catch(() => setGh(null)); }, [activeTabId]);

  return (
    <aside className="inspector">
      <div className="inspector-head">Context</div>
      <div className="inspector-scroll">
        <div className="stack">
          <section className="panel">
            <h3>Active environment</h3>
            {!collection && <div className="empty-note">Select a collection to see its environment.</div>}
            {collection && <Kv label="Collection">{collection.name}</Kv>}
            {collection && <Kv label="Environment">{env ?? "none selected"}</Kv>}
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
              {rt.response && "status" in rt.response && <Kv label="Status">{rt.response.status}</Kv>}
              {rt.response && "statusCode" in rt.response && <Kv label="Status">{rt.response.statusCode}</Kv>}
              {rt.response && <Kv label="Duration">{rt.response.timeMs}ms</Kv>}
              {rt.response && "sizeBytes" in rt.response && <Kv label="Size">{rt.response.sizeBytes} bytes</Kv>}
              {rt.error && <div className="err-note">{rt.error}</div>}
            </section>
          )}

          <section className="panel">
            <h3>GitHub sync</h3>
            <Kv label="Repo">{gh?.repo ?? "not configured"}</Kv>
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
