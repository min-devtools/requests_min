import { useEffect, useRef, useState } from "react";
import { Badge } from "../ui/Badge";
import { Icon, type IconName } from "../ui/Icon";
import { RequestContextMenu } from "./RequestContextMenu";
import { useApp, type TabKind } from "../store";
import { api, type ReqEntry } from "../lib/api";

type DragItem = { kind: "collection"; id: string } | { kind: "request"; collectionId: string; relPath: string };

const WORKSPACE_NAV: { kind: Exclude<TabKind, "request">; icon: IconName; label: string }[] = [
  { kind: "welcome", icon: "sparkles", label: "Welcome" },
  { kind: "collections", icon: "database", label: "Collections" },
  { kind: "environments", icon: "key", label: "Environments" },
  { kind: "history", icon: "history", label: "Request History" },
  { kind: "import-export", icon: "copy", label: "Import / Export" },
  { kind: "github-sync", icon: "github", label: "GitHub Sync" },
  { kind: "settings", icon: "settings", label: "Settings" },
];

export function Sidebar() {
  const [filter, setFilter] = useState("");
  const [requestsByCollection, setRequestsByCollection] = useState<Record<string, ReqEntry[]>>({});
  const [collapsedCollections, setCollapsedCollections] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("requestsmin:collapsed-collections") ?? "[]") as string[]); }
    catch { return new Set(); }
  });
  const [requestMenu, setRequestMenu] = useState<{ collectionId: string; request: ReqEntry; x: number; y: number } | null>(null);
  const [dragOverCollection, setDragOverCollection] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const {
    tabs, activeTabId, requestTabs, openTab, openRequestTab, collections, reloadCollections,
    activeCollectionId, setActiveCollection, reqListVersion, workspaceNavCollapsed, toggleWorkspaceNav,
    openDialog, openConfirm, deleteRequest, renameRequest, duplicateRequest, moveRequest, showToast, leftCollapsed,
  } = useApp();

  useEffect(() => { void reloadCollections(); }, []);

  // Left dock collapse folds every collection; reopening unfolds them all. Skip initial mount to keep persisted state.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    const next = leftCollapsed ? new Set(collections.map((c) => c.id)) : new Set<string>();
    setCollapsedCollections(next);
    localStorage.setItem("requestsmin:collapsed-collections", JSON.stringify([...next]));
  }, [leftCollapsed]);

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
  const selectedRequest = activeRequest?.collectionId && activeRequest.relPath
    ? (requestsByCollection[activeRequest.collectionId] ?? []).find((request) => request.relPath === activeRequest.relPath)
    : undefined;
  const selected = activeRequest?.collectionId && selectedRequest
    ? { collectionId: activeRequest.collectionId, request: selectedRequest }
    : null;
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

  const renameReq = async (collectionId: string, r: ReqEntry) => {
    const name = await openDialog({ title: "Rename request", defaultValue: r.name, confirmLabel: "Rename" });
    if (name == null || name.trim() === r.name) return;
    try { await renameRequest(collectionId, r.relPath, name.trim()); }
    catch (error) { showToast("Rename failed", String(error), "err"); }
  };
  const duplicateReq = async (collectionId: string, r: ReqEntry) => {
    try { await duplicateRequest(collectionId, r.relPath, `${r.name} copy`); showToast("Request duplicated", r.name); }
    catch (error) { showToast("Duplicate failed", String(error), "err"); }
  };
  const deleteReq = async (collectionId: string, r: ReqEntry) => {
    if (!await openConfirm({ title: "Delete request", message: `Delete "${r.name}"? This cannot be undone.`, danger: true, confirmLabel: "Delete" })) return;
    try { await deleteRequest(collectionId, r.relPath); showToast("Request deleted", r.name); }
    catch (error) { showToast("Delete failed", String(error), "err"); }
  };

  // WebKit (Tauri macOS) doesn't focus <button> on click, so these can't be per-node
  // onKeyDown handlers. Listen globally and act on the selected request, but stay out of
  // the way while the user types in an input / Monaco (where ⌘D etc. mean other things).
  useEffect(() => {
    if (!selected?.request) return;
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const editable = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || !!el.closest(".monaco-editor"));
      if (editable) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const { collectionId, request } = selected;
      if (mod && key === "d") { event.preventDefault(); void duplicateReq(collectionId, request); }
      else if (mod && key === "e") { event.preventDefault(); void renameReq(collectionId, request); }
      else if (!mod && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault(); void deleteReq(collectionId, request); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);
  const onDropOnCollection = (event: React.DragEvent, collectionId: string) => {
    event.preventDefault();
    setDragOverCollection(null);
    setDropIndicator(null);
    try {
      const item = JSON.parse(event.dataTransfer.getData("application/json")) as DragItem;
      if (item.kind === "collection") {
        const from = item.id;
        const row = (event.target as HTMLElement).closest(".collection-node")?.getBoundingClientRect();
        if (!row || event.clientY < row.top + row.height / 2) void reorderCollections(from, collectionId);
        else void reorderCollections(from, collections[collections.findIndex((collection) => collection.id === collectionId) + 1]?.id ?? null);
        return;
      }
      const { collectionId: from, relPath } = item;
      if (from === collectionId) return;
      void moveRequest(from, relPath, collectionId).then(() => showToast("Request moved")).catch((error) => showToast("Move failed", String(error), "err"));
    } catch { /* ignore malformed drop */ }
  };
  const reorderCollections = async (from: string, before: string | null) => {
    if (from === before) return;
    const order = collections.map((collection) => collection.id).filter((id) => id !== from);
    order.splice(before ? order.indexOf(before) : order.length, 0, from);
    try { await api.colReorder(order); await reloadCollections(); }
    catch (error) { showToast("Reorder failed", String(error), "err"); }
  };
  const reorderRequests = async (collectionId: string, from: string, before: string | null) => {
    if (from === before) return;
    const order = (requestsByCollection[collectionId] ?? []).map((request) => request.relPath).filter((path) => path !== from);
    order.splice(before ? order.indexOf(before) : order.length, 0, from);
    try {
      await api.reqReorder(collectionId, order);
      setRequestsByCollection((current) => ({ ...current, [collectionId]: order.map((path) => current[collectionId].find((request) => request.relPath === path)!) }));
    } catch (error) { showToast("Reorder failed", String(error), "err"); }
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
            return <div
              key={c.id}
              className={`collection-tree ${collapsed ? "collapsed" : ""} ${dragOverCollection === c.id ? "drop-target" : ""}`}
              onDragOver={(event) => { event.preventDefault(); if (dragging?.kind === "collection") setDropIndicator(`collection:${c.id}`); else if (dragOverCollection !== c.id) setDragOverCollection(c.id); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setDragOverCollection(null); setDropIndicator(null); } }}
              onDrop={(event) => onDropOnCollection(event, c.id)}
            >
              <button type="button" className={`nav-item collection-node ${c.id === activeCollectionId ? "active" : ""} ${dropIndicator === `collection:${c.id}` ? "drop-prefix" : ""}`} draggable onDragStart={(event) => { const item = { kind: "collection", id: c.id } as const; setDragging(item); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/json", JSON.stringify(item)); }} onDragEnd={() => { setDragging(null); setDropIndicator(null); setDragOverCollection(null); }} onClick={() => toggleCollection(c.id)} aria-expanded={!collapsed}>
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
                    className={`nav-item request-node ${activeRequest?.collectionId === c.id && activeRequest.relPath === r.relPath ? "active" : ""} ${selected?.collectionId === c.id && selected.request.relPath === r.relPath ? "selected" : ""} ${dropIndicator === `request:${c.id}:${r.relPath}` ? "drop-prefix" : ""}`}
                    title={r.relPath}
                    draggable
                    onDragStart={(event) => { const item = { kind: "request", collectionId: c.id, relPath: r.relPath } as const; setDragging(item); event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/json", JSON.stringify(item)); }}
                    onDragEnd={() => { setDragging(null); setDropIndicator(null); setDragOverCollection(null); }}
                    onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); if (dragging?.kind === "request" && dragging.collectionId === c.id) setDropIndicator(`request:${c.id}:${r.relPath}`); }}
                    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDropIndicator(null); try { const from = JSON.parse(event.dataTransfer.getData("application/json")) as DragItem; if (from.kind === "request" && from.collectionId === c.id) { if (event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2) void reorderRequests(c.id, from.relPath, r.relPath); else void reorderRequests(c.id, from.relPath, requests[requests.findIndex((request) => request.relPath === r.relPath) + 1]?.relPath ?? null); } else onDropOnCollection(event, c.id); } catch { /* ignore malformed drop */ } }}
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

      </div>
      {requestMenu && <RequestContextMenu
        x={requestMenu.x}
        y={requestMenu.y}
        onOpen={() => { setActiveCollection(requestMenu.collectionId); void openRequestTab(requestMenu.collectionId, requestMenu.request.relPath); }}
        onRename={() => void renameReq(requestMenu.collectionId, requestMenu.request)}
        onDuplicate={() => void duplicateReq(requestMenu.collectionId, requestMenu.request)}
        onDelete={() => void deleteReq(requestMenu.collectionId, requestMenu.request)}
        onClose={() => setRequestMenu(null)}
      />}
    </aside>
  );
}
