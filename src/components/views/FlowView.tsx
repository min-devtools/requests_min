import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createDelayFlowNode, createLoopFlowNode, createTransformFlowNode, type LayoutDirection } from "../../lib/flow/canvas";
import { runFlow } from "../../lib/flow/engine";
import { fuzzyMatch, highlight } from "../../lib/fuzzy";
import { useApp } from "../../store";
import { Icon, type IconName } from "../../ui/Icon";
import { FlowCanvas } from "../flow/FlowCanvas";
import { promptDelayMs, promptLoopCount } from "../flow/nodeActions";
import { RunReport } from "../flow/RunReport";

const nextNodeId = () =>
  `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface ActionItem { key: "delay" | "transform" | "loop"; label: string; icon: IconName }

function renderHL(text: string, indices: number[]): ReactNode {
  if (!indices.length) return text;
  return highlight(text, indices).map((p, i) =>
    p.mark ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>,
  );
}

function ActionsMenu({ disabled, onPick }: { disabled: boolean; onPick: (key: ActionItem["key"]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: ActionItem[] = [
    { key: "delay", label: "Add delay", icon: "timer" },
    { key: "transform", label: "Add transform", icon: "braces" },
    { key: "loop", label: "Add loop", icon: "repeat" },
  ];
  const filtered = items
    .map((item) => ({ item, match: fuzzyMatch(query, item.label) }))
    .filter((x) => x.match !== null)
    .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
    .map((x) => x.item);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onBlur = () => setOpen(false);

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  const choose = (item: ActionItem) => {
    setOpen(false);
    onPick(item.key);
  };

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && filtered[active]) {
      event.preventDefault();
      choose(filtered[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="actions-menu" ref={wrapRef}>
      <button
        type="button"
        className="tool-btn"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="plus" />
        Actions
        <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <div className="actions-menu-pop" role="menu">
          <div className="actions-menu-search">
            <Icon name="search" size={13} />
            <input
              ref={inputRef}
              value={query}
              placeholder="Search actions…"
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKey}
            />
          </div>
          <div className="actions-menu-list">
            {filtered.map((item, i) => {
              const m = fuzzyMatch(query, item.label);
              return (
                <div
                  key={item.key}
                  role="menuitem"
                  className={`actions-menu-item ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                >
                  <Icon name={item.icon} size={14} />
                  <span>{renderHL(item.label, m?.indices ?? [])}</span>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="actions-menu-empty">No actions</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function FlowView({ tabId, active }: { tabId: string; active: boolean }) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);
  const leftCollapsed = useApp((state) => state.leftCollapsed);
  const rightCollapsed = useApp((state) => state.rightCollapsed);
  const toggleLeft = useApp((state) => state.toggleLeft);
  const toggleRight = useApp((state) => state.toggleRight);
  const isCanvasFullscreen = leftCollapsed && rightCollapsed;

  const arrangeApi = useRef<((direction: LayoutDirection) => void) | null>(null);
  const arrangeDir = useApp((state) => state.flowArrangeDir);
  const setFlowArrangeDir = useApp((state) => state.setFlowArrangeDir);
  const [arrangeMenu, setArrangeMenu] = useState(false);
  const arrangeWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!arrangeMenu) return;
    const onDown = (event: PointerEvent) => {
      if (arrangeWrapRef.current && !arrangeWrapRef.current.contains(event.target as Node)) setArrangeMenu(false);
    };
    const onBlur = () => setArrangeMenu(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [arrangeMenu]);

  if (!ft) return null;

  const runArrange = (direction: LayoutDirection) => {
    setArrangeMenu(false);
    if (direction !== arrangeDir) setFlowArrangeDir(direction);
    arrangeApi.current?.(direction);
  };

  const addDelay = async () => {
    const ms = await promptDelayMs("Add delay", 1000);
    if (ms === null) return;
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    const delayCount = current.flow.nodes.filter((node) => node.type === "delay").length;
    const node = createDelayFlowNode(
      nextNodeId(),
      new Set(current.flow.nodes.map((item) => item.key)),
      { x: 80 + (delayCount % 4) * 28, y: 80 + (delayCount % 6) * 28 },
    );
    node.config.ms = ms;
    updateFlowTab(tabId, {
      flow: { ...current.flow, nodes: [...current.flow.nodes, node] },
      selectedNodeIds: [node.id],
    });
  };

  const addLoop = async () => {
    const count = await promptLoopCount("Add loop", 3);
    if (count === null) return;
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    const loopCount = current.flow.nodes.filter((node) => node.type === "loop").length;
    const node = createLoopFlowNode(
      nextNodeId(),
      new Set(current.flow.nodes.map((item) => item.key)),
      { x: 80 + (loopCount % 4) * 28, y: 200 + (loopCount % 6) * 28 },
    );
    node.config.count = count;
    updateFlowTab(tabId, {
      flow: { ...current.flow, nodes: [...current.flow.nodes, node] },
      selectedNodeIds: [node.id],
    });
  };

  const addTransform = () => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    const count = current.flow.nodes.filter((node) => node.type === "transform").length;
    const node = createTransformFlowNode(
      nextNodeId(),
      new Set(current.flow.nodes.map((item) => item.key)),
      { x: 80 + (count % 4) * 28, y: 140 + (count % 6) * 28 },
    );
    updateFlowTab(tabId, {
      flow: { ...current.flow, nodes: [...current.flow.nodes, node] },
      selectedNodeIds: [node.id],
      // open its editor in the dock right away
      panelNodeId: node.id,
      dockTab: "step",
    });
  };

  return (
    <section className={`content flow-view ${active ? "active" : ""}`}>
      <div className="flow-toolbar">
        <strong>{ft.flow.name}</strong>
        <span className={ft.dirty ? "flow-dirty" : "flow-saved"}>
          {ft.dirty ? "Unsaved" : "Saved"}
        </span>
        {ft.running && <span className="flow-running-badge">Running…</span>}
        <span className="spacer" />
        <ActionsMenu
          disabled={ft.running}
          onPick={(key) => {
            if (key === "delay") void addDelay();
            else if (key === "loop") void addLoop();
            else addTransform();
          }}
        />
        <div className="split-btn" ref={arrangeWrapRef}>
          <button
            type="button"
            className="tool-btn icon-only"
            onClick={() => runArrange(arrangeDir)}
            disabled={ft.running || ft.flow.nodes.length === 0}
            title={`Arrange (${arrangeDir === "LR" ? "left → right" : "top → bottom"})`}
          >
            <Icon name="wand" />
          </button>
          <button
            type="button"
            className="tool-btn icon-only split-btn-caret"
            onClick={() => setArrangeMenu((open) => !open)}
            disabled={ft.running || ft.flow.nodes.length === 0}
            aria-haspopup="menu"
            aria-expanded={arrangeMenu}
            title="Arrange direction"
          >
            <Icon name="chevron-down" size={12} />
          </button>
          {arrangeMenu && (
            <div className="actions-menu-pop split-btn-menu" role="menu">
              <div role="menuitem" className={`actions-menu-item ${arrangeDir === "LR" ? "active" : ""}`} onMouseDown={(e) => { e.preventDefault(); runArrange("LR"); }}>
                <Icon name="chevron-right" size={14} />
                <span>Left → right</span>
              </div>
              <div role="menuitem" className={`actions-menu-item ${arrangeDir === "TB" ? "active" : ""}`} onMouseDown={(e) => { e.preventDefault(); runArrange("TB"); }}>
                <Icon name="chevron-down" size={14} />
                <span>Top → bottom</span>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="tool-btn icon-only"
          onClick={() => {
            if (isCanvasFullscreen) {
              if (leftCollapsed) toggleLeft();
              if (rightCollapsed) toggleRight();
            } else {
              if (!leftCollapsed) toggleLeft();
              if (!rightCollapsed) toggleRight();
            }
          }}
          title={isCanvasFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-pressed={isCanvasFullscreen}
        >
          <Icon name="fullscreen" />
        </button>
      </div>
      <div className="flow-body">
        <div className="flow-canvas-wrap">
          <FlowCanvas tabId={tabId} active={active} arrangeApi={arrangeApi}
            onRunNode={(nodeId) => void runFlow(tabId, nodeId)}
          />
          {ft.flow.nodes.length === 0 && (
            <div className="flow-empty-hint" aria-hidden="true">
              <Icon name="flow" size={20} />
              <strong>Empty flow</strong>
              <span>Drag saved requests from the sidebar onto this canvas, then connect them left to right.</span>
            </div>
          )}
        </div>
      </div>
      <RunReport tabId={tabId} />
    </section>
  );
}
