import Editor, { type OnMount } from "@monaco-editor/react";
import { useMemo, useRef, useState } from "react";
import { MONACO_THEME } from "../lib/monaco";
import { normalizeJson, normalizeJsonMany } from "../lib/normalizeJson";
import { useApp } from "../store";
import { Icon } from "./Icon";

function project(value: string, paths: string[]): string {
  return JSON.stringify(normalizeJsonMany(JSON.parse(value), paths), null, 2);
}

export function JsonResponseViewer({ value }: { value: string }) {
  const uiFontSize = useApp((state) => state.uiFontSize);
  const editorFont = useApp((state) => state.editorFont);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [draft, setDraft] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [normalize, setNormalize] = useState(false);
  const [error, setError] = useState("");

  const active = paths.filter((p) => enabled.has(p));
  const display = useMemo(() => {
    if (!normalize || active.length === 0) return value;
    try { return project(value, active); } catch { return value; }
  }, [value, normalize, active.join("\n")]);

  const addPath = () => {
    const path = draft.trim();
    if (!path) return;
    try {
      normalizeJson(JSON.parse(value), path);
      setPaths((current) => current.includes(path) ? current : [...current, path]);
      setEnabled((current) => new Set(current).add(path));
      setNormalize(true);
      setDraft("");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid JSON path.");
    }
  };

  const togglePath = (path: string) => {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const removePath = (path: string) => {
    setPaths((current) => current.filter((p) => p !== path));
    setEnabled((current) => { const next = new Set(current); next.delete(path); return next; });
  };

  const openSearch = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    void editor.getAction("actions.find")?.run();
  };

  return <div className="json-response-viewer">
    <div className="json-response-tools">
      <button type="button" title="Search in response (⌘F)" onClick={openSearch}><Icon name="search" size={13} /></button>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addPath()} placeholder="value.$.a or value[0].a" />
      <button type="button" onClick={addPath}>Add path</button>
      <button type="button" className={normalize && active.length > 0 ? "active" : ""} disabled={paths.length === 0} title="Show only the enabled paths, merged; earlier paths win conflicts" onClick={() => setNormalize((v) => !v)}>Normalize</button>
      {error && <span className="json-response-error">{error}</span>}
    </div>
    {paths.length > 0 && <div className="json-response-paths">
      {paths.map((path) => <button key={path} type="button" className={enabled.has(path) && normalize ? "active" : ""} title="Toggle this path" onClick={() => togglePath(path)}>
        {path}<span className="path-remove" title="Remove path" onClick={(event) => { event.stopPropagation(); removePath(path); }}>×</span>
      </button>)}
    </div>}
    <div className="json-response-editor">
    <Editor language="json" theme={MONACO_THEME} value={display} onMount={(editor) => { editorRef.current = editor; }} options={{
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: editorFont || '"Berkeley Mono", ui-monospace, Menlo, Consolas, monospace',
      fontSize: uiFontSize,
      lineHeight: Math.round(uiFontSize * 1.65),
      tabSize: 2,
      scrollBeyondLastLine: false,
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: true,
      showFoldingControls: "always",
      foldingHighlight: true,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      wordWrap: "on",
      padding: { top: 10, bottom: 10 },
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    }} />
    </div>
  </div>;
}
