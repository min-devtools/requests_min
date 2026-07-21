import { useId, useState, type KeyboardEvent } from "react";
import { fuzzyMatch } from "../lib/fuzzy";

type Props = {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function Combobox({ value, options, placeholder, onChange, disabled = false }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  // fuzzy (subsequence) match + rank; empty query scores 0 for all → original order kept
  const filtered = options
    .map((option) => ({ option, score: fuzzyMatch(query, option)?.score }))
    .filter((x): x is { option: string; score: number } => x.score !== undefined)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.option);

  const choose = (option: string) => {
    onChange(option);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && filtered[active]) {
      event.preventDefault();
      choose(filtered[active]);
    } else if (event.key === "Escape") {
      setQuery("");
      setOpen(false);
    }
  };

  return (
    <div className="combobox">
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        value={open ? query : value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => { setQuery(""); setActive(-1); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <div id={listId} className="combobox-list" role="listbox">
          {filtered.map((option, index) => (
            <div
              key={option}
              role="option"
              aria-selected={option === value}
              className={`combobox-item ${index === active ? "active" : ""} ${option === value ? "selected" : ""}`}
              onMouseDown={(event) => { event.preventDefault(); choose(option); }}
            >
              <span className="combobox-value">{option}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="combobox-empty">No matches</div>}
        </div>
      )}
    </div>
  );
}
