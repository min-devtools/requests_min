import { useEffect, useRef, useState } from "react";
import { ToolButton } from "../ui/ToolButton";
import { useApp } from "../store";

/** In-app replacement for window.prompt/confirm — those don't render in the Tauri webview. */
export function Dialog() {
  const dialog = useApp((s) => s.dialog);
  const closeDialog = useApp((s) => s.closeDialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog?.kind === "prompt") {
      setValue(dialog.defaultValue ?? "");
      requestAnimationFrame(() => inputRef.current?.select());
    } else if (dialog?.kind === "select") {
      setValue(dialog.options[0]?.value ?? "");
    }
  }, [dialog]);

  // Confirm dialogs have no input to catch keys, so bind Enter/Escape globally.
  useEffect(() => {
    if (dialog?.kind !== "confirm") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); closeDialog("1"); }
      if (e.key === "Escape") { e.preventDefault(); closeDialog(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, closeDialog]);

  if (!dialog) return null;

  const cancel = () => closeDialog(null);
  const submit = () => {
    if (dialog.kind === "prompt" && !value.trim()) return;
    if (dialog.kind === "select") return closeDialog(value);
    closeDialog(dialog.kind === "prompt" ? value : "1");
  };

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="prompt-dialog">
        <strong>{dialog.title}</strong>
        {dialog.message && <p className="prompt-dialog-msg">{dialog.message}</p>}
        {dialog.kind === "prompt" && (
          <input
            ref={inputRef}
            className="side-search"
            style={{ width: "100%" }}
            value={value}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") cancel();
            }}
          />
        )}
        {dialog.kind === "select" && (
          <select
            className="side-search"
            style={{ width: "100%" }}
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") cancel();
            }}
          >
            {dialog.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <div className="prompt-dialog-foot">
          <ToolButton onClick={cancel}>Cancel</ToolButton>
          <ToolButton
            variant={dialog.kind === "confirm" && dialog.danger ? "danger" : "primary"}
            disabled={dialog.kind === "prompt" && !value.trim()}
            onClick={submit}
          >
            {dialog.confirmLabel ?? (dialog.kind === "prompt" ? "Save" : "Confirm")}
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
