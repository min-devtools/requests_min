import { autoLayoutNodes, createDelayFlowNode, createTransformFlowNode } from "../../lib/flow/canvas";
import { runFlow } from "../../lib/flow/engine";
import { saveActiveFlow } from "../../lib/flow/flowActions";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { FlowCanvas } from "../flow/FlowCanvas";
import { promptDelayMs } from "../flow/nodeActions";
import { RunReport } from "../flow/RunReport";

const nextNodeId = () =>
  `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function FlowView({ tabId, active }: { tabId: string; active: boolean }) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);

  if (!ft) return null;

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
      selectedNodeId: node.id,
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
      selectedNodeId: node.id,
      // open its editor in the dock right away
      panelNodeId: node.id,
      dockTab: "step",
    });
  };

  const arrange = () => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    const nodes = autoLayoutNodes(current.flow.nodes, current.flow.edges);
    if (nodes !== current.flow.nodes) {
      updateFlowTab(tabId, { flow: { ...current.flow, nodes } });
    }
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
        <button type="button" className="tool-btn" onClick={arrange} disabled={ft.running || ft.flow.nodes.length === 0}>
          <Icon name="wand" />
          Arrange
        </button>
        <button type="button" className="tool-btn" onClick={() => void addDelay()} disabled={ft.running}>
          <Icon name="timer" />
          Add delay
        </button>
        <button type="button" className="tool-btn" onClick={addTransform} disabled={ft.running}>
          <Icon name="braces" />
          Add transform
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={() => void saveActiveFlow().catch((error) => useApp.getState().showToast("Save failed", String(error), "err"))}
          disabled={ft.running || !ft.dirty}
        >
          <Icon name="save" />
          Save
        </button>
      </div>
      <div className="flow-body">
        <div className="flow-canvas-wrap">
          <FlowCanvas tabId={tabId} active={active}
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
