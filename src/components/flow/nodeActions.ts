import { removeGraphElements } from "../../lib/flow/canvas";
import { MAX_LOOP_COUNT } from "../../lib/flow/types";
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

/** Modal prompt for a delay duration (used when adding a block); null means cancelled or invalid. */
export async function promptDelayMs(title: string, defaultMs: number): Promise<number | null> {
  const state = useApp.getState();
  const raw = await state.openDialog({
    title,
    message: "How long should the flow pause, in milliseconds?",
    defaultValue: String(defaultMs),
    confirmLabel: "Add",
  });
  if (raw === null) return null;
  const ms = Math.floor(Number(raw.trim()));
  if (!Number.isFinite(ms) || ms < 0) {
    state.showToast("Invalid delay", "Enter a number of milliseconds, 0 or more.", "warn");
    return null;
  }
  return ms;
}

/** Inline edit from the Step detail tab: set a delay step's duration (clamped to >= 0). */
export function setDelayMs(tabId: string, nodeId: string, ms: number): void {
  const current = useApp.getState().flowTabs[tabId];
  if (!current || current.running) return;
  const safe = Math.max(0, Math.floor(ms));
  useApp.getState().updateFlowTab(tabId, {
    flow: {
      ...current.flow,
      nodes: current.flow.nodes.map((item) => item.id === nodeId && item.type === "delay"
        ? { ...item, config: { ms: safe } }
        : item),
    },
  });
}

/** Modal prompt for a loop iteration count (used when adding a block); null means cancelled or invalid. */
export async function promptLoopCount(title: string, defaultCount: number): Promise<number | null> {
  const state = useApp.getState();
  const raw = await state.openDialog({
    title,
    message: `How many times should the loop body run in total? (${1}–${MAX_LOOP_COUNT})`,
    defaultValue: String(defaultCount),
    confirmLabel: "Add",
  });
  if (raw === null) return null;
  const count = Math.floor(Number(raw.trim()));
  if (!Number.isInteger(count) || count < 1 || count > MAX_LOOP_COUNT) {
    state.showToast("Invalid loop count", `Enter a whole number from 1 to ${MAX_LOOP_COUNT}.`, "warn");
    return null;
  }
  return count;
}

/** Inline edit from the Step detail tab: set how many times a loop body runs (clamped 1..MAX_LOOP_COUNT). */
export function setLoopCount(tabId: string, nodeId: string, count: number): void {
  const current = useApp.getState().flowTabs[tabId];
  if (!current || current.running) return;
  const safe = Math.min(MAX_LOOP_COUNT, Math.max(1, Math.floor(count)));
  useApp.getState().updateFlowTab(tabId, {
    flow: {
      ...current.flow,
      nodes: current.flow.nodes.map((item) => item.id === nodeId && item.type === "loop"
        ? { ...item, config: { count: safe } }
        : item),
    },
  });
}

/** Block-face switch: flip a step on/off. An off step is a pass-through — the run skips it
    without failing, and its descendants keep going. Blocked while a run is in flight. */
export function setNodeEnabled(tabId: string, nodeId: string, enabled: boolean): void {
  const current = useApp.getState().flowTabs[tabId];
  if (!current) return;
  if (current.running) {
    useApp.getState().showToast("Flow is running", "Wait for the run to finish before changing the graph.", "warn");
    return;
  }
  useApp.getState().updateFlowTab(tabId, {
    flow: {
      ...current.flow,
      nodes: current.flow.nodes.map((item) => item.id === nodeId ? { ...item, enabled } : item),
    },
  });
}
