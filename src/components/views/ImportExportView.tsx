import { useState, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../lib/api";
import { isGrpcurl, parseGrpcurl } from "../../lib/grpcurl";
import { useApp } from "../../store";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { JsonTreePanel } from "../../ui/JsonTreePanel";
import { AiImportView } from "./AiImportView";

const safeCopyText = async (content: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = content;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(ta);
      return successful;
    } catch {
      return false;
    }
  }
};

const downloadJsonFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

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
  const [exportJson, setExportJson] = useState("");
  const [exporting, setExporting] = useState(false);

  const exportCollection = collections.find((c) => c.id === exportCollectionId);
  const commandImport = kind === "command";
  const [isWindowDragActive, setIsWindowDragActive] = useState(false);
  const [isTargetDragOver, setIsTargetDragOver] = useState(false);

  const parsedExportJson = useMemo(() => {
    if (!exportJson) return null;
    try {
      return JSON.parse(exportJson);
    } catch {
      return exportJson;
    }
  }, [exportJson]);

  useEffect(() => {
    if (!active) return;
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        dragCounter++;
        if (dragCounter === 1) setIsWindowDragActive(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          setIsWindowDragActive(false);
          setIsTargetDragOver(false);
        }
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        dragCounter = 0;
        setIsWindowDragActive(false);
        setIsTargetDragOver(false);
      }
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [active]);

  useEffect(() => {
    if (!exportCollectionId) {
      setExportJson("");
      return;
    }
    let cancelled = false;
    setExporting(true);
    api.exportPostman(exportCollectionId)
      .then((json) => {
        if (!cancelled) setExportJson(json);
      })
      .catch((err) => {
        if (!cancelled) {
          setExportJson("");
          showToast("Export failed", String(err), "err");
        }
      })
      .finally(() => {
        if (!cancelled) setExporting(false);
      });
    return () => { cancelled = true; };
  }, [exportCollectionId, showToast]);

  const handleDropFile = async (file: File) => {
    setFileName(file.name);
    const content = await file.text();
    setText(content);
    const isYaml = file.name.endsWith(".yaml") || file.name.endsWith(".yml") || content.includes("openapi:") || content.includes("swagger:");
    if (kind === "command" || (kind === "postman" && isYaml)) {
      setKind(isYaml ? "openapi" : "postman");
    }
  };

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

  const handleCopyJson = async () => {
    if (!exportJson) return;
    const ok = await safeCopyText(exportJson);
    if (ok) {
      showToast("Exported", "Postman v2.1 JSON copied to clipboard.");
    } else {
      showToast("Copy failed", "Could not copy JSON to clipboard.", "err");
    }
  };

  const handleDownloadJson = () => {
    if (!exportJson || !exportCollection) return;
    const safeName = exportCollection.name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "collection";
    const filename = `${safeName}_request_min.json`;
    downloadJsonFile(filename, exportJson);
    showToast("Exported", `Downloaded ${filename}.`);
  };

  const dropZoneProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setIsTargetDragOver(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsTargetDragOver(false); },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      setIsTargetDragOver(false);
      setIsWindowDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) await handleDropFile(file);
    },
  };

  return <section className={`content utility-view ${active ? "active" : ""}`} style={{ overflow: "auto" }}>
    <header className="page-head"><div><div className="eyebrow">Portability</div><h1>Import / Export</h1><p>Move API definitions without including local-only secrets.</p></div></header>
    <div className="utility-stack">
      {/* SECTION 1: IMPORT (Full Width) */}
      <section className="workspace-card import-card">
        <h3>Import</h3>
        <div className="mini-tabs">{(["command", "postman", "openapi"] as const).map((x) => <button key={x} className={kind === x ? "active" : ""} onClick={() => { setKind(x); setText(""); setFileName(""); }}>{x === "command" ? "cURL / gRPCURL" : x}</button>)}</div>
        {commandImport ? (
          <textarea
            {...dropZoneProps}
            className={`import-editor ${isWindowDragActive ? "drag-active" : ""} ${isTargetDragOver ? "target-over" : ""}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a curl or grpcurl command"
          />
        ) : (
          <label
            {...dropZoneProps}
            className={`import-file ${fileName ? "selected" : ""} ${isWindowDragActive ? "drag-active" : ""} ${isTargetDragOver ? "target-over" : ""}`}
          >
            <input type="file" accept={kind === "postman" ? ".json,application/json" : ".json,.yaml,.yml,application/json,application/yaml"} onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              await handleDropFile(file);
            }} />
            <Icon name={fileName ? "check" : "folder"} size={24} />
            <strong>{fileName || `Choose ${kind === "postman" ? "Postman JSON" : "OpenAPI JSON or YAML"}`}</strong>
            <span>{fileName ? "Collection file ready" : "Select or drag & drop a definition file from disk"}</span>
          </label>
        )}
        <div className="card-actions">
          <select className="method-select" value={importCollectionId} onChange={(e) => setImportCollectionId(e.target.value)}>
            <option value="">{commandImport ? "Open as new request" : "Create new collection"}</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <ToolButton variant="primary" disabled={running || !text.trim()} onClick={runImport}>
            <Icon name={commandImport ? "request" : "database"} /> {running ? "Working…" : commandImport ? importCollectionId ? "Import request" : "Open request" : "Import collection"}
          </ToolButton>
        </div>
      </section>

      {/* SECTION 2: EXPORT (Full Width) */}
      <section className="workspace-card export-card">
        <div className="card-head">
          <div className="card-head-title">
            <h3>Export collection</h3>
            <select className="method-select" value={exportCollectionId} onChange={(e) => setExportCollectionId(e.target.value)}>
              <option value="">Choose collection to export…</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="card-head-actions">
            <ToolButton disabled={!exportJson || exporting} onClick={handleCopyJson}>
              <Icon name="copy" /> Copy JSON
            </ToolButton>
            <ToolButton variant="primary" disabled={!exportJson || exporting} onClick={handleDownloadJson}>
              <Icon name="download" /> Download file (.json)
            </ToolButton>
          </div>
        </div>
        {exportCollectionId ? (
          <div className="export-preview-container">
            {exporting ? (
              <div className="import-editor export-preview-loading">Generating Postman v2.1 JSON...</div>
            ) : (
              <JsonTreePanel value={parsedExportJson} />
            )}
          </div>
        ) : (
          <div className="card-copy">
            <Icon name="database" size={24} />
            <strong>Choose a collection to export</strong>
            <span>Select a collection from the dropdown above to preview its Postman v2.1 JSON and download or copy it.</span>
          </div>
        )}
        <div className="card-actions">
          <ToolButton disabled={!exportJson || exporting} onClick={handleCopyJson}>
            <Icon name="copy" /> Copy JSON
          </ToolButton>
          <ToolButton variant="primary" disabled={!exportJson || exporting} onClick={handleDownloadJson}>
            <Icon name="download" /> Download file (.json)
          </ToolButton>
        </div>
      </section>
    </div>
    <AiImportView active={active} embedded />
  </section>;
}
