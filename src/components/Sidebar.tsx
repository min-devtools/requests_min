import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Icon, type IconName } from "../ui/Icon";
import { RequestContextMenu } from "./RequestContextMenu";
import { useApp, type TabKind } from "../store";
import { api, type GhStatus, type ReqEntry } from "../lib/api";

const WORKSPACE_NAV: { kind: Exclude<TabKind, "request">; icon: IconName; label: string }[] = [
  { kind: "welcome", icon: "sparkles", label: "Welcome" },
  { kind: "collections", icon: "database", label: "Collections" },
  { kind: "environments", icon: "key", label: "Environments" },
  { kind: "history", icon: "history", label: "Request History" },
  { kind: "import-export", icon: "copy", label: "Import / Export" },
  { kind: "github-sync", icon: "github", label: "GitHub Sync" },
  { kind: "ai-import", icon: "wand", label: "AI import" },
  { kind: "settings", icon: "settings", label: "Settings" },
];

export function Sidebar() {
  const [filter, setFilter] = useState("");
  const [requestsByCollection, setRequestsByCollection] = useState<Record<string, ReqEntry[]>>({});
  const [collapsedCollections, setCollapsedCollections] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("requestsmin:collapsed-collections") ?? "[]") as string[]); }
    catch { return new Set(); }
  });
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [requestMenu, setRequestMenu] = useState<{ collectionId: string; request: ReqEntry; x: number; y: number } | null>(null);
  const {
    tabs, activeTabId, requestTabs, openTab, openRequestTab, collections, reloadCollections,
    activeCollectionId, setActiveCollection, reqListVersion, workspaceNavCollapsed, toggleWorkspaceNav,
  } = useApp();

  useEffect(() => { void reloadCollections(); }, []);
  useEffect(() => { api.ghStatus().then(setGh).catch(() => setGh(null)); }, []);

  useEffect(() => {
    void Promise.all(collections.map(async (collection) => {
      try { return [collection.id, await api.reqList(collection.id)] as const; }
      catch { return [collection.id, []] as const; }
    })).then((entries) => setRequestsByCollection(Object.fromEntries(entries)));
  }, [collections, reqListVersion]);

  useEffect(() => {
    if (!activeCollectionId && collections.length) setActiveCollection(collections[0].id);
  }, [collections, activeCollectionId, setActiveCollection]);

  const activeKind = tabs.find((t) => t.id === activeTabId)?.kind;
  const q = filter.trim().toLowerCase();
  const activeRequest = requestTabs[activeTabId];
  const toggleCollection = (id: string) => {
    setActiveCollection(id);
    setCollapsedCollections((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("requestsmin:collapsed-collections", JSON.stringify([...next]));
      return next;
    });
  };
  const openRequestMenu = (event: React.MouseEvent, collectionId: string, request: ReqEntry) => {
    event.preventDefault();
    setRequestMenu({ collectionId, request, x: event.clientX, y: event.clientY });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <input
          className="side-search"
          placeholder="Filter requests, collections…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="side-scroll">
        <div className={`group collapsible-group ${workspaceNavCollapsed ? "collapsed" : ""}`}>
          <button type="button" className="group-title group-toggle" onClick={toggleWorkspaceNav} aria-expanded={!workspaceNavCollapsed}>
            <span>Workspace</span><Icon name="chevron-down" size={12} />
          </button>
          <div className="group-content">{WORKSPACE_NAV.map((item) => (
            <div key={item.kind} className={`nav-item ${activeKind === item.kind ? "active" : ""}`} onClick={() => openTab(item.kind)}>
              <Icon name={item.icon} className="soft-blue" />
              <span>{item.label}</span>
              <span />
            </div>
          ))}</div>
        </div>

        <div className="group">
          <div className="group-title"><span>Collections</span><span>{collections.length || ""}</span></div>
          {collections.length === 0 && <div className="empty-note">No collections yet. Save a request to create one.</div>}
          {collections.map((c) => {
            const requests = (requestsByCollection[c.id] ?? []).filter((r) => !q || c.name.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
            if (q && requests.length === 0 && !c.name.toLowerCase().includes(q)) return null;
            const collapsed = !q && collapsedCollections.has(c.id);
            return <div key={c.id} className={`collection-tree ${collapsed ? "collapsed" : ""}`}>
              <button type="button" className={`nav-item collection-node ${c.id === activeCollectionId ? "active" : ""}`} onClick={() => toggleCollection(c.id)} aria-expanded={!collapsed}>
                <Icon name="chevron-down" className="collection-chevron" size={13} />
                <span>{c.name}</span>
                <Badge>{(requestsByCollection[c.id] ?? []).length || ""}</Badge>
              </button>
              <div className="collection-requests">
                {requests.length === 0 && <div className="empty-note collection-empty">No requests. Use ⌘N to add one.</div>}
                {requests.map((r) => (
                  <button
                    type="button"
                    key={r.relPath}
                    className={`nav-item request-node ${activeRequest?.collectionId === c.id && activeRequest.relPath === r.relPath ? "active" : ""}`}
                    title={r.relPath}
                    onClick={() => { setActiveCollection(c.id); void openRequestTab(c.id, r.relPath); }}
                    onContextMenu={(event) => openRequestMenu(event, c.id, r)}
                  >
                    <span className={`method-tag ${r.method}`}>{r.method}</span>
                    <span>{r.name}</span>
                    <span />
                  </button>
                ))}
              </div>
            </div>;
          })}
          </div>

        <div className="group">
          <div className="group-title"><span>GitHub</span><span /></div>
          <div className="nav-item" onClick={() => openTab("settings")}>
            <Icon name="github" className={gh?.connected ? "soft-green" : undefined} />
            <span>{gh?.repo ?? "not connected"}</span>
            {gh?.connected && <Badge tone="green">synced</Badge>}
          </div>
        </div>
      </div>
      {requestMenu && <RequestContextMenu
        collectionId={requestMenu.collectionId}
        relPath={requestMenu.request.relPath}
        title={requestMenu.request.name}
        x={requestMenu.x}
        y={requestMenu.y}
        onOpen={() => { setActiveCollection(requestMenu.collectionId); void openRequestTab(requestMenu.collectionId, requestMenu.request.relPath); }}
        onClose={() => setRequestMenu(null)}
      />}
    </aside>
  );
}
