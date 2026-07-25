import { useEffect, useState } from "react";
import type { FlowNode, StepStatus } from "../../lib/flow/types";
import { useApp } from "../../store";
import { Icon, type IconName } from "../../ui/Icon";

export interface NodeActionItem {
  icon: IconName;
  title: string;
  ariaLabel: string;
  danger?: boolean;
  onClick: () => void;
}

/** Action cluster on every block face — identical layout across types so muscle memory transfers. */
export function NodeActions({ items }: { items: NodeActionItem[] }) {
  return (
    <span className="flow-node-actions">
      {items.map((item) => (
        <button
          key={item.title}
          type="button"
          className={`tool-btn flow-node-btn${item.danger ? " danger" : ""} nodrag nopan`}
          title={item.title}
          aria-label={item.ariaLabel}
          onClick={(event) => {
            event.stopPropagation();
            item.onClick();
          }}
        >
          <Icon name={item.icon} size={11} />
        </button>
      ))}
    </span>
  );
}

/** Top-right switch on a block face: turns the step on/off without deleting it. Off steps are
    pass-throughs — the run skips them and carries on to whatever they feed. */
export function NodeToggle({ enabled, stepKey, onChange }: {
  enabled: boolean;
  stepKey: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className="flow-node-toggle nodrag nopan"
      title={enabled ? "Step is on — click to skip it" : "Step is off — click to run it"}
      aria-label={`${enabled ? "Disable" : "Enable"} step ${stepKey}`}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!enabled);
      }}
    />
  );
}

/** Bottom status readout: a state-colored dot next to the status word; hues come from the status-* classes. */
export function StatusLine({ status, stale }: { status: StepStatus; stale: boolean }) {
  return (
    <span className="flow-node-status">
      <i className="flow-status-dot" aria-hidden />
      {status}{stale ? " · stale" : ""}
    </span>
  );
}

/** The block-face glyph per step type — shared by canvas blocks and the run report so the two never drift. */
export const stepIcon = (node: FlowNode): IconName => {
  if (node.type === "delay") return "hourglass";
  if (node.type === "loop") return "repeat";
  if (node.type === "transform") return "braces";
  return node.config.request.protocol === "grpc" ? "cable" : "globe";
};

/** Identity key ("http" | "grpc" | "loop" | "delay" | "transform") for tinting step glyphs off-canvas. */
export const stepTypeClass = (node: FlowNode): string =>
  node.type === "request" ? (node.config.request.protocol === "grpc" ? "grpc" : "http") : node.type;

/** Numeric field that commits a validated value on Enter/blur; invalid input toasts and snaps
    back to the last good value. Used by the step detail panels for loop/delay values. */
export function CommitNumberInput({ value, min, max, disabled, ariaLabel, invalidTitle, invalidMessage, onCommit }: {
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  ariaLabel: string;
  invalidTitle: string;
  invalidMessage: string;
  onCommit: (next: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const parsed = Math.floor(Number(text.trim()));
    if (!Number.isFinite(parsed) || parsed < min || (max != null && parsed > max)) {
      useApp.getState().showToast(invalidTitle, invalidMessage, "warn");
      setText(String(value));
      return;
    }
    if (parsed !== value) onCommit(parsed);
    else setText(String(value));
  };
  return (
    <input
      className="flow-step-number"
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      inputMode="numeric"
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "Escape") setText(String(value));
      }}
      onBlur={commit}
    />
  );
}
