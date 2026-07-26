import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { RequestFlowNode, StepStatus } from "../../lib/flow/types";
import { Icon } from "../../ui/Icon";
import { NodeActions, StatusLine } from "./nodeBits";
import { confirmDeleteNode } from "./nodeActions";

export interface RequestNodeData extends Record<string, unknown> {
  node: RequestFlowNode;
  status: StepStatus;
  stale: boolean;
  tabId: string;
  /** "200 OK · 145 ms"-style summary of the last run, shown in place of the status word. */
  readout: string | null;
  onRun?: (nodeId: string) => void;
}

export type RequestCanvasNode = Node<RequestNodeData, "request">;

// HTTP = a dispatch slip (rail + chip in the method's own hue, globe emblem);
// gRPC = a connector plug (cyan identity, cable emblem, equalizer that dances while streaming)
export function RequestNode({ data, isConnectable }: NodeProps<RequestCanvasNode>) {
  const request = data.node.config.request;
  const grpc = request.protocol === "grpc";
  const method = grpc ? "RPC" : request.http?.method ?? "HTTP";
  const target = grpc
    ? [request.grpc?.endpoint, request.grpc?.service, request.grpc?.method].filter(Boolean).join(" · ")
    : request.http?.url ?? "";

  return (
    <div
      className={`flow-node flow-node-request${grpc ? " flow-node-grpc" : ""} status-${data.status}${data.stale ? " is-stale" : ""}`}
      data-method={method}
    >
      <Handle type="target" position={Position.Left} className="handle-in" isConnectable={isConnectable} />
      <div className="flow-node-head">
        <span className="flow-node-emblem" aria-hidden>
          <Icon name={grpc ? "cable" : "globe"} size={13} />
        </span>
        <span className={`method-tag ${method}`}>{method}</span>
        <span className="flow-node-key">{data.node.key}</span>
        <NodeActions items={[
          ...(data.onRun ? [{
            icon: "play" as const,
            title: "Run this step",
            ariaLabel: `Run ${data.node.key}`,
            onClick: () => data.onRun?.(data.node.id),
          }] : []),
          {
            icon: "trash" as const,
            title: "Delete step",
            ariaLabel: `Delete step ${data.node.key}`,
            danger: true,
            onClick: () => { void confirmDeleteNode(data.tabId, data.node.id, data.node.key); },
          },
        ]} />
      </div>
      <div className="flow-node-sub">{request.name}</div>
      <div className="flow-node-target" title={target}>{target || "No target"}</div>
      <div className="flow-node-foot">
        <StatusLine status={data.status} stale={data.stale} readout={data.readout} />
        {grpc && (
          <span className="flow-stream" title="gRPC stream" aria-hidden><i /><i /><i /></span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="handle-out" isConnectable={isConnectable} />
    </div>
  );
}
