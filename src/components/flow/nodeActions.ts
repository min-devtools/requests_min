import { removeGraphElements } from "../../lib/flow/canvas";
import { useApp } from "../../store";

/** Confirm-then-delete for a flow node; also drops every edge touching it. */
export async function confirmDeleteNode(tabId: string, nodeId: string, key: string): Promise<void> {
  const confirmed = await useApp.getState().openConfirm({
    title: "Delete step",
    message: `Delete step "${key}"? Its connections are removed too.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!confirmed) return;
  const current = useApp.getState().flowTabs[tabId];
  if (!current || current.running) return;
  const graph = removeGraphElements(current.flow.nodes, current.flow.edges, new Set([nodeId]), new Set());
  // updateFlowTab clears selectedNodeId/panelNodeId itself when their node disappears
  useApp.getState().updateFlowTab(tabId, { flow: { ...current.flow, ...graph } });
}

/** Modal prompt for a delay duration; null means cancelled or invalid. */
export async function promptDelayMs(title: string, defaultMs: number): Promise<number | null> {
  const state = useApp.getState();
  const raw = await state.openDialog({
    title,
    message: "How long should the flow pause, in milliseconds?",
    defaultValue: String(defaultMs),
    confirmLabel: title === "Add delay" ? "Add" : "Save",
  });
  if (raw === null) return null;
  const ms = Math.floor(Number(raw.trim()));
  if (!Number.isFinite(ms) || ms < 0) {
    state.showToast("Invalid delay", "Enter a number of milliseconds, 0 or more.", "warn");
    return null;
  }
  return ms;
}

export async function editDelayNode(tabId: string, nodeId: string): Promise<void> {
  const node = useApp.getState().flowTabs[tabId]?.flow.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== "delay") return;
  const ms = await promptDelayMs("Edit delay", node.config.ms);
  if (ms === null) return;
  const current = useApp.getState().flowTabs[tabId];
  if (!current || current.running) return;
  useApp.getState().updateFlowTab(tabId, {
    flow: {
      ...current.flow,
      nodes: current.flow.nodes.map((item) => item.id === nodeId && item.type === "delay"
        ? { ...item, config: { ms } }
        : item),
    },
  });
}
