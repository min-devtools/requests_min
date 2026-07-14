import { useState } from "react";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { useApp } from "../../store";
import { api, type DraftEntry, type ScanHit } from "../../lib/api";

export function AiImportView({ active }: { active: boolean }) {
  const { collections, activeCollectionId, setActiveCollection, reloadCollections, showToast, openTab, aiEndpoint, aiModel, aiApiKey } = useApp();
  const [dir, setDir] = useState("");
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<ScanHit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<DraftEntry[]>([]);

  const scan = async () => {
    if (!dir.trim()) return;
    setScanning(true);
    try {
      const res = await api.aiScan(dir.trim());
      setFiles(res.files);
      setSelected(new Set(res.files.map((f) => f.path)));
      if (res.truncated) showToast("Scan truncated", "Only the first matches are shown — narrow the folder if needed.", "warn");
    } catch (err) {
      showToast("Scan failed", String(err), "err");
    } finally {
      setScanning(false);
    }
  };

  const toggle = (path: string) => setSelected((s) => {
    const next = new Set(s);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const generate = async () => {
    if (selected.size === 0) { showToast("Select at least one file", undefined, "warn"); return; }
    if (!aiApiKey.trim()) { showToast("AI provider key required", "Configure it in Settings before generating.", "warn"); openTab("settings"); return; }
    setGenerating(true);
    try {
      const entries = await api.aiGenerate(Array.from(selected), aiEndpoint, aiApiKey, aiModel);
      setDraft(entries);
      showToast("Draft ready", `${entries.length} request(s) generated — review before adding.`);
    } catch (err) {
      showToast("Generate failed", String(err), "err");
    } finally {
      setGenerating(false);
    }
  };

  const addToCollection = async () => {
    if (draft.length === 0) return;
    let collectionId = activeCollectionId;
    if (!collectionId) {
      const meta = await api.colCreate(dir.split("/").filter(Boolean).pop() || "AI import");
      collectionId = meta.id;
      await reloadCollections();
      setActiveCollection(collectionId);
    }
    for (const entry of draft) await api.reqWrite(collectionId, entry.relPath, entry.request);
    showToast("Added", `${draft.length} request(s) written to the collection.`);
    setDraft([]);
  };

  return (
    <section className={`content ai-import-view ${active ? "active" : ""}`} style={{ overflow: "auto", padding: 18 }}>
      <div className="page-head" style={{ padding: 0, border: 0, marginBottom: 16 }}>
        <div>
          <h1>Generate collection from local folder</h1>
          <p>Reads route declarations and protocol files, then drafts requests for review before writing to a collection.</p>
        </div>
      </div>

      <div className="create-layout">
        <div className="stack">
          <div className="drop-zone">
            <div style={{ width: "100%" }}>
              <strong>{dir || "Choose a source folder"}</strong>
              <span>{files.length ? `${files.length} candidate file(s) found` : "Enter an absolute path to scan"}</span>
              <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center" }}>
                <input className="path-input" style={{ maxWidth: 320 }} placeholder="/abs/path/to/project" value={dir} onChange={(e) => setDir(e.target.value)} />
                <ToolButton variant="primary" onClick={scan} disabled={scanning}>{scanning ? "Scanning…" : "Scan folder"}</ToolButton>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            <section className="panel">
              <h3>Detected files</h3>
              <div style={{ display: "grid", gap: 4, maxHeight: 220, overflow: "auto" }}>
                {files.map((f) => (
                  <label key={f.path} className="check-row" style={{ cursor: "pointer" }}>
                    <input type="checkbox" className="row-check" checked={selected.has(f.path)} onChange={() => toggle(f.path)} />
                    <code style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.path}</code>
                    <span>{f.reason}</span>
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="panel ai-generate-panel">
            <div><h3>Generate draft</h3><p>Using <strong>{aiModel}</strong> via {aiEndpoint}.</p></div>
            <ToolButton variant="primary" onClick={generate} disabled={generating}><Icon name="wand" /> {generating ? "Generating…" : "Generate draft"}</ToolButton>
          </section>
        </div>

        <aside className="stack">
          <section className="panel">
            <h3>Draft plan</h3>
            {draft.length === 0 && <div className="empty-note">No draft yet — scan a folder and generate.</div>}
            {draft.map((entry) => (
              <div key={entry.relPath} className="plan-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <b>{entry.request.protocol.toUpperCase()}</b>{" "}
                <code style={{ color: "var(--blue)", font: "11px var(--font-mono)" }}>
                  {entry.request.http?.url ?? entry.request.grpc?.endpoint ?? entry.request.ws?.url}
                </code>
                <div style={{ color: "var(--text-3)", fontSize: "0.8462rem" }}>{entry.request.name} · {entry.relPath}</div>
              </div>
            ))}
            {draft.length > 0 && (
              <ToolButton variant="primary" style={{ marginTop: 10, width: "100%" }} onClick={addToCollection}>
                Add to {collections.find((c) => c.id === activeCollectionId)?.name ?? "new collection"}
              </ToolButton>
            )}
          </section>
          <section className="panel">
            <h3>Safety boundary</h3>
            <p style={{ margin: 0, color: "var(--text-2)", fontSize: "0.9231rem" }}>
              The source folder is only used to infer this draft. Nothing is written to disk or pushed to GitHub until you choose Add to collection and Push.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
