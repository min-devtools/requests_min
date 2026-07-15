import { useRef, useState, type ChangeEvent } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  variableNames: string[];
  className?: string;
  placeholder?: string;
  onBlur?: () => void;
};

const parts = (value: string) => value.split(/(\{\{[^{}]*\}\})/g).filter(Boolean);

export const replaceEnvSuggestion = (value: string, start: number, caret: number, name: string) => {
  const closingBraces = value.slice(caret).match(/^\}+/)?.[0].length ?? 0;
  return value.slice(0, start) + `{{${name}}}` + value.slice(caret + closingBraces);
};

export function EnvInput({ value, onChange, variableNames, className = "", placeholder, onBlur }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [focused, setFocused] = useState(false);

  const updateSuggestions = (element: HTMLInputElement) => {
    const caret = element.selectionStart ?? element.value.length;
    const before = element.value.slice(0, caret);
    const match = before.match(/\{\{([^{}]*)$/);
    setQuery(match?.[1] ?? null);
    setStart(match ? caret - match[0].length : caret);
  };

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
    updateSuggestions(event.target);
  };

  const choose = (name: string) => {
    const element = input.current;
    if (!element) return;
    const caret = element.selectionStart ?? value.length;
    const token = `{{${name}}}`;
    onChange(replaceEnvSuggestion(value, start, caret, name));
    setQuery(null);
    requestAnimationFrame(() => {
      const next = start + token.length;
      element.focus();
      element.setSelectionRange(next, next);
    });
  };

  const suggestions = query === null ? [] : variableNames.filter((name) => name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className={`env-input ${focused ? "editing" : ""} ${className}`}>
      <div className="env-input-overlay" aria-hidden>
        {parts(value).map((part, index) => /^\{\{[^{}]*\}\}$/.test(part)
          ? <span key={index} className="env-input-token">{part}</span>
          : <span key={index}>{part}</span>)}
      </div>
      <input
        ref={input}
        value={value}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={change}
        onClick={(event) => updateSuggestions(event.currentTarget)}
        onKeyUp={(event) => updateSuggestions(event.currentTarget)}
        onBlur={() => { setFocused(false); setQuery(null); onBlur?.(); }}
      />
      {suggestions.length > 0 && (
        <div className="env-input-suggestions">
          {suggestions.map((name) => <button key={name} type="button" onMouseDown={(event) => { event.preventDefault(); choose(name); }}>{`{{${name}}}`}</button>)}
        </div>
      )}
    </div>
  );
}
