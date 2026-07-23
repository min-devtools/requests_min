import { Icon } from "./Icon";
import type { KV } from "../lib/api";

export function KvEditor({ items, onChange, keyPlaceholder = "key", valuePlaceholder = "value" }: {
  items: KV[];
  onChange: (items: KV[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const set = (i: number, patch: Partial<KV>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { key: "", value: "", enabled: true }]);

  return (
    <div className="kv-editor">
      <div className="kv-editor-head"><span>On</span><span>Key</span><span>Value</span><span /></div>
      {items.map((it, i) => (
        <div
          key={i}
          className="kv-editor-row"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("input, button")) return;
            set(i, { enabled: it.enabled === false });
          }}
        >
          <input type="checkbox" className="row-check" checked={it.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked })} />
          <input className="path-input" placeholder={keyPlaceholder} value={it.key} onChange={(e) => set(i, { key: e.target.value })} />
          <input className="path-input" placeholder={valuePlaceholder} value={it.value} onChange={(e) => set(i, { value: e.target.value })} />
          <button type="button" className="tool-btn icon-only" onClick={() => remove(i)} title="Remove" aria-label="Remove"><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button type="button" className="kv-add" onClick={add}><Icon name="plus" /> Add {keyPlaceholder}</button>
    </div>
  );
}
