import { MAX_LOOP_COUNT } from "../../lib/flow/types";
import { isStepKey } from "../../lib/flow/validate";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { CommitNumberInput } from "./nodeBits";
import { confirmDeleteNode, setLoopCount } from "./nodeActions";
import { formatNumber } from "../../lib/format";

// Lives in the right dock as the Step detail tab for loop blocks — no modal: the pass count
// edits inline right here, next to the in/out anchor legend.
export function LoopPanel({ tabId }: { tabId: string }) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);
  const opened = ft?.flow.nodes.find((item) => item.id === ft.panelNodeId);
  const node = opened?.type === "loop" ? opened : undefined;
  if (!ft || !node) {
    return (
      <div className="inspector-empty flow-panel-hint">
        Click a loop block on the canvas to see its passes and wiring.
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
  const step = ft.run?.steps[node.id];

  return (
    <section className="flow-node-panel flow-loop-panel" aria-label="Selected loop step">
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
      {step?.error && <div className="flow-step-error">{step.error}</div>}

      <div className="flow-loop-body">
        <div className="flow-step-field">
          <span>Body passes</span>
          <CommitNumberInput
            value={node.config.count}
            min={1}
            max={MAX_LOOP_COUNT}
            disabled={ft.running}
            ariaLabel="Loop body passes"
            invalidTitle="Invalid loop count"
            invalidMessage={`Enter a whole number from 1 to ${formatNumber(MAX_LOOP_COUNT)}.`}
            onCommit={(count) => setLoopCount(tabId, node.id, count)}
          />
          {step?.remaining != null && (
            <span className="flow-node-loop-count" title="Passes left">{formatNumber(step.remaining)} left</span>
          )}
        </div>

        <div className="flow-loop-hint">
          <div className="inspector-section-label"><Icon name="repeat" size={12} /> Wiring the circle</div>
          <div className="flow-loop-hint-row">
            <span className="flow-dot flow-dot-in" aria-hidden="true" />
            <span><strong>Top dots are in</strong> — wire the body&apos;s last block into either side of this loop.</span>
          </div>
          <div className="flow-loop-hint-row">
            <span className="flow-dot flow-dot-out" aria-hidden="true" />
            <span><strong>Bottom dots are out</strong> — drag one back into the first body block to close the circle; any other output keeps flowing after the loop.</span>
          </div>
          <p className="flow-loop-hint-note">
            Everything between the loop-back target and this block runs ×{formatNumber(node.config.count)} per flow run; downstream {"{{steps.…}}"} refs resolve to the last pass.
          </p>
        </div>
      </div>
    </section>
  );
}
