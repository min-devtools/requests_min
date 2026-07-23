// Ported from redis_min PayloadPanel: collapsible JSON tree with search highlight.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { findMarks, filterJsonFields, jsonChildPath, jsonContainerPaths, jsonFields } from "../lib/jsonTree";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { ToolButton } from "./ToolButton";

interface JsonNodeProps {
  value: unknown;
  path: string;
  name: string | null;
  depth: number;
  trailing: boolean;
  collapsed: ReadonlySet<string>;
  query: string;
  caseSensitive: boolean;
  onToggle: (path: string) => void;
}

function primitiveClass(value: unknown): string {
  if (value === null || typeof value === "boolean") return "tok-bool";
  if (typeof value === "number") return "tok-num";
  return "tok-str";
}

function highlightText(text: string, q: string, caseSensitive: boolean): ReactNode {
  const marks = findMarks(text, q, caseSensitive);
  if (!marks.length) return text;
  const nodes: ReactNode[] = [];
  let key = 0;
  let cur = 0;
  for (const [ms, me] of marks) {
    if (ms > cur) nodes.push(<span key={key++}>{text.slice(cur, ms)}</span>);
    nodes.push(<mark key={key++}>{text.slice(ms, me)}</mark>);
    cur = me;
  }
  if (cur < text.length) nodes.push(<span key={key++}>{text.slice(cur)}</span>);
  return nodes;
}

function JsonNode({ value, path, name, depth, trailing, collapsed, query, caseSensitive, onToggle }: JsonNodeProps) {
  const prefix = name === null ? null : (
    <>
      <span className="tok-key">{highlightText(JSON.stringify(name), query, caseSensitive)}</span>
      <span className="json-tree-colon">: </span>
    </>
  );
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isArray;

  if (!isArray && !isObject) {
    return (
      <div className="json-tree-line" style={{ paddingLeft: depth * 16 }}>
        <span className="json-tree-toggle-spacer" />
        {prefix}
        <span className={primitiveClass(value)}>{highlightText(JSON.stringify(value) ?? "null", query, caseSensitive)}</span>
        {trailing && <span className="json-tree-punc">,</span>}
      </div>
    );
  }

  const entries = isArray
    ? value.map((child, index) => ({ id: String(index), name: null, value: child, path: jsonChildPath(path, index) }))
    : Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => ({ id: key, name: key, value: child, path: jsonChildPath(path, key) }));
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  const count = entries.length;
  const canCollapse = count > 0;
  const isCollapsed = canCollapse && collapsed.has(path);
  const summary = `${count} ${isArray ? (count === 1 ? "item" : "items") : (count === 1 ? "field" : "fields")}`;

  return (
    <>
      <div className="json-tree-line" style={{ paddingLeft: depth * 16 }}>
        {canCollapse ? (
          <button
            type="button"
            className="json-tree-toggle"
            title={`${isCollapsed ? "Expand" : "Collapse"} ${path}`}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${path}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(path)}
          >
            <Icon name="chevron-right" size={12} />
          </button>
        ) : <span className="json-tree-toggle-spacer" />}
        {prefix}
        <span className={`json-tree-bracket tok-br-${depth % 3}`}>{open}</span>
        {isCollapsed && (
          <>
            <span className="json-tree-ellipsis">…</span>
            <span className={`json-tree-bracket tok-br-${depth % 3}`}>{close}</span>
            <span className="json-tree-summary">{highlightText(summary, query, caseSensitive)}</span>
            {trailing && <span className="json-tree-punc">,</span>}
          </>
        )}
        {!isCollapsed && !canCollapse && (
          <>
            <span className={`json-tree-bracket tok-br-${depth % 3}`}>{close}</span>
            {trailing && <span className="json-tree-punc">,</span>}
          </>
        )}
      </div>
      {!isCollapsed && canCollapse && (
        <>
          {entries.map((entry, index) => (
            <JsonNode
              key={`${path}:${entry.id}`}
              value={entry.value}
              path={entry.path}
              name={entry.name}
              depth={depth + 1}
              trailing={index < entries.length - 1}
              collapsed={collapsed}
              query={query}
              caseSensitive={caseSensitive}
              onToggle={onToggle}
            />
          ))}
          <div className="json-tree-line" style={{ paddingLeft: depth * 16 }}>
            <span className="json-tree-toggle-spacer" />
            <span className={`json-tree-bracket tok-br-${depth % 3}`}>{close}</span>
            {trailing && <span className="json-tree-punc">,</span>}
          </div>
        </>
      )}
    </>
  );
}

function ancestorPaths(path: string): string[] {
  const out: string[] = [];
  let i = path.length;
  while (true) {
    const dot = path.lastIndexOf(".", i - 1);
    const bracket = path.lastIndexOf("[", i - 1);
    i = Math.max(dot, bracket);
    if (i <= 0) break;
    out.push(path.slice(0, i));
  }
  return out;
}

