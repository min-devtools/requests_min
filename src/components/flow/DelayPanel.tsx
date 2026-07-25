import { isStepKey } from "../../lib/flow/validate";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { CommitNumberInput } from "./nodeBits";
import { confirmDeleteNode, setDelayMs } from "./nodeActions";

// Lives in the right dock as the Step detail tab for delay blocks — the wait duration edits
// inline here (no modal), mirroring the loop panel.
export function DelayPanel({ tabId }: { tabId: string }) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);
  const opened = ft?.flow.nodes.find((item) => item.id === ft.panelNodeId);
  const node = opened?.type === "delay" ? opened : undefined;
  if (!ft || !node) {
    return (
      <div className="inspector-empty flow-panel-hint">
        Click a delay block on the canvas to set how long the flow pauses.
      </div>
    );
  }

  const updateKey = (key: string) => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    updateFlowTab(tabId, {
      flow: {
        ...current.flow,
        nodes: current.flow.nodes.map((item) => item.id === node.id ? { ...item, key } : item),
      },
    });
  };

  const keyError = !isStepKey(node.key)
    ? "Lowercase letters, digits and dashes only (e.g. poll-again)"
    : ft.flow.nodes.some((item) => item.id !== node.id && item.key === node.key)
      ? "This key is already used by another step"
      : null;

  return (
    <section className="flow-node-panel flow-delay-panel" aria-label="Selected delay step">
      <div className="flow-node-panel-head">
        <label>
          <span>Key</span>
          <input
            value={node.key}
            disabled={ft.running}
            aria-invalid={keyError !== null}
            onChange={(event) => updateKey(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="tool-btn icon-only danger"
          title="Delete step"
          aria-label={`Delete step ${node.key}`}
          disabled={ft.running}
          onClick={() => void confirmDeleteNode(tabId, node.id, node.key)}
        >
          <Icon name="trash" />
        </button>
        <button
          type="button"
          className="tool-btn icon-only"
          title="Close step details"
          aria-label="Close step details"
          onClick={() => updateFlowTab(tabId, { panelNodeId: null })}
        >
          <Icon name="x" />
        </button>
      </div>
      {keyError && <div className="flow-key-error">{keyError}</div>}

      <div className="flow-loop-body">
        <div className="flow-step-field">
          <span>Wait for</span>
          <CommitNumberInput
            value={node.config.ms}
            min={0}
            disabled={ft.running}
            ariaLabel="Delay duration in milliseconds"
            invalidTitle="Invalid delay"
            invalidMessage="Enter a number of milliseconds, 0 or more."
            onCommit={(ms) => setDelayMs(tabId, node.id, ms)}
          />
          <span className="flow-step-unit">ms</span>
        </div>
        <p className="flow-loop-hint-note">
          The flow pauses on this block, then continues to the next step. A delay of 0 ms simply yields.
        </p>
      </div>
    </section>
  );
}
