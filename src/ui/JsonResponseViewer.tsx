import Editor, { type OnMount } from "@monaco-editor/react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MONACO_THEME } from "../lib/monaco";
import { collectPaths, normalizeJson, normalizeJsonMany, rankPaths } from "../lib/normalizeJson";
import { useApp } from "../store";
import { Icon } from "./Icon";

function project(value: string, paths: string[]): string {
  return JSON.stringify(normalizeJsonMany(JSON.parse(value), paths), null, 2);
}

export function JsonResponseViewer({ value }: { value: string }) {
  const uiFontSize = useApp((state) => state.uiFontSize);
  const editorFont = useApp((state) => state.editorFont);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [normalize, setNormalize] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);

  const known = useMemo(() => {
    try { return collectPaths(JSON.parse(value)); } catch { return []; }
  }, [value]);
  const matches = useMemo(() => rankPaths(known, draft), [known, draft]);
  const suggesting = open && matches.length > 0;

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
      setOpen(false);
      setSel(-1);
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

  const refillPath = (path: string) => {
    setDraft(path);
    requestAnimationFrame(() => { draftRef.current?.focus(); draftRef.current?.select(); });
  };

  const pickSuggestion = (path: string) => {
    setDraft(path);
    setSel(-1);
    draftRef.current?.focus();
  };

  // ↑↓ browse, Tab/click completes, Enter adds — Enter only completes after browsing
  const onDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (matches.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setOpen(true);
      setSel((i) => (i + (event.key === "ArrowDown" ? 1 : matches.length)) % matches.length);
      return;
    }
    if (event.key === "Escape" && suggesting) { event.preventDefault(); setOpen(false); return; }
    if (event.key === "Tab" && suggesting) { event.preventDefault(); pickSuggestion(matches[Math.max(sel, 0)]); return; }
    if (event.key === "Enter") {
      if (suggesting && sel >= 0) pickSuggestion(matches[sel]);
      else addPath();
    }
  };

  const openSearch = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    void editor.getAction("actions.find")?.run();
  };

  return <div className="json-response-viewer">
    <div className="json-response-tools">
      <button type="button" title="Search in response (⌘F)" aria-label="Search in response" onClick={openSearch}><Icon name="search" size={13} /></button>
      <div className="json-suggest-wrap">
        <input
          ref={draftRef}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setOpen(true); setSel(-1); }}
          onKeyDown={onDraftKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder="value.$.a or value[0].a"
        />
        {suggesting && <div className="json-suggest">
          {matches.map((path, i) => <button
            type="button"
            key={path}
            className={i === sel ? "sel" : ""}
            onMouseDown={(event) => { event.preventDefault(); pickSuggestion(path); }}
          >{path}</button>)}
        </div>}
      </div>
      <button type="button" onClick={addPath}>Add path</button>
      <button type="button" className={normalize && active.length > 0 ? "active" : ""} disabled={paths.length === 0} title="Show only the enabled paths, merged; earlier paths win conflicts" onClick={() => setNormalize((v) => !v)}>Normalize</button>
      {error && <span className="json-response-error">{error}</span>}
    </div>
    {paths.length > 0 && <div className="json-response-paths">
      {paths.map((path) => <div key={path} className={`json-response-path ${enabled.has(path) && normalize ? "active" : ""}`}>
        <button type="button" className="path-toggle" title="Toggle this path" onClick={() => togglePath(path)}>{path}</button>
        <button type="button" className="path-copy" title="Fill path input" aria-label={`Fill ${path} in path input`} onClick={() => refillPath(path)}><Icon name="copy" size={12} /></button>
        <button type="button" className="path-remove" title="Remove path" aria-label={`Remove ${path}`} onClick={() => removePath(path)}>×</button>
      </div>)}
    </div>}
    <div className="json-response-editor">
    <Editor language="json" theme={MONACO_THEME} value={display} onMount={(editor, monaco) => {
      editorRef.current = editor;
      editor.addCommand(monaco.KeyCode.Escape, () => {
        editor.getDomNode()?.blur();
      });
    }} options={{ 
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      fontFamily: editorFont || '"Google Sans Code", "Berkeley Mono", ui-monospace, Menlo, Consolas, monospace',
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
