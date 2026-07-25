import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { LoopFlowNode, StepStatus } from "../../lib/flow/types";
import { isNodeEnabled } from "../../lib/flow/types";
import { Icon } from "../../ui/Icon";
import { NodeActions, NodeToggle, StatusLine } from "./nodeBits";
import { confirmDeleteNode, setNodeEnabled } from "./nodeActions";

export interface LoopNodeData extends Record<string, unknown> {
  node: LoopFlowNode;
  status: StepStatus;
  stale: boolean;
  tabId: string;
  /** Body passes still to run, live from the engine; null when the loop isn't iterating. */
  remaining: number | null;
}

export type LoopCanvasNode = Node<LoopNodeData, "loop">;

// turbine dial geometry: ring fills as body passes burn down (remaining null = idle = empty ring)
const RING_R = 15.5;
const RING_C = 2 * Math.PI * RING_R;

export function LoopNode({ data, isConnectable }: NodeProps<LoopCanvasNode>) {
  const progress = data.remaining != null
    ? Math.min(1, Math.max(0, 1 - data.remaining / data.node.config.count))
    : 0;
  const enabled = isNodeEnabled(data.node);
  return (
    <div className={`flow-node flow-node-loop status-${data.status}${data.stale ? " is-stale" : ""}${enabled ? "" : " is-off"}`}>
      {/* in/out anchors on BOTH sides: the loop-back wire can hug the left while the flow
          keeps running left-to-right on the right — no long empty wire across the canvas */}
      <Handle type="target" position={Position.Left} className="handle-in" style={{ top: "32%" }} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Left} id="out-left" className="handle-out" style={{ top: "68%" }} isConnectable={isConnectable} />
      <div className="flow-node-head">
        <span className="flow-loop-dial" aria-hidden>
          <svg className="flow-loop-ring" viewBox="0 0 36 36">
            <circle className="flow-loop-ring-track" cx="18" cy="18" r={RING_R} />
            <circle
              className="flow-loop-ring-bar"
              cx="18" cy="18" r={RING_R}
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - progress)}
            />
          </svg>
          <Icon name="repeat" size={12} className="flow-loop-icon" />
        </span>
        <span className="flow-node-kind">Loop</span>
        {data.remaining != null && (
          <span className="flow-node-loop-count" title={`${data.remaining} passes left`} aria-label={`${data.remaining} passes left`}>{data.remaining}</span>
        )}
        {/* lone action: delete — the pass count edits inline in the Step detail tab */}
        <NodeActions items={[
          {
            icon: "trash",
            title: "Delete step",
            ariaLabel: `Delete step ${data.node.key}`,
            danger: true,
            onClick: () => { void confirmDeleteNode(data.tabId, data.node.id, data.node.key); },
          },
        ]} />
        <NodeToggle
          enabled={enabled}
          stepKey={data.node.key}
          onChange={(next) => setNodeEnabled(data.tabId, data.node.id, next)}
        />
      </div>
      <div className="flow-node-sub">run body ×{data.node.config.count}</div>
      <StatusLine status={data.status} stale={data.stale} />
      <Handle type="target" position={Position.Right} id="in-right" className="handle-in" style={{ top: "32%" }} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} className="handle-out" style={{ top: "68%" }} isConnectable={isConnectable} />
    </div>
  );
}
