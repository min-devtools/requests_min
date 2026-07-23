import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { RequestFlowNode, StepStatus } from "../../lib/flow/types";
import { Icon } from "../../ui/Icon";
import { confirmDeleteNode } from "./nodeActions";

export interface RequestNodeData extends Record<string, unknown> {
  node: RequestFlowNode;
  status: StepStatus;
  stale: boolean;
  tabId: string;
  onRun?: (nodeId: string) => void;
}

export type RequestCanvasNode = Node<RequestNodeData, "request">;

export function RequestNode({ data, isConnectable }: NodeProps<RequestCanvasNode>) {
  const request = data.node.config.request;
  const method = request.protocol === "grpc" ? "RPC" : request.http?.method ?? "HTTP";
  const target = request.protocol === "grpc"
    ? [request.grpc?.endpoint, request.grpc?.service, request.grpc?.method].filter(Boolean).join(" · ")
    : request.http?.url ?? "";

  return (
    <div className={`flow-node flow-node-request status-${data.status}${data.stale ? " is-stale" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <div className="flow-node-head">
        <Icon name={request.protocol === "grpc" ? "grpc" : "request"} size={13} />
        <span className={`method-tag ${method}`}>{method}</span>
        <span className="flow-node-key">{data.node.key}</span>
        <span className="flow-node-actions">
          {data.onRun && (
            <button
              type="button"
              className="tool-btn flow-node-btn nodrag nopan"
              title="Run this step"
              aria-label={`Run ${data.node.key}`}
              onClick={(event) => {
                event.stopPropagation();
                data.onRun?.(data.node.id);
              }}
            >
              <Icon name="play" size={11} />
            </button>
          )}
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
      <div className="flow-node-sub">{request.name}</div>
      <div className="flow-node-target" title={target}>{target || "No target"}</div>
      <div className="flow-node-status">{data.status}{data.stale ? " · stale" : ""}</div>
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
}
