import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { Icon, type IconName } from "../ui/Icon";

interface Command { icon: IconName; label: string; kbd?: string; action: () => void }

export function CommandPalette() {
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { commandOpen, setCommandOpen, collections, newRequestTab, openTab, toggleLeft, toggleRight, setActiveCollection } = useApp(useShallow((s) => ({
    commandOpen: s.commandOpen, setCommandOpen: s.setCommandOpen, collections: s.collections,
    newRequestTab: s.newRequestTab, openTab: s.openTab, toggleLeft: s.toggleLeft, toggleRight: s.toggleRight,
    setActiveCollection: s.setActiveCollection,
  })));

  useEffect(() => {
    if (commandOpen) {
      setInput("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [commandOpen]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { icon: "plus", label: "New request", kbd: "⌘N", action: () => newRequestTab() },
      { icon: "database", label: "Open Collections", action: () => openTab("collections") },
      { icon: "key", label: "Open Environments", action: () => openTab("environments") },
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
    return base;
  }, [collections, newRequestTab, openTab, toggleLeft, toggleRight, setActiveCollection]);

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    return (q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands).slice(0, 12);
  }, [commands, input]);

  if (!commandOpen) return null;

  const runCommand = (cmd: Command) => {
    setCommandOpen(false);
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
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(filtered.length - 1, c + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            if (e.key === "Enter" && filtered[cursor]) runCommand(filtered[cursor]);
            if (e.key === "Escape") setCommandOpen(false);
          }}
        />
        <div className="cmd-list">
          {filtered.map((cmd, i) => (
            <div key={cmd.label} className={`cmd ${i === cursor ? "active" : ""}`} onMouseEnter={() => setCursor(i)} onClick={() => runCommand(cmd)}>
              <Icon name={cmd.icon} size={15} />
              <span>{cmd.label}</span>
              {cmd.kbd ? <span className="kbd">{cmd.kbd}</span> : <span />}
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-note">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
}
