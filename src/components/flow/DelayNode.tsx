import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { DelayFlowNode, StepStatus } from "../../lib/flow/types";
import { Icon } from "../../ui/Icon";
import { confirmDeleteNode, editDelayNode } from "./nodeActions";

export interface DelayNodeData extends Record<string, unknown> {
  node: DelayFlowNode;
  status: StepStatus;
  stale: boolean;
  tabId: string;
}

export type DelayCanvasNode = Node<DelayNodeData, "delay">;

export function DelayNode({ data, isConnectable }: NodeProps<DelayCanvasNode>) {
  return (
    <div className={`flow-node flow-node-delay status-${data.status}${data.stale ? " is-stale" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <div className="flow-node-head">
        <Icon name="timer" size={13} />
        <span className="flow-node-kind">Delay</span>
        <span className="flow-node-key">{data.node.key}</span>
        <span className="flow-node-actions">
          <button
            type="button"
            className="tool-btn flow-node-btn nodrag nopan"
            title="Edit delay"
            aria-label={`Edit delay ${data.node.key}`}
            onClick={(event) => {
              event.stopPropagation();
              void editDelayNode(data.tabId, data.node.id);
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
      <div className="flow-node-sub">wait {data.node.config.ms} ms</div>
      <div className="flow-node-status">{data.status}{data.stale ? " · stale" : ""}</div>
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
}
