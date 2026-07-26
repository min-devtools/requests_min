import { Icon } from "./Icon";
import { EnvInput } from "./EnvInput";
import type { KV } from "../lib/api";

type KvChange =
  | { type: "set"; index: number; previous: KV; next: KV }
  | { type: "remove"; index: number; previous: KV }
  | { type: "add"; index: number };

export function KvEditor({ items, onChange, keyPlaceholder = "key", valuePlaceholder = "value", lockedCount = 0, variableNames }: {
  items: KV[];
  onChange: (items: KV[], change?: KvChange) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** leading rows whose key is derived from the URL (Postman-style path variables) — key
   *  is read-only and there's no remove button; add/remove that param by editing the URL. */
  lockedCount?: number;
  /** when set, key/value cells become EnvInputs: {{var}} suggestions + token highlight
   *  (dynamic {{$...}} built-ins included). Omit where {{var}} is not resolved at send. */
  variableNames?: string[];
}) {
  const set = (i: number, patch: Partial<KV>) => {
    const previous = items[i];
    const next = { ...previous, ...patch };
    onChange(items.map((it, idx) => (idx === i ? next : it)), { type: "set", index: i, previous, next });
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i), { type: "remove", index: i, previous: items[i] });
  const add = () => onChange([...items, { key: "", value: "", enabled: true }], { type: "add", index: items.length });

  const cell = (value: string, placeholder: string, apply: (value: string) => void) =>
    variableNames
      ? <EnvInput className="path-input" value={value} placeholder={placeholder} variableNames={variableNames} onChange={apply} />
      : <input className="path-input" placeholder={placeholder} value={value} onChange={(e) => apply(e.target.value)} />;

  return (
    <div className="kv-editor">
      <div className="kv-editor-head"><span>On</span><span>Key</span><span>Value</span><span /></div>
      {items.map((it, i) => {
        const locked = i < lockedCount;
        return (
          <div
            key={i}
            className="kv-editor-row"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("input, button")) return;
              set(i, { enabled: it.enabled === false });
            }}
          >
            <input type="checkbox" className="row-check" checked={it.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked })} />
            {locked
              ? <input className="path-input" placeholder={keyPlaceholder} value={it.key} readOnly={locked} style={{ opacity: .65 }} title="Path variable — edit the URL to rename or remove" onChange={(e) => set(i, { key: e.target.value })} />
              : cell(it.key, keyPlaceholder, (key) => set(i, { key }))}
            {cell(it.value, valuePlaceholder, (value) => set(i, { value }))}
            {locked ? <span /> : <button type="button" className="tool-btn icon-only" onClick={() => remove(i)} title="Remove" aria-label="Remove"><Icon name="x" size={13} /></button>}
          </div>
        );
      })}
      <button type="button" className="kv-add" onClick={add}><Icon name="plus" /> Add {keyPlaceholder}</button>
    </div>
  );
}
