import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StepStatus, TransformFlowNode } from "../../lib/flow/types";
import { isNodeEnabled } from "../../lib/flow/types";
import { Icon } from "../../ui/Icon";
import { NodeActions, NodeToggle, StatusLine } from "./nodeBits";
import { confirmDeleteNode, setNodeEnabled } from "./nodeActions";

export interface TransformNodeData extends Record<string, unknown> {
  node: TransformFlowNode;
  status: StepStatus;
  stale: boolean;
  tabId: string;
  /** "done · 3 ms"-style summary of the last run, shown in place of the status word. */
  readout: string | null;
}

export type TransformCanvasNode = Node<TransformNodeData, "transform">;

// first non-comment, non-blank line of the script — a hint of what the transform does
const codePreview = (code: string): string => {
  const line = code.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("//"));
  return line ?? "return value";
};

export function TransformNode({ data, isConnectable }: NodeProps<TransformCanvasNode>) {
  const enabled = isNodeEnabled(data.node);
  return (
    <div className={`flow-node flow-node-transform status-${data.status}${data.stale ? " is-stale" : ""}${enabled ? "" : " is-off"}`}>
      <Handle type="target" position={Position.Left} className="handle-in" isConnectable={isConnectable} />
      <div className="flow-node-head">
        <span className="flow-win-dots" aria-hidden><i /><i /><i /></span>
        <span className="flow-node-emblem" aria-hidden>
          <Icon name="braces" size={13} />
        </span>
        <span className="flow-node-kind">Transform</span>
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
      <div className="flow-node-key">{data.node.key}</div>
      {/* mini editor window: purple ƒ watermark + the script's first meaningful line */}
      <div className="flow-node-code" title="Click to edit in the dock">
        <span className="flow-node-fn" aria-hidden>ƒ</span>
        <span className="flow-node-code-line">{codePreview(data.node.config.code)}</span>
      </div>
      <StatusLine status={data.status} stale={data.stale} readout={data.readout} />
      <Handle type="source" position={Position.Right} className="handle-out" isConnectable={isConnectable} />
    </div>
  );
}
