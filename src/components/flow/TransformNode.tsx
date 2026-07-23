import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StepStatus, TransformFlowNode } from "../../lib/flow/types";
import { Icon } from "../../ui/Icon";
import { confirmDeleteNode } from "./nodeActions";

export interface TransformNodeData extends Record<string, unknown> {
  node: TransformFlowNode;
  status: StepStatus;
  stale: boolean;
  tabId: string;
}

export type TransformCanvasNode = Node<TransformNodeData, "transform">;

// first non-comment, non-blank line of the script — a hint of what the transform does
const codePreview = (code: string): string => {
  const line = code.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("//"));
  return line ?? "return value";
};

export function TransformNode({ data, isConnectable }: NodeProps<TransformCanvasNode>) {
  return (
    <div className={`flow-node flow-node-transform status-${data.status}${data.stale ? " is-stale" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <div className="flow-node-head">
        <Icon name="braces" size={13} />
        <span className="flow-node-kind">Transform</span>
        <span className="flow-node-key">{data.node.key}</span>
        <span className="flow-node-actions">
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
      <div className="flow-node-sub flow-node-code" title="Click to edit in the dock">{codePreview(data.node.config.code)}</div>
      <div className="flow-node-status">{data.status}{data.stale ? " · stale" : ""}</div>
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
}
