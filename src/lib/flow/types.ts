import type { GrpcResponse, HttpResponse, Request } from "../api";

export type FlowNodeType = "request" | "delay" | "transform";

export interface RequestNodeConfig {
  request: Request;
  origin?: { collectionId: string; relPath: string };
  onError?: "stop" | "continue";
}

export interface DelayNodeConfig {
  ms: number;
}

export interface TransformNodeConfig {
  /** JS body run with (value, steps) in scope; must `return` the step output. */
  code: string;
}

export interface FlowNodeBase {
  id: string;
  key: string;
  position: { x: number; y: number };
}

export interface RequestFlowNode extends FlowNodeBase {
  type: "request";
  config: RequestNodeConfig;
}

export interface DelayFlowNode extends FlowNodeBase {
  type: "delay";
  config: DelayNodeConfig;
}

export interface TransformFlowNode extends FlowNodeBase {
  type: "transform";
  config: TransformNodeConfig;
}

export type FlowNode = RequestFlowNode | DelayFlowNode | TransformFlowNode;

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface Flow {
  version: 1;
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type StepStatus = "idle" | "running" | "success" | "failed" | "skipped";

export interface StepResult {
  status: StepStatus;
  timeMs?: number;
  resolvedRequest?: Request;
  response?: HttpResponse | GrpcResponse;
  /** Return value of a transform step; exposed downstream as {{steps.<key>}} and the next step's `value`. */
  output?: unknown;
  error?: string;
  /** Carried over from a previous run for display; never usable as a {{steps.*}} source. */
  stale?: boolean;
}

export interface FlowRun {
  startedAt: number;
  totalMs?: number;
  status: "running" | "success" | "failed" | "cancelled";
  steps: Record<string, StepResult>;
}

export const emptyFlow = (id: string, name: string): Flow => ({
  version: 1,
  id,
  name,
  nodes: [],
  edges: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const isRequestNode = (node: unknown): node is RequestFlowNode => {
  if (
    !isRecord(node)
    || typeof node.id !== "string"
    || typeof node.key !== "string"
    || !isRecord(node.position)
    || typeof node.position.x !== "number"
    || !Number.isFinite(node.position.x)
    || typeof node.position.y !== "number"
    || !Number.isFinite(node.position.y)
    || node.type !== "request"
    || !isRecord(node.config)
  ) return false;
  const request = node.config.request;
  return isRecord(request)
    && typeof request.name === "string"
    && (request.protocol === "http" || request.protocol === "grpc" || request.protocol === "ws");
};

export const isTransformNode = (node: unknown): node is TransformFlowNode =>
  isRecord(node)
  && node.type === "transform"
  && isRecord(node.config)
  && typeof node.config.code === "string";

const isNodeBase = (node: Record<string, unknown>): boolean =>
  typeof node.id === "string"
  && typeof node.key === "string"
  && isRecord(node.position)
  && Number.isFinite(node.position.x)
  && Number.isFinite(node.position.y);

const isFlowNode = (node: unknown): node is FlowNode => {
  if (!isRecord(node) || !isNodeBase(node)) return false;
  if (node.type === "request") return isRequestNode(node);
  if (node.type === "delay") {
    return isRecord(node.config)
      && typeof node.config.ms === "number"
      && Number.isFinite(node.config.ms)
      && node.config.ms >= 0;
  }
  return isTransformNode(node);
};

const isFlowEdge = (edge: unknown): edge is FlowEdge =>
  isRecord(edge)
  && typeof edge.id === "string"
  && typeof edge.source === "string"
  && typeof edge.target === "string"
  && (edge.sourceHandle === undefined || typeof edge.sourceHandle === "string");

/**
 * Structural guard for flows coming from outside the app's type system — the backend returns
 * the raw JSON of hand-editable files in ~/RequestsMin/flows, and session restore reads
 * localStorage. Semantic checks (cycles, duplicate keys…) stay in validateFlow.
 */
export const isFlow = (value: unknown): value is Flow =>
  isRecord(value)
  && value.version === 1
  && typeof value.id === "string"
  && typeof value.name === "string"
  && Array.isArray(value.nodes)
  && value.nodes.every(isFlowNode)
  && Array.isArray(value.edges)
  && value.edges.every(isFlowEdge);
