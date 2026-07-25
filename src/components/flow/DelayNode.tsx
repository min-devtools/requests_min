import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { DelayFlowNode, StepStatus } from "../../lib/flow/types";
import { isNodeEnabled } from "../../lib/flow/types";
import { Icon } from "../../ui/Icon";
import { NodeActions, NodeToggle, StatusLine } from "./nodeBits";
import { confirmDeleteNode, setNodeEnabled } from "./nodeActions";

export interface DelayNodeData extends Record<string, unknown> {
  node: DelayFlowNode;
  status: StepStatus;
  stale: boolean;
  tabId: string;
}

export type DelayCanvasNode = Node<DelayNodeData, "delay">;

export function DelayNode({ data, isConnectable }: NodeProps<DelayCanvasNode>) {
  const enabled = isNodeEnabled(data.node);
  return (
    <div className={`flow-node flow-node-delay status-${data.status}${data.stale ? " is-stale" : ""}${enabled ? "" : " is-off"}`}>
      <Handle type="target" position={Position.Left} className="handle-in" isConnectable={isConnectable} />
      <div className="flow-node-head">
        <span className="flow-node-emblem" aria-hidden>
          <Icon name="hourglass" size={13} className="flow-hourglass" />
        </span>
        <span className="flow-node-kind">Delay</span>
        {/* lone action: delete — the duration edits inline in the Step detail tab */}
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
      {/* digital readout: the wait time as a clock face, not a sentence */}
      <div className="flow-delay-face" title={`Wait ${data.node.config.ms} milliseconds`}>
        <span className="flow-delay-ms">{data.node.config.ms}</span>
        <span className="flow-delay-unit">ms</span>
      </div>
      <StatusLine status={data.status} stale={data.stale} />
      <Handle type="source" position={Position.Right} className="handle-out" isConnectable={isConnectable} />
    </div>
  );
}
