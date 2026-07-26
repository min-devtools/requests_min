import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { initVimMode } from "monaco-vim";
import { Icon } from "./Icon";
import { MONACO_THEME } from "../lib/monaco";
import { DYNAMIC_VARIABLES } from "../lib/dynamicVariables";
import { diagnoseJsonWithTemplates, formatJsonWithTemplates, minifyJsonWithTemplates, validateJsonWithTemplates } from "../lib/jsonTemplate";
import { runActiveRequest } from "../lib/runRequest";
import { useApp } from "../store";

type MonacoEditor = Parameters<OnMount>[0];

export function JsonEditor({ value, onChange, language = "json", variableNames = [], onFillSample }: { value: string; onChange: (value: string) => void; language?: "json" | "plaintext" | "javascript"; variableNames?: string[]; onFillSample?: () => void }) {
  const uiFontSize = useApp((state) => state.uiFontSize);
  const editorFont = useApp((state) => state.editorFont);
  const showToast = useApp((state) => state.showToast);
  const vimMode = useApp((state) => state.vimMode);
  const [wordWrap, setWordWrap] = useState(true);
  const [validation, setValidation] = useState<"valid" | "invalid" | null>(null);
  const variableNamesRef = useRef(variableNames);
  variableNamesRef.current = variableNames;
  const editorRef = useRef<MonacoEditor | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // Vim is opt-in and lives only while focused in the editor, so app shortcuts (Cmd+Enter to
  // send, etc.) are unaffected — monaco-vim never binds Cmd combos. Dispose on toggle/unmount.
  useEffect(() => {
    if (!mounted || !vimMode || !editorRef.current) return;
    const vim = initVimMode(editorRef.current, statusRef.current);
    return () => vim.dispose();
  }, [mounted, vimMode]);
  const format = () => {
    try {
      onChange(formatJsonWithTemplates(value));
      setValidation("valid");
    } catch (error) {
      setValidation("invalid");
      showToast("Invalid JSON", String(error), "err");
    }
  };
  const minify = () => {
    try {
      onChange(minifyJsonWithTemplates(value));
      setValidation("valid");
    } catch (error) {
      setValidation("invalid");
      showToast("Invalid JSON", String(error), "err");
    }
  };
  const validate = () => {
    const result = validateJsonWithTemplates(value);
    if (result.valid) {
      setValidation("valid");
      showToast("JSON valid", "Ready to send.");
    } else {
      setValidation("invalid");
      showToast("Invalid JSON", result.error ?? "Syntax error", "err");
    }
  };
  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    setMounted(true);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runActiveRequest());
    const decorations = editor.createDecorationsCollection();
    const markVariables = () => {
      const model = editor.getModel();
      if (!model) return;
      const next = [];
      for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
        const line = model.getLineContent(lineNumber);
        for (const match of line.matchAll(/\{\{[^}]*\}\}/g)) {
          next.push({ range: new monaco.Range(lineNumber, match.index! + 1, lineNumber, match.index! + match[0].length + 1), options: { inlineClassName: "env-variable-token" } });
        }
      }
      decorations.set(next);
    };
    const provider = monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ["{"],
      provideCompletionItems(model, position) {
        const line = model.getLineContent(position.lineNumber);
        const beforeCursor = line.slice(0, position.column - 1);
        const start = beforeCursor.lastIndexOf("{{");
        if (start === -1 || beforeCursor.slice(start).includes("}}")) return { suggestions: [] };
        const range = new monaco.Range(position.lineNumber, start + 1, position.lineNumber, position.column);
        // filterText mirrors the replaced range ("{{name}}"): monaco filters against the text
        // between range start and the cursor, so labels alone would die on the first "{"
        return { suggestions: [
          ...variableNamesRef.current.map((name) => ({ label: name, kind: monaco.languages.CompletionItemKind.Variable, insertText: `{{${name}}}`, filterText: `{{${name}}}`, range })),
          // dynamic built-ins sort below the environment's own variables ("~" prefix)
          ...DYNAMIC_VARIABLES.map((v) => ({ label: v.name, kind: monaco.languages.CompletionItemKind.Event, detail: `e.g. ${v.example}`, documentation: v.description, insertText: `{{${v.name}}}`, filterText: `{{${v.name}}}`, sortText: `~${v.name}`, range })),
        ] };
      },
    });
    markVariables();
    const changes = editor.onDidChangeModelContent(() => {
      markVariables();
      const position = editor.getPosition();
      const model = editor.getModel();
      if (position && model && model.getLineContent(position.lineNumber).slice(0, position.column - 1).endsWith("{{")) {
        editor.trigger("env-vars", "editor.action.triggerSuggest", {});
      }
    });
    // Template-aware diagnostics: the JSON worker can't cope with unquoted {{var}} (it reads
    // as nested objects and cascades false errors), so monaco validation is off and we paint
    // squiggles ourselves — only genuine syntax errors (missing ':'/',' unterminated nodes…)
    // get marked; {{...}} tokens never do.
    const updateJsonDiagnostics = () => {
      const model = editor.getModel();
      if (!model || language !== "json") return;
      monaco.editor.setModelMarkers(model, "json-template", diagnoseJsonWithTemplates(model.getValue()).map((d) => ({
        severity: monaco.MarkerSeverity.Error,
        message: d.message,
        startLineNumber: d.startLine,
        startColumn: d.startColumn,
        endLineNumber: d.endLine,
        endColumn: d.endColumn,
      })));
    };
    updateJsonDiagnostics();
    let diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;
    const diagnosticsListener = editor.onDidChangeModelContent(() => {
      clearTimeout(diagnosticsTimer);
      diagnosticsTimer = setTimeout(updateJsonDiagnostics, 300);
    });
    editor.onDidDispose(() => { changes.dispose(); provider.dispose(); diagnosticsListener.dispose(); clearTimeout(diagnosticsTimer); });
  };

  return (
    <div className={`json-editor-shell ${language === "json" ? "has-json-tools" : ""}`}>
      {language === "json" && (
        <div className="json-editor-tools">
          <span className={validation === "invalid" ? "invalid" : validation === "valid" ? "valid" : ""}>JSON {validation ?? ""}</span>
          <span />
          {onFillSample && <button type="button" onClick={onFillSample} title="Fill sample from method" aria-label="Fill sample"><Icon name="zap" size={14} /></button>}
          <button type="button" onClick={format} title="Format" aria-label="Format"><Icon name="wand" size={14} /></button>
          <button type="button" className={wordWrap ? "active" : ""} onClick={() => setWordWrap((v) => !v)} title={wordWrap ? "Disable Word Wrap" : "Enable Word Wrap"} aria-label="Toggle Word Wrap" aria-pressed={wordWrap}><Icon name="wrap" size={14} /></button>
          <button type="button" onClick={minify} title="Minify" aria-label="Minify"><Icon name="minify" size={14} /></button>
          <button type="button" onClick={validate} title="Validate" aria-label="Validate"><Icon name="check" size={14} /></button>
        </div>
      )}
      <Editor
        language={language}
        theme={MONACO_THEME}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        onMount={onMount}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: editorFont || '"Google Sans Code", "Berkeley Mono", ui-monospace, Menlo, Consolas, monospace',
          fontSize: uiFontSize,
          lineHeight: Math.round(uiFontSize * 1.65),
          tabSize: 2,
          scrollBeyondLastLine: false,
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          glyphMargin: false,
          folding: true,
          renderLineHighlight: "line",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          wordWrap: wordWrap ? "on" : "off",
          padding: { top: 10, bottom: 10 },
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
      {vimMode && <div className="vim-status" ref={statusRef} />}
    </div>
  );
}
