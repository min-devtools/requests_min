import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { loader } from "@monaco-editor/react";

export const MONACO_THEME = "requestsmin-live";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === "json" ? new jsonWorker() : new editorWorker();
  },
};

const value = (style: CSSStyleDeclaration, name: string, fallback: string) =>
  style.getPropertyValue(name).trim() || fallback;
const bare = (color: string) => color.startsWith("#") ? color.slice(1) : color;

export function retintMonaco(theme: "dark" | "light") {
  const style = getComputedStyle(document.body);
  const color = (name: string, fallback: string) => value(style, name, fallback);
  monaco.editor.defineTheme(MONACO_THEME, {
    base: theme === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "string.key.json", foreground: bare(color("--syntax-key", "#5aa7ff")) },
      { token: "string.value.json", foreground: bare(color("--syntax-string", "#58d68d")) },
      { token: "number", foreground: bare(color("--syntax-number", "#1f6feb")) },
      { token: "keyword.json", foreground: bare(color("--syntax-boolean", "#b794f4")) },
      { token: "delimiter", foreground: bare(color("--syntax-punctuation", "#717680")) },
    ],
    colors: {
      "editor.background": color("--editor-bg", theme === "dark" ? "#0d0f14" : "#fbfbfc"),
      "editor.foreground": color("--editor-fg", theme === "dark" ? "#d7dce5" : "#1c2430"),
      "editorLineNumber.foreground": color("--text-3", "#717680"),
      "editorCursor.foreground": color("--accent-focus", "#5aa7ff"),
      "editor.selectionBackground": color("--blue-2", "#1f6feb") + "55",
      "editor.inactiveSelectionBackground": color("--blue-2", "#1f6feb") + "2b",
      "editorError.foreground": color("--red", "#ff6b75"),
      "editorWarning.foreground": color("--orange", "#f7b267"),
      "editor.focusBorder": "#00000000",
    },
  });
  monaco.editor.setTheme(MONACO_THEME);
}

loader.config({ monaco });
