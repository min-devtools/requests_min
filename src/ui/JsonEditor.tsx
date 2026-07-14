import Editor, { type OnMount } from "@monaco-editor/react";
import { useState } from "react";
import { MONACO_THEME } from "../lib/monaco";
import { runActiveRequest } from "../lib/runRequest";
import { useApp } from "../store";

export function JsonEditor({ value, onChange, language = "json" }: { value: string; onChange: (value: string) => void; language?: "json" | "plaintext" }) {
  const uiFontSize = useApp((state) => state.uiFontSize);
  const editorFont = useApp((state) => state.editorFont);
  const showToast = useApp((state) => state.showToast);
  const [validation, setValidation] = useState<"valid" | "invalid" | null>(null);
  const transform = (pretty: boolean) => {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, pretty ? 2 : undefined));
      setValidation("valid");
    } catch (error) {
      setValidation("invalid");
      showToast("Invalid JSON", String(error), "err");
    }
  };
  const format = () => transform(true);
  const minify = () => transform(false);
  const validate = () => {
    try {
      JSON.parse(value);
      setValidation("valid");
      showToast("JSON valid", "Ready to send.");
    } catch (error) {
      setValidation("invalid");
      showToast("Invalid JSON", String(error), "err");
    }
  };
  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runActiveRequest());
  };

  return (
    <div className={`json-editor-shell ${language === "json" ? "has-json-tools" : ""}`}>
      {language === "json" && (
        <div className="json-editor-tools">
          <span className={validation === "invalid" ? "invalid" : validation === "valid" ? "valid" : ""}>JSON {validation ?? ""}</span>
          <span />
          <button type="button" onClick={format}>Format</button>
          <button type="button" onClick={minify}>Minify</button>
          <button type="button" onClick={validate}>Validate</button>
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
          fontFamily: editorFont || '"Berkeley Mono", ui-monospace, Menlo, Consolas, monospace',
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
          wordWrap: "on",
          padding: { top: 10, bottom: 10 },
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
    </div>
  );
}
