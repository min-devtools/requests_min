import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { useApp } from "../../store";
import { api, type DraftEntry, type ScanHit } from "../../lib/api";

export function AiImportView({ active, embedded = false }: { active: boolean; embedded?: boolean }) {
  const { collections, activeCollectionId, setActiveCollection, reloadCollections, showToast, openTab, openSelect, openDialog, aiEndpoint, aiModel, aiApiKey } = useApp(useShallow((s) => ({
    collections: s.collections, activeCollectionId: s.activeCollectionId, setActiveCollection: s.setActiveCollection,
    reloadCollections: s.reloadCollections, newRequestTab: s.newRequestTab, updateRequestTab: s.updateRequestTab, showToast: s.showToast,
    openTab: s.openTab, openSelect: s.openSelect, openDialog: s.openDialog, aiEndpoint: s.aiEndpoint, aiModel: s.aiModel, aiApiKey: s.aiApiKey,
  })));
  const [dir, setDir] = useState("");
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<ScanHit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<DraftEntry[]>([]);

  const scanPath = async (path: string) => {
    if (!path.trim()) return;
    setScanning(true);
    try {
      const res = await api.aiScan(path.trim());
      setFiles(res.files);
      setSelected(new Set(res.files.map((f) => f.path)));
      if (res.truncated) showToast("Scan truncated", "Only the first matches are shown — narrow the folder if needed.", "warn");
    } catch (err) {
      showToast("Scan failed", String(err), "err");
    } finally {
      setScanning(false);
    }
  };
  const scan = () => scanPath(dir);
  const chooseFolder = async () => {
    const selectedDir = await open({ directory: true, multiple: false, title: "Choose source folder" });
    if (typeof selectedDir !== "string") return;
    setDir(selectedDir);
    await scanPath(selectedDir);
  };

  const toggle = (path: string) => setSelected((s) => {
    const next = new Set(s);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const clickRow = (e: React.MouseEvent, index: number) => {
    const path = files[index].path;
    if (e.shiftKey && anchor !== null) {
      const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected((s) => {
        const next = new Set(s);
        for (let i = lo; i <= hi; i++) next.add(files[i].path);
        return next;
      });
    } else if (e.metaKey || e.ctrlKey) {
      toggle(path);
      setAnchor(index);
    } else {
      setSelected(new Set([path]));
      setAnchor(index);
    }
  };

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
    const NEW = "\0new";
    const ordered = activeCollectionId
      ? [...collections.filter((c) => c.id === activeCollectionId), ...collections.filter((c) => c.id !== activeCollectionId)]
      : collections;
    let choice: string | null = NEW;
    if (ordered.length) {
      choice = await openSelect({
        title: "Add to which collection?",
        options: [...ordered.map((c) => ({ label: c.name, value: c.id })), { label: "＋ New collection…", value: NEW }],
        confirmLabel: "Add",
      });
      if (choice === null) return;
    }
    let collectionId: string;
    if (choice === NEW) {
      const name = await openDialog({ title: "New collection", message: "Enter a name — it will be created.", defaultValue: dir.split("/").filter(Boolean).pop() || "AI import" });
      if (!name?.trim()) return;
      collectionId = (await api.colCreate(name.trim())).id;
      await reloadCollections();
    } else {
      collectionId = choice;
    }
    setActiveCollection(collectionId);
    for (const entry of draft) await api.reqWrite(collectionId, entry.relPath, entry.request);
    showToast("Added", `${draft.length} request(s) written to the collection.`);
    setDraft([]);
  };

  // Feature temporarily disabled -> Coming Soon
  const DISABLE_FEATURE = true;

  if (DISABLE_FEATURE) {
    return (
      <section className={`${embedded ? "" : "content "}ai-import-view ${active ? "active" : ""}`} style={{ overflow: "auto", padding: 14 }}>
        <div
          className="workspace-card"
          style={{
            padding: "24px 20px",
            textAlign: "center",
            display: "grid",
            placeItems: "center",
            gap: 12,
            borderStyle: "dashed",
            opacity: 0.85,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Icon name="sparkles" size={20} style={{ color: "var(--blue)" }} />
            <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text)" }}>Generate collection from local folder</h2>
            <span
              style={{
                fontSize: "0.72rem",
                padding: "3px 9px",
                borderRadius: 12,
                background: "color-mix(in oklab, var(--blue), transparent 80%)",
                color: "var(--blue)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Coming Soon
            </span>
          </div>
          <p style={{ margin: 0, maxWidth: 520, color: "var(--text-3)", fontSize: "0.85rem", lineHeight: 1.6 }}>
            Reads route declarations and protocol files, then drafts requests for review before writing to a collection.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={`${embedded ? "" : "content "}ai-import-view ${active ? "active" : ""}`} style={{ overflow: "auto", padding: 18 }}>
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
                <ToolButton onClick={chooseFolder} disabled={scanning}>Choose folder</ToolButton>
                <ToolButton variant="primary" onClick={scan} disabled={scanning}>{scanning ? "Scanning…" : "Scan folder"}</ToolButton>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            <section className="panel">
              <h3>Detected files <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· {selected.size}/{files.length} selected — shift-click for a range, ⌘/ctrl-click to toggle</span></h3>
              <div style={{ display: "grid", gap: 4, maxHeight: 220, overflow: "auto" }}>
                {files.map((f, i) => (
                  <div key={f.path} className="check-row" style={{ cursor: "pointer", userSelect: "none", background: selected.has(f.path) ? "var(--sel, rgba(120,140,255,0.12))" : undefined }} onClick={(e) => clickRow(e, i)}>
                    <input type="checkbox" className="row-check" checked={selected.has(f.path)} onClick={(e) => e.stopPropagation()} onChange={() => { toggle(f.path); setAnchor(i); }} />
                    <code style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.path}</code>
                    <span>{f.reason}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel ai-generate-panel">
            <div><h3>Generate draft</h3><p>Using <strong>{aiModel}</strong> via {aiEndpoint}.</p></div>
            <ToolButton variant="primary" onClick={generate} disabled={generating}><Icon name="wand" /> {generating ? "Generating…" : "Generate draft"}</ToolButton>
            {generating && (
              <ToolButton onClick={() => void api.aiGenerateCancel()} title="Stops after the in-flight batch finishes">
                <Icon name="x" /> Cancel
              </ToolButton>
            )}
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
                Add to collection…
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
