import { useEffect, useState } from "react";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { RequestContextMenu } from "../RequestContextMenu";
import { useApp } from "../../store";
import { api, type ReqEntry } from "../../lib/api";

export function CollectionsView({ active }: { active: boolean }) {
  const {
    collections, reloadCollections, activeCollectionId, setActiveCollection, newRequestTab,
    openRequestTab, openDialog, openConfirm, showToast, reqListVersion, renameRequest, duplicateRequest, deleteRequest,
  } = useApp();
  const [requests, setRequests] = useState<ReqEntry[]>([]);
  const [menu, setMenu] = useState<{ request: ReqEntry; x: number; y: number } | null>(null);
  const collection = collections.find((item) => item.id === activeCollectionId);

  useEffect(() => { void reloadCollections(); }, []);
  useEffect(() => {
    if (!activeCollectionId) { setRequests([]); return; }
    void api.reqList(activeCollectionId).then(setRequests).catch(() => setRequests([]));
  }, [activeCollectionId, reqListVersion]);

  const newCollection = async () => {
    const name = await openDialog({ title: "New collection", message: "Name your collection." });
    if (!name?.trim()) return;
    const meta = await api.colCreate(name.trim());
    await reloadCollections();
    setActiveCollection(meta.id);
  };
  const renameCollection = async () => {
    if (!collection) return;
    const name = await openDialog({ title: "Rename collection", defaultValue: collection.name });
    if (!name?.trim()) return;
    await api.colRename(collection.id, name.trim());
    await reloadCollections();
  };
  const deleteCollection = async () => {
    if (!collection || !await openConfirm({ title: "Delete collection", message: `Delete "${collection.name}" and all its requests? This cannot be undone.`, danger: true, confirmLabel: "Delete" })) return;
    await api.colDelete(collection.id);
    setActiveCollection(null);
    await reloadCollections();
  };
  const rename = async (request: ReqEntry) => {
    if (!collection) return;
    const name = await openDialog({ title: "Rename request", defaultValue: request.name });
    if (!name?.trim()) return;
    try { await renameRequest(collection.id, request.relPath, name.trim()); showToast("Request renamed", name.trim()); }
    catch (error) { showToast("Rename failed", String(error), "err"); }
  };
  const duplicate = async (request: ReqEntry) => {
    if (!collection) return;
    const name = await openDialog({ title: "Duplicate request", defaultValue: `${request.name} copy` });
    if (!name?.trim()) return;
    try { await duplicateRequest(collection.id, request.relPath, name.trim()); showToast("Request duplicated", name.trim()); }
    catch (error) { showToast("Duplicate failed", String(error), "err"); }
  };
  const deleteReq = async (request: ReqEntry) => {
    if (!collection || !await openConfirm({ title: "Delete request", message: `Delete "${request.name}"? This cannot be undone.`, danger: true, confirmLabel: "Delete" })) return;
    try { await deleteRequest(collection.id, request.relPath); showToast("Request deleted", request.name); }
    catch (error) { showToast("Delete failed", String(error), "err"); }
  };

  return <section className={`content collections-view ${active ? "active" : ""}`}>
    <header className="page-head">
      <div><div className="eyebrow">Collection workspace</div><h1>{collection?.name ?? "No collection selected"}</h1><p>{collection ? `${requests.length} request(s) stored in this collection.` : "Create a collection to start saving requests."}</p></div>
      <div className="toolbar">
        <ToolButton onClick={newCollection}><Icon name="plus" /> New collection</ToolButton>
        {collection && <ToolButton variant="primary" onClick={() => newRequestTab("http", collection.id)}><Icon name="plus" /> New request</ToolButton>}
        {collection && <ToolButton onClick={renameCollection}><Icon name="pencil" /> Rename</ToolButton>}
        {collection && <ToolButton variant="danger" onClick={deleteCollection}><Icon name="trash" /> Delete</ToolButton>}
      </div>
    </header>
    <div className="collections-body">
      {!collection ? <div className="empty-state"><Icon name="database" size={24} /><strong>No collection selected</strong><span>Create a collection or select one from the sidebar.</span></div> : <section className="table-panel collection-request-list">
        <div className="collection-request-head"><span>Method</span><span>Request</span><span>Path</span></div>
        {requests.length === 0 && <div className="empty-state"><Icon name="plus" size={22} /><strong>No requests yet</strong><span>Create a request or import a definition from Import / Export.</span><ToolButton variant="primary" onClick={() => newRequestTab("http", collection.id)}>New request</ToolButton></div>}
        {requests.map((request) => <button key={request.relPath} type="button" className="collection-request-row" onClick={() => void openRequestTab(collection.id, request.relPath)} onContextMenu={(event) => { event.preventDefault(); setMenu({ request, x: event.clientX, y: event.clientY }); }}>
          <span className={`method-tag ${request.method}`}>{request.method}</span><strong>{request.name}</strong><code>{request.relPath}</code>
        </button>)}
      </section>}
    </div>
    {collection && menu && <RequestContextMenu x={menu.x} y={menu.y} onOpen={() => void openRequestTab(collection.id, menu.request.relPath)} onRename={() => void rename(menu.request)} onDuplicate={() => void duplicate(menu.request)} onDelete={() => void deleteReq(menu.request)} onClose={() => setMenu(null)} />}
  </section>;
}
