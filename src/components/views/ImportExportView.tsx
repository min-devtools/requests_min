import { useState } from "react";
import { api } from "../../lib/api";
import { parseGrpcurl } from "../../lib/grpcurl";
import { useApp } from "../../store";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { AiImportView } from "./AiImportView";

export function ImportExportView({ active }: { active: boolean }) {
  const { collections, activeCollectionId, setActiveCollection, reloadCollections, bumpReqList, showToast } = useApp();
  const [kind, setKind] = useState<"curl" | "grpcurl" | "postman" | "openapi">("curl");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [running, setRunning] = useState(false);
  const collection = collections.find((c) => c.id === activeCollectionId);

  const runImport = async () => {
    if (!text.trim()) return;
    setRunning(true);
    try {
      if (kind === "curl" || kind === "grpcurl") {
        if (!collection) throw new Error(`Select a collection before importing ${kind === "curl" ? "cURL" : "grpcurl"}`);
        const request = kind === "curl"
          ? await api.importCurl(text)
          : parseGrpcurl(text.replace(/\\(\s|$)/g, "$1"));
        if (!request) throw new Error("Not a valid grpcurl command");
        const relPath = `${request.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "request"}.json`;
        await api.reqWrite(collection.id, relPath, request);
        bumpReqList();
        showToast("Imported", `${request.name} added to ${collection.name}.`);
      } else {
        const draft = kind === "postman" ? await api.importPostman(text) : await api.importOpenapi(text);
        const meta = await api.colSaveDraft(draft);
        await reloadCollections();
        setActiveCollection(meta.id);
        showToast("Imported", `${draft.requests.length} requests added to ${draft.name}.`);
      }
      setText("");
      setFileName("");
    } catch (err) { showToast("Import failed", String(err), "err"); }
    finally { setRunning(false); }
  };

  const exportPostman = async () => {
    if (!collection) return;
    setRunning(true);
    try {
      await navigator.clipboard.writeText(await api.exportPostman(collection.id));
      showToast("Exported", "Postman v2.1 JSON copied to clipboard.");
    } catch (err) { showToast("Export failed", String(err), "err"); }
    finally { setRunning(false); }
  };

  return <section className={`content utility-view ${active ? "active" : ""}`} style={{ overflow: "auto" }}>
    <header className="page-head"><div><div className="eyebrow">Portability</div><h1>Import / Export</h1><p>Move API definitions without including local-only secrets.</p></div></header>
    <div className="utility-grid">
      <section className="workspace-card"><h3>Import</h3><div className="mini-tabs">{(["curl", "grpcurl", "postman", "openapi"] as const).map((x) => <button key={x} className={kind === x ? "active" : ""} onClick={() => { setKind(x); setText(""); setFileName(""); }}>{x}</button>)}</div>
        {kind === "curl" || kind === "grpcurl" ? <textarea className="import-editor" value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "curl" ? "curl 'https://api.example.com/users'" : "grpcurl -plaintext -d '{}' localhost:50051 pkg.Service/Method"} /> :
          <label className="import-file"><input type="file" accept={kind === "postman" ? ".json,application/json" : ".json,.yaml,.yml,application/json,application/yaml"} onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setText(await file.text());
          }} /><Icon name="folder" size={24} /><strong>{fileName || `Choose ${kind === "postman" ? "Postman JSON" : "OpenAPI JSON or YAML"}`}</strong><span>{fileName ? "Ready to import" : "Select a definition file from disk"}</span></label>}
        <div className="card-actions"><select className="method-select" value={activeCollectionId ?? ""} onChange={(e) => setActiveCollection(e.target.value || null)}><option value="">select collection…</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><ToolButton variant="primary" disabled={running || !text.trim()} onClick={runImport}><Icon name="copy" /> {running ? "Working…" : "Import"}</ToolButton></div>
      </section>
      <section className="workspace-card"><h3>Export collection</h3><div className="card-copy"><Icon name="database" size={22} /><strong>{collection?.name ?? "No collection selected"}</strong><span>Postman v2.1 JSON. Environment secrets stay outside collections and cannot be exported.</span></div><div className="card-actions"><ToolButton variant="primary" disabled={running || !collection} onClick={exportPostman}>Copy Postman JSON</ToolButton></div></section>
    </div>
    <AiImportView active={active} embedded />
  </section>;
}
