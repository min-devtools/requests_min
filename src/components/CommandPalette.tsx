import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { api, type FlowMeta } from "../lib/api";
import { Icon, type IconName } from "../ui/Icon";
import { fuzzyMatch, highlight } from "../lib/fuzzy";

interface Command { icon: IconName; label: string; kbd?: string; action: () => void }

function renderHL(text: string, indices: number[]): ReactNode {
  if (!indices.length) return text;
  return highlight(text, indices).map((p, i) =>
    p.mark ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>,
  );
}

// ponytail: recents persisted in localStorage, max 3 shown.
const REC_KEY = "requestsmin:cmd-recents";
const REC_SHOW = 3;
const REC_KEEP = 8;
function readRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(REC_KEY) ?? "[]") as string[]; } catch { return []; }
}
function pushRecent(label: string): void {
  const cur = readRecents().filter((l) => l !== label);
  cur.unshift(label);
  try { localStorage.setItem(REC_KEY, JSON.stringify(cur.slice(0, REC_KEEP))); } catch { /* ignore */ }
}

export function CommandPalette() {
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const [flows, setFlows] = useState<FlowMeta[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { commandOpen, setCommandOpen, collections, newRequestTab, openTab, openFlowTab, toggleLeft, toggleRight, setActiveCollection, showToast, vimMode } = useApp(useShallow((s) => ({
    commandOpen: s.commandOpen, setCommandOpen: s.setCommandOpen, collections: s.collections,
    newRequestTab: s.newRequestTab, openTab: s.openTab, openFlowTab: s.openFlowTab, toggleLeft: s.toggleLeft, toggleRight: s.toggleRight,
    setActiveCollection: s.setActiveCollection, showToast: s.showToast, vimMode: s.vimMode,
  })));

  useEffect(() => {
    if (commandOpen) {
      setInput("");
      setCursor(0);
      setRecents(readRecents());
      api.flowList().then(setFlows).catch(() => setFlows([]));
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [commandOpen]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { icon: "plus", label: "New request", kbd: "⌘N", action: () => newRequestTab() },
      { icon: "database", label: "Open Collections", action: () => openTab("collections") },
      { icon: "key", label: "Open Environments", action: () => openTab("environments") },
      { icon: "flow", label: "Open Flows", action: () => openTab("flows") },
      { icon: "history", label: "Open Request History", action: () => openTab("history") },
      { icon: "copy", label: "Open Import / Export", action: () => openTab("import-export") },
      { icon: "github", label: "Open GitHub Sync", action: () => openTab("github-sync") },
      { icon: "wand", label: "Generate from folder", kbd: "⌘I", action: () => openTab("import-export") },
      { icon: "settings", label: "Open Settings", kbd: "⌘,", action: () => openTab("settings") },
      { icon: "panel-left", label: "Toggle sidebar", kbd: "⌘B", action: () => toggleLeft() },
      { icon: "panel-right", label: "Toggle inspector", kbd: "⌘R", action: () => toggleRight() },
    ];
    for (const c of collections) {
      base.push({ icon: "database", label: `Switch collection: ${c.name}`, action: () => setActiveCollection(c.id) });
    }
    for (const f of flows) {
      base.push({ icon: "flow", label: `Open flow: ${f.name}`, action: () => void openFlowTab(f.id).catch((error) => showToast("Open failed", String(error), "err")) });
    }
    return base;
  }, [collections, flows, newRequestTab, openTab, openFlowTab, toggleLeft, toggleRight, setActiveCollection, showToast]);

const filtered = useMemo<Array<Command & { labelIdx: number[]; recent: boolean }>>(() => {
    const q = input.trim();
    const mFor = (c: Command) => (q ? fuzzyMatch(q, c.label) : { indices: [] as number[], score: 0 } as const);

    const recentResolved = recents
      .map((l) => commands.find((c) => c.label === l))
      .filter((c): c is Command => !!c)
      .slice(0, REC_SHOW);
    const recentMatches = recentResolved
      .map((c) => ({ cmd: c, m: mFor(c) }))
      .filter((x) => !!x.m)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0));
    const recentLabels = new Set(recentMatches.map((x) => x.cmd.label));

    const restMatches = commands
      .filter((c) => !recentLabels.has(c.label))
      .map((c) => ({ cmd: c, m: mFor(c) }))
      .filter((x) => !!x.m)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0));

    const out: Array<Command & { labelIdx: number[]; recent: boolean }> = [];
    for (const x of recentMatches) out.push({ ...x.cmd, labelIdx: x.m!.indices, recent: true });
    for (const x of restMatches) out.push({ ...x.cmd, labelIdx: x.m!.indices, recent: false });
    return out.slice(0, 12);
  }, [commands, input, recents]);

  if (!commandOpen) return null;

  const runCommand = (cmd: Command) => {
    setCommandOpen(false);
    pushRecent(cmd.label);
    cmd.action();
  };

  return (
    <div className="command" onMouseDown={(e) => { if (e.target === e.currentTarget) setCommandOpen(false); }}>
      <div className="palette">
        <input
          ref={inputRef}
          value={input}
          placeholder="Run command, open collection, switch environment..."
          onChange={(e) => { setInput(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            const next = e.key === "Tab" || (vimMode && e.ctrlKey && e.key.toLowerCase() === "n");
            const previous = vimMode && e.ctrlKey && e.key.toLowerCase() === "p";
            if (e.key === "ArrowDown" || next) { e.preventDefault(); setCursor((c) => Math.min(Math.max(0, filtered.length - 1), c + 1)); }
            if (e.key === "ArrowUp" || previous) { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            if (e.key === "Enter" && filtered[cursor]) runCommand(filtered[cursor]);
            if (e.key === "Escape") setCommandOpen(false);
          }}
        />
        <div className="cmd-list">
          {filtered.map((cmd, i) => (
            <Fragment key={cmd.label}>
              {(i === 0 || filtered[i - 1].recent !== cmd.recent) && <div className="cmd-group">{cmd.recent ? "Recents" : "Commands"}</div>}
              <div className={`cmd ${i === cursor ? "active" : ""}`} onMouseEnter={() => setCursor(i)} onClick={() => runCommand(cmd)}>
                <Icon name={cmd.icon} size={15} />
                <span>{renderHL(cmd.label, cmd.labelIdx)}</span>
                {cmd.kbd ? <span className="kbd">{cmd.kbd}</span> : <span />}
              </div>
            </Fragment>
          ))}
          {filtered.length === 0 && <div className="empty-note">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
}
