import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../lib/api";
import { isGrpcurl, parseGrpcurl } from "../../lib/grpcurl";
import { useApp } from "../../store";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { AiImportView } from "./AiImportView";

export function ImportExportView({ active }: { active: boolean }) {
  const { collections, activeCollectionId, setActiveCollection, reloadCollections, newRequestTab, updateRequestTab, showToast } = useApp(useShallow((s) => ({
    collections: s.collections, activeCollectionId: s.activeCollectionId, setActiveCollection: s.setActiveCollection,
    reloadCollections: s.reloadCollections, newRequestTab: s.newRequestTab, updateRequestTab: s.updateRequestTab, showToast: s.showToast,
  })));
  const [kind, setKind] = useState<"command" | "postman" | "openapi">("command");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [running, setRunning] = useState(false);
  const [importCollectionId, setImportCollectionId] = useState("");
  const [exportCollectionId, setExportCollectionId] = useState(activeCollectionId ?? "");
  const exportCollection = collections.find((c) => c.id === exportCollectionId);
  const commandImport = kind === "command";

  const runImport = async () => {
    if (!text.trim()) return;
    setRunning(true);
    try {
      if (commandImport) {
        const request = isGrpcurl(text)
          ? parseGrpcurl(text.replace(/\\(\s|$)/g, "$1"))
          : await api.importCurl(text);
        if (!request) throw new Error("Not a valid grpcurl command");
        if (importCollectionId) {
          const existing = new Set((await api.reqList(importCollectionId)).map((entry) => entry.relPath));
          const base = request.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "request";
          let relPath = `${base}.json`;
          for (let n = 2; existing.has(relPath); n++) relPath = `${base}-${n}.json`;
          await api.reqWrite(importCollectionId, relPath, request);
          useApp.getState().bumpReqList(importCollectionId);
          showToast("Imported", `${request.name} added to the selected collection.`);
        } else {
          newRequestTab(request.protocol);
          const tabId = useApp.getState().activeTabId;
          updateRequestTab(tabId, { request });
          showToast("Imported", `${request.name} opened as an unsaved request.`);
        }
      } else {
        const draft = kind === "postman" ? await api.importPostman(text) : await api.importOpenapi(text);
        const collectionId = importCollectionId || (await api.colSaveDraft(draft)).id;
        if (importCollectionId) await api.colMergeDraft(importCollectionId, draft);
        await reloadCollections();
        setActiveCollection(collectionId);
        setExportCollectionId(collectionId);
        showToast("Imported", `${draft.requests.length} requests ${importCollectionId ? "added to the selected collection" : `added to ${draft.name}`}.`);
      }
      setText("");
      setFileName("");
    } catch (err) { showToast("Import failed", String(err), "err"); }
    finally { setRunning(false); }
  };

  const exportPostman = async () => {
    if (!exportCollection) return;
    setRunning(true);
    try {
      await navigator.clipboard.writeText(await api.exportPostman(exportCollection.id));
      showToast("Exported", "Postman v2.1 JSON copied to clipboard.");
    } catch (err) { showToast("Export failed", String(err), "err"); }
    finally { setRunning(false); }
  };

  return <section className={`content utility-view ${active ? "active" : ""}`} style={{ overflow: "auto" }}>
    <header className="page-head"><div><div className="eyebrow">Portability</div><h1>Import / Export</h1><p>Move API definitions without including local-only secrets.</p></div></header>
    <div className="utility-grid">
      <section className="workspace-card import-card"><h3>Import</h3><div className="mini-tabs">{(["command", "postman", "openapi"] as const).map((x) => <button key={x} className={kind === x ? "active" : ""} onClick={() => { setKind(x); setText(""); setFileName(""); }}>{x === "command" ? "cURL / gRPCURL" : x}</button>)}</div>
        {commandImport ? <textarea className="import-editor" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a curl or grpcurl command" /> :
          <label className={`import-file ${fileName ? "selected" : ""}`}><input type="file" accept={kind === "postman" ? ".json,application/json" : ".json,.yaml,.yml,application/json,application/yaml"} onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setText(await file.text());
          }} /><Icon name={fileName ? "check" : "folder"} size={24} /><strong>{fileName || `Choose ${kind === "postman" ? "Postman JSON" : "OpenAPI JSON or YAML"}`}</strong><span>{fileName ? "Collection file ready" : "Select a definition file from disk"}</span></label>}
        <div className="card-actions"><select className="method-select" value={importCollectionId} onChange={(e) => setImportCollectionId(e.target.value)}><option value="">{commandImport ? "Open as new request" : "Create new collection"}</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><ToolButton variant="primary" disabled={running || !text.trim()} onClick={runImport}><Icon name={commandImport ? "request" : "database"} /> {running ? "Working…" : commandImport ? importCollectionId ? "Import request" : "Open request" : "Import collection"}</ToolButton></div>
      </section>
      <section className="workspace-card export-card"><h3>Export collection</h3><div className="card-copy"><Icon name="database" size={22} /><strong>{exportCollection?.name ?? "Choose a collection"}</strong><span>Copy a portable Postman v2.1 collection. Environment secrets never leave this app.</span></div><div className="card-actions"><select className="method-select" value={exportCollectionId} onChange={(e) => setExportCollectionId(e.target.value)}><option value="">Choose collection…</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><ToolButton variant="primary" disabled={running || !exportCollection} onClick={exportPostman}><Icon name="copy" /> Copy collection JSON</ToolButton></div></section>
    </div>
    <AiImportView active={active} embedded />
  </section>;
}
