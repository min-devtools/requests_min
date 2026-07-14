import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { RequestContextMenu } from "./RequestContextMenu";
import { useApp } from "../store";

export function TabsBar() {
  const { tabs, activeTabId, activateTab, closeTab, requestTabs, newRequestTab, renameTab, reorderTab } = useApp();
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
        const dirty = rt ? JSON.stringify(rt.request) !== rt.original : false;
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
            onAuxClick={(e) => { if (e.button === 1) closeTab(tab.id); }}
            onDoubleClick={() => { if (tab.kind === "request") { setEditingId(tab.id); setDraft(tab.title); } }}
            onDragStart={(e) => { setDragId(tab.id); e.dataTransfer.setData("application/x-requestsmin-tab", tab.id); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onDragOver={(e) => { if (dragId && dragId !== tab.id) { e.preventDefault(); setOverId(tab.id); } }}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("application/x-requestsmin-tab") || dragId; if (id && id !== tab.id) reorderTab(id, tab.id); setDragId(null); setOverId(null); }}
          >
            {rt ? <span className={`tab-method method-tag ${method}`}>{method}</span> : <Icon name={tab.icon} className={dirty ? "soft-orange" : undefined} />}
            {editingId === tab.id ? <input ref={inputRef} className="tab-title-input" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") setEditingId(null); }} /> : <span className="tab-title">{tab.title}{dirty ? " •" : ""}</span>}
            <span className="tab-close" title={`Close ${tab.title}`} onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>
              <Icon name="x" size={13} />
            </span>
          </button>
        );
      })}
      <button type="button" className="tab-add" title="New request (⌘N)" onClick={() => newRequestTab()}><Icon name="plus" /><span>Request</span></button>
      {requestMenu && (() => {
        const request = requestTabs[requestMenu.tabId];
        return request?.collectionId && request.relPath ? <RequestContextMenu
          collectionId={request.collectionId}
          relPath={request.relPath}
          title={request.request.name}
          x={requestMenu.x}
          y={requestMenu.y}
          onOpen={() => activateTab(requestMenu.tabId)}
          onClose={() => setRequestMenu(null)}
        /> : null;
      })()}
    </nav>
  );
}
