import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, type FlowMeta } from "../../lib/api";
import { fuzzyMatch } from "../../lib/fuzzy";
import { createFlow, createLatestFlowListReload, deleteFlow, duplicateFlow, exportFlow, renameFlow } from "../../lib/flow/flowActions";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

export function FlowsView({ active }: { active: boolean }) {
  const [flows, setFlows] = useState<FlowMeta[]>([]);
  const [query, setQuery] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const { openFlowTab, openDialog, openConfirm, showToast } = useApp(useShallow((state) => ({
    openFlowTab: state.openFlowTab,
    openDialog: state.openDialog,
    openConfirm: state.openConfirm,
    showToast: state.showToast,
  })));

  const reload = useMemo(() => createLatestFlowListReload({
    load: api.flowList,
    apply: setFlows,
    fail: (error) => {
      setFlows([]);
      showToast("Load failed", String(error), "err");
    },
  }), [showToast]);
  useEffect(() => { if (active) void reload(); }, [active]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      filterRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const visibleFlows = useMemo(() => {
    const matches = flows.filter((flow) => fuzzyMatch(query, flow.name));
    if (!sortDirection) return matches;
    return [...matches].sort((a, b) => sortDirection === "asc"
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name));
  }, [flows, query, sortDirection]);

  const mutate = async (action: () => Promise<void>, failure: string) => {
    try {
      await action();
      await reload();
    } catch (error) {
      showToast(failure, String(error), "err");
    }
  };

  const open = async (flow: FlowMeta) => {
    try {
      await openFlowTab(flow.id);
    } catch (error) {
      showToast("Open failed", String(error), "err");
    }
  };

  return (
    <section className={`content utility-view ${active ? "active" : ""}`}>
      <header className="page-head">
        <div>
          <h1>Scenario runner</h1>
          <p>Build reusable request sequences and keep their request snapshots together.</p>
        </div>
        <ToolButton variant="primary" onClick={async () => {
          const name = await openDialog({ title: "New flow", message: "Enter a name.", confirmLabel: "Create" });
          if (name?.trim()) void mutate(() => createFlow(name), "Create failed");
        }}><Icon name="plus" /> New flow</ToolButton>
      </header>

      <div className="utility-body">
        {!flows.length ? (
          <div className="empty-state">
            <Icon name="flow" size={22} />
            <strong>No flows yet</strong>
            <span>Create a flow, then drag saved requests onto its canvas.</span>
          </div>
        ) : (
          <div className="table-panel">
            <div className="flow-list-tools">
              <input
                ref={filterRef}
                className="side-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
                placeholder="Filter flows..."
                aria-label="Find flows"
              />
            </div>
            <table className="history-table">
              <thead><tr><th><button type="button" className="flow-sort" onClick={() => setSortDirection(sortDirection === "desc" ? "asc" : sortDirection === "asc" ? null : "desc")}>Flow{sortDirection === "asc" ? " ↑" : sortDirection === "desc" ? " ↓" : ""}</button></th><th>Steps</th><th>Open</th><th>Actions</th></tr></thead>
              <tbody>
                {visibleFlows.map((flow) => (
                  <tr key={flow.id}>
                    <th scope="row"><strong>{flow.name}</strong><small className="row-subtitle">{flow.id}</small></th>
                    <td>{flow.nodeCount}</td>
                    <td><ToolButton onClick={() => void open(flow)}>Open</ToolButton></td>
                    <td>
                      <div className="toolbar">
                        <ToolButton iconOnly title={`Rename ${flow.name}`} aria-label={`Rename ${flow.name}`} onClick={async () => {
                          const name = await openDialog({ title: "Rename flow", defaultValue: flow.name, confirmLabel: "Rename" });
                          if (name?.trim() && name.trim() !== flow.name) void mutate(() => renameFlow(flow.id, name.trim()), "Rename failed");
                        }}><Icon name="pencil" /></ToolButton>
                        <ToolButton iconOnly title={`Duplicate ${flow.name}`} aria-label={`Duplicate ${flow.name}`} onClick={() => void mutate(() => duplicateFlow(flow.id), "Duplicate failed")}><Icon name="copy" /></ToolButton>
                        <ToolButton iconOnly title={`Export ${flow.name}`} aria-label={`Export ${flow.name}`} onClick={() => void exportFlow(flow.id, flow.name).catch((error) => showToast("Export failed", String(error), "err"))}><Icon name="download" /></ToolButton>
                        <ToolButton iconOnly variant="danger" title={`Delete ${flow.name}`} aria-label={`Delete ${flow.name}`} onClick={async () => {
                          const confirmed = await openConfirm({
                            title: "Delete flow",
                            message: `Delete "${flow.name}"? This cannot be undone.`,
                            danger: true,
                            confirmLabel: "Delete",
                          });
                          if (confirmed) void mutate(() => deleteFlow(flow.id), "Delete failed");
                        }}><Icon name="trash" /></ToolButton>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleFlows.length === 0 && <tr><td colSpan={4} className="empty-note">No matching flows.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
