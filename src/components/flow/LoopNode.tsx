import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { LoopFlowNode, StepStatus } from "../../lib/flow/types";
import { Icon } from "../../ui/Icon";
import { confirmDeleteNode, editLoopNode } from "./nodeActions";

export interface LoopNodeData extends Record<string, unknown> {
  node: LoopFlowNode;
  status: StepStatus;
  stale: boolean;
  tabId: string;
  /** Body passes still to run, live from the engine; null when the loop isn't iterating. */
  remaining: number | null;
}

export type LoopCanvasNode = Node<LoopNodeData, "loop">;

export function LoopNode({ data, isConnectable }: NodeProps<LoopCanvasNode>) {
  return (
    <div className={`flow-node flow-node-loop status-${data.status}${data.stale ? " is-stale" : ""}`}>
      {/* in/out anchors on BOTH sides: the loop-back wire can hug the left while the flow
          keeps running left-to-right on the right — no long empty wire across the canvas */}
      <Handle type="target" position={Position.Left} className="handle-in" style={{ top: "32%" }} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Left} id="out-left" className="handle-out" style={{ top: "68%" }} isConnectable={isConnectable} />
      <div className="flow-node-head">
        <Icon name="repeat" size={13} />
        <span className="flow-node-kind">Loop</span>
        {data.remaining != null && (
          <span className="flow-node-loop-count" title={`${data.remaining} passes left`} aria-label={`${data.remaining} passes left`}>{data.remaining}</span>
        )}
        <span className="flow-node-actions">
          <button
            type="button"
            className="tool-btn flow-node-btn nodrag nopan"
            title="Edit loop"
            aria-label={`Edit loop ${data.node.key}`}
            onClick={(event) => {
              event.stopPropagation();
              void editLoopNode(data.tabId, data.node.id);
            }}
          >
            <Icon name="pencil" size={11} />
          </button>
          <button
            type="button"
            className="tool-btn flow-node-btn danger nodrag nopan"
            title="Delete step"
            aria-label={`Delete step ${data.node.key}`}
            onClick={(event) => {
              event.stopPropagation();
              void confirmDeleteNode(data.tabId, data.node.id, data.node.key);
            }}
          >
            <Icon name="trash" size={11} />
          </button>
        </span>
      </div>
      <div className="flow-node-sub">run body ×{data.node.config.count}</div>
      <div className="flow-node-status">{data.status}{data.stale ? " · stale" : ""}</div>
      <Handle type="target" position={Position.Right} id="in-right" className="handle-in" style={{ top: "32%" }} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} className="handle-out" style={{ top: "68%" }} isConnectable={isConnectable} />
    </div>
  );
}