export function JsonTreePanel({ value }: { value: unknown }) {
  const showToast = useApp((state) => state.showToast);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userCollapsed, setUserCollapsed] = useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isString = typeof value === "string";
  const containers = useMemo(() => (value !== null && value !== undefined && !isString ? jsonContainerPaths(value) : []), [value, isString]);
  const allFields = useMemo(() => (value !== null && value !== undefined && !isString ? jsonFields(value) : []), [value, isString]);
  const q = query.trim();
  const filtered = useMemo(() => (q ? filterJsonFields(allFields, q, caseSensitive) : allFields), [allFields, q, caseSensitive]);

  const bigPayload = !isString && containers.length > 0 && JSON.stringify(value ?? null).length > 50_000;
  useLayoutEffect(
    () => setUserCollapsed(new Set(bigPayload ? containers : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value],
  );

  // auto-expand ancestors of search matches so highlights are visible; never hide nodes
  const collapsed = useMemo(() => {
    if (!q) return userCollapsed;
    const forceExpand = new Set<string>();
    for (const field of filtered) {
      for (const ancestor of ancestorPaths(field.path)) forceExpand.add(ancestor);
    }
    const next = new Set(userCollapsed);
    for (const path of forceExpand) next.delete(path);
    return next;
  }, [q, filtered, userCollapsed]);

  const toggle = (path: string) => {
    setUserCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  // ⌘F only when focus/selection sits inside this panel — Monaco and other views own it elsewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const el = containerRef.current;
      const inside = el && (el.contains(document.activeElement) || el.contains(window.getSelection()?.anchorNode ?? null));
      if (mod && e.key.toLowerCase() === "f" && inside) {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
      } else if (e.key === "Escape" && searchOpen && inside) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const copy = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text).then(() => showToast("Copied", label));
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const searchBar = searchOpen && (
    <div className="json-tree-search">
      <Icon name="search" size={13} />
      <input
        ref={searchInputRef}
        value={query}
        placeholder="Find in value…"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
      />
      <button
        type="button"
        className={`case-toggle ${caseSensitive ? "active" : ""}`}
        title={`Case ${caseSensitive ? "sensitive" : "insensitive"}`}
        onClick={() => setCaseSensitive(!caseSensitive)}
      >
        Aa
      </button>
      <span className="match-count">{q ? `${filtered.length}/${allFields.length}` : ""}</span>
    </div>
  );

  if (isString || value === null || value === undefined) {
    const text = isString ? (value as string) : "null";
    return (
      <div className="json-dock" ref={containerRef} tabIndex={-1}>
        {searchBar}
        <div className="json-dock-head">
          <span>{isString ? `Raw value · ${text.length.toLocaleString()} bytes` : "null"}</span>
          {isString && (
            <div className="dock-actions">
              <ToolButton iconOnly title="Copy raw value" onClick={() => copy(text, "Raw value copied.")}>
                <Icon name="copy" size={13} />
              </ToolButton>
            </div>
          )}
        </div>
        <div className="json-tree-view json-tree-raw">
          <div className="json-tree-content">
            <div className="json-tree-line">
              <span className="json-tree-raw-text">{highlightText(text, q, caseSensitive)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const collapsedCount = containers.reduce((count, path) => count + Number(collapsed.has(path)), 0);

  return (
    <div className="json-dock" ref={containerRef} tabIndex={-1}>
      {searchBar}
      <div className="json-dock-head">
        <span>
          {q ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}` : `${allFields.length} field${allFields.length === 1 ? "" : "s"}`}
        </span>
        <div className="dock-actions">
          <ToolButton
            iconOnly
            title="Find in value (⌘F)"
            aria-label="Find in value"
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.select());
            }}
          >
            <Icon name="search" size={13} />
          </ToolButton>
          <ToolButton iconOnly title="Copy formatted JSON" aria-label="Copy formatted JSON" onClick={() => copy(JSON.stringify(value, null, 2), "Formatted JSON copied.")}>
            <Icon name="copy" size={13} />
          </ToolButton>
          <ToolButton
            iconOnly
            title="Expand all"
            aria-label="Expand all JSON nodes"
            disabled={collapsedCount === 0}
            onClick={() => setUserCollapsed(new Set())}
          >
            <Icon name="chevrons-down" size={13} />
          </ToolButton>
          <ToolButton
            iconOnly
            title="Collapse all"
            aria-label="Collapse all JSON nodes"
            disabled={containers.length === 0 || collapsedCount === containers.length}
            onClick={() => setUserCollapsed(new Set(containers))}
          >
            <Icon name="chevrons-up" size={13} />
          </ToolButton>
        </div>
      </div>
      <div className="json-tree-view" role="tree" aria-label="JSON tree">
        <div className="json-tree-content">
          <JsonNode
            value={value}
            path="$"
            name={null}
            depth={0}
            trailing={false}
            collapsed={collapsed}
            query={q}
            caseSensitive={caseSensitive}
            onToggle={toggle}
          />
        </div>
      </div>
    </div>
  );
}
