import { save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../../store";
import { api, type FlowMeta } from "../api";
import { emptyFlow, type Flow } from "./types";

type FlowBackend = Pick<typeof api, "flowRead" | "flowWrite" | "flowDelete" | "flowExport">;
type FlowActionState = ReturnType<typeof useApp.getState>;

interface FlowActionDependencies {
  backend: FlowBackend;
  getState: () => FlowActionState;
  saveDialog: typeof save;
  makeId: () => string;
}

let flowIdSequence = 0;
export const newFlowId = () => {
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `flow-${Date.now().toString(36)}-${(++flowIdSequence).toString(36)}-${random}`;
};

export function createLatestFlowListReload({
  load,
  apply,
  fail,
}: {
  load: () => Promise<FlowMeta[]>;
  apply: (flows: FlowMeta[]) => void;
  fail: (error: unknown) => void;
}) {
  let latestRequest = 0;
  return async () => {
    const request = ++latestRequest;
    try {
      const flows = await load();
      if (request === latestRequest) apply(flows);
    } catch (error) {
      if (request === latestRequest) fail(error);
    }
  };
}

const baselineWithName = (original: string, diskFlow: Flow, name: string) => {
  let baseline = diskFlow;
  try {
    const parsed: unknown = JSON.parse(original);
    if (
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed as Partial<Flow>).id === diskFlow.id
      && (parsed as Partial<Flow>).version === 1
      && Array.isArray((parsed as Partial<Flow>).nodes)
      && Array.isArray((parsed as Partial<Flow>).edges)
    ) baseline = parsed as Flow;
  } catch {
    // A missing/corrupt session baseline falls back to the known disk snapshot.
  }
  return JSON.stringify({ ...structuredClone(baseline), name });
};

export function createFlowActions({ backend, getState, saveDialog, makeId }: FlowActionDependencies) {
  const createFlow = async (name: string) => {
    const value = emptyFlow(makeId(), name.trim() || "New flow");
    await backend.flowWrite(value.id, value);
    await getState().openFlowTab(value.id);
  };

  const saveActiveFlow = async () => {
    const state = getState();
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    if (!tab || tab.kind !== "flow") return;
    const flowTab = state.flowTabs[tab.id];
    if (!flowTab) return;

    const snapshot = structuredClone(flowTab.flow);
    const original = JSON.stringify(snapshot);
    await backend.flowWrite(flowTab.flowId, snapshot);
    getState().updateFlowTab(tab.id, { original });
    getState().showToast("Saved", `${snapshot.name} written to disk.`);
  };

  const renameFlow = async (id: string, name: string) => {
    const diskFlow = await backend.flowRead(id);
    const renamedDiskFlow = { ...structuredClone(diskFlow), name };
    await backend.flowWrite(id, renamedDiskFlow);

    const current = getState();
    for (const tab of current.tabs) {
      const flowTab = getState().flowTabs[tab.id];
      if (flowTab?.flowId !== id) continue;
      getState().updateFlowTab(tab.id, {
        flow: { ...flowTab.flow, name },
        original: baselineWithName(flowTab.original, renamedDiskFlow, name),
      });
    }
  };

  const duplicateFlow = async (id: string) => {
    const diskFlow = structuredClone(await backend.flowRead(id));
    const copy = { ...diskFlow, id: makeId(), name: `${diskFlow.name} copy` };
    await backend.flowWrite(copy.id, copy);
  };

  const deleteFlow = async (id: string) => {
    await backend.flowDelete(id);
    for (const tab of [...getState().tabs]) {
      const state = getState();
      if (state.flowTabs[tab.id]?.flowId === id) state.closeTab(tab.id);
    }
  };

  const exportFlow = async (id: string, name: string) => {
    const state = getState();
    const hasUnsaved = state.tabs.some((tab) => {
      const flowTab = state.flowTabs[tab.id];
      return flowTab?.flowId === id && flowTab.dirty;
    });
    if (hasUnsaved && !(await state.openConfirm({
      title: "Export last saved version?",
      message: `"${name}" has unsaved changes in an open tab. The export uses the last saved version.`,
      confirmLabel: "Export",
    }))) return;
    const safeName = name
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
      .replace(/[. ]+$/g, "") || "flow";
    const dest = await saveDialog({
      defaultPath: `${safeName}.flow.json`,
      filters: [{ name: "Flow", extensions: ["json"] }],
    });
    if (!dest) return;
    await backend.flowExport(id, dest);
    getState().showToast("Exported", dest);
  };

  return { createFlow, saveActiveFlow, renameFlow, duplicateFlow, deleteFlow, exportFlow };
}

const actions = createFlowActions({ backend: api, getState: useApp.getState, saveDialog: save, makeId: newFlowId });

export const createFlow = actions.createFlow;
export const saveActiveFlow = actions.saveActiveFlow;
export const renameFlow = actions.renameFlow;
export const duplicateFlow = actions.duplicateFlow;
export const deleteFlow = actions.deleteFlow;
export const exportFlow = actions.exportFlow;
