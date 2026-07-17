import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "../ui/Icon";
import { RequestContextMenu } from "./RequestContextMenu";
import { useApp } from "../store";

export function TabsBar() {
  const {
    tabs, activeTabId, activateTab, confirmCloseTab, requestTabs, newRequestTab, renameTab, reorderTab,
    openDialog, openConfirm, showToast, renameRequest, duplicateRequest, deleteRequest,
  } = useApp(useShallow((s) => ({
    tabs: s.tabs, activeTabId: s.activeTabId, activateTab: s.activateTab, confirmCloseTab: s.confirmCloseTab,
    requestTabs: s.requestTabs, newRequestTab: s.newRequestTab, renameTab: s.renameTab, reorderTab: s.reorderTab,
    openDialog: s.openDialog, openConfirm: s.openConfirm, showToast: s.showToast,
    renameRequest: s.renameRequest, duplicateRequest: s.duplicateRequest, deleteRequest: s.deleteRequest,
  })));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [requestMenu, setRequestMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.select(); }, [editingId]);
  const commit = () => { if (editingId) renameTab(editingId, draft); setEditingId(null); };

  return (
    <nav className="tabs">
      {tabs.map((tab) => {
        const rt = tab.kind === "request" ? requestTabs[tab.id] : null;
        const dirty = rt?.dirty ?? false;
        const method = rt?.request.protocol === "http"
          ? rt.request.http?.method ?? "HTTP"
          : rt?.request.protocol === "grpc" ? "RPC"
          : rt ? "WS" : null;
        return (
          <button
            key={tab.id}
            type="button"
            draggable={!editingId}
            className={`tab ${tab.id === activeTabId ? "active" : ""} ${dragId === tab.id ? "dragging" : ""} ${overId === tab.id ? "drag-over" : ""}`}
            onClick={() => activateTab(tab.id)}
            onContextMenu={(event) => { if (!rt?.collectionId || !rt.relPath) return; event.preventDefault(); setRequestMenu({ tabId: tab.id, x: event.clientX, y: event.clientY }); }}
            onAuxClick={(e) => { if (e.button === 1) void confirmCloseTab(tab.id); }}
            onDoubleClick={() => { if (tab.kind === "request") { setEditingId(tab.id); setDraft(tab.title); } }}
            onDragStart={(e) => { setDragId(tab.id); e.dataTransfer.setData("application/x-requestsmin-tab", tab.id); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onDragOver={(e) => { if (dragId && dragId !== tab.id) { e.preventDefault(); setOverId(tab.id); } }}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("application/x-requestsmin-tab") || dragId; if (id && id !== tab.id) reorderTab(id, tab.id); setDragId(null); setOverId(null); }}
          >
            {dirty && <span className="tab-dirty-dot" title="Unsaved changes" />}
            {rt ? <span className={`tab-method method-tag ${method}`}>{method}</span> : <Icon name={tab.icon} className={dirty ? "soft-orange" : undefined} />}
            {editingId === tab.id ? <input ref={inputRef} className="tab-title-input" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") setEditingId(null); }} /> : <span className="tab-title">{tab.title}</span>}
            <span className="tab-close" title={`Close ${tab.title}`} aria-label={`Close ${tab.title}`} onClick={(e) => { e.stopPropagation(); void confirmCloseTab(tab.id); }}>
              <Icon name="x" size={13} />
            </span>
          </button>
        );
      })}
      <button type="button" className="tab-add" title="New request (⌘N)" onClick={() => newRequestTab()}><Icon name="plus" /><span>Request</span></button>
      {requestMenu && (() => {
        const request = requestTabs[requestMenu.tabId];
        if (!request?.collectionId || !request.relPath) return null;
        const { collectionId, relPath } = request;
        const name = request.request.name;
        const rename = async () => {
          const next = await openDialog({ title: "Rename request", defaultValue: name, confirmLabel: "Rename" });
          if (next == null || next.trim() === name) return;
          try { await renameRequest(collectionId, relPath, next.trim()); } catch (error) { showToast("Rename failed", String(error), "err"); }
        };
        const duplicate = async () => {
          try { await duplicateRequest(collectionId, relPath, `${name} copy`); showToast("Request duplicated", name); }
          catch (error) { showToast("Duplicate failed", String(error), "err"); }
        };
        const del = async () => {
          if (!await openConfirm({ title: "Delete request", message: `Delete "${name}"? This cannot be undone.`, danger: true, confirmLabel: "Delete" })) return;
          try { await deleteRequest(collectionId, relPath); showToast("Request deleted", name); }
          catch (error) { showToast("Delete failed", String(error), "err"); }
        };
        return <RequestContextMenu
          x={requestMenu.x}
          y={requestMenu.y}
          onOpen={() => activateTab(requestMenu.tabId)}
          onRename={() => void rename()}
          onDuplicate={() => void duplicate()}
          onDelete={() => void del()}
          onClose={() => setRequestMenu(null)}
        />;
      })()}
    </nav>
  );
}
