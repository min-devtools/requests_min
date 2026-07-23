import type { Request } from "../api.ts";
import type {
  DelayFlowNode,
  FlowEdge,
  FlowNode,
  RequestFlowNode,
  TransformFlowNode,
} from "./types.ts";
import { DEFAULT_TRANSFORM_CODE } from "./transform.ts";
import { stepKeyFor, topoOrder } from "./validate.ts";

export interface RequestDropPayload {
  kind: "request";
  collectionId: string;
  relPath: string;
}

export function parseRequestDropPayload(raw: string): RequestDropPayload {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid request drop payload");
  }
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) throw new Error("Invalid request drop payload");

  const payload = value as Record<string, unknown>;
  if (
    payload.kind !== "request"
    || typeof payload.collectionId !== "string"
    || payload.collectionId.trim().length === 0
    || typeof payload.relPath !== "string"
    || payload.relPath.trim().length === 0
  ) throw new Error("Invalid request drop payload");

  return {
    kind: "request",
    collectionId: payload.collectionId,
    relPath: payload.relPath,
  };
}

export function createRequestFlowNode(input: {
  id: string;
  request: Request;
  origin: { collectionId: string; relPath: string };
  position: { x: number; y: number };
  takenKeys: ReadonlySet<string>;
}): RequestFlowNode {
  if (input.request.protocol === "ws") {
    throw new Error("WebSocket requests are not supported in flows");
  }
  const request = structuredClone(input.request);
  return {
    id: input.id,
    key: stepKeyFor(request.name, input.takenKeys),
    type: "request",
    position: { ...input.position },
    config: {
      request,
      origin: { ...input.origin },
    },
  };
}

export function createDelayFlowNode(
  id: string,
  takenKeys: ReadonlySet<string>,
  position: { x: number; y: number },
): DelayFlowNode {
  return {
    id,
    key: stepKeyFor("delay", takenKeys),
    type: "delay",
    position: { ...position },
    config: { ms: 1000 },
  };
}

export function createTransformFlowNode(
  id: string,
  takenKeys: ReadonlySet<string>,
  position: { x: number; y: number },
): TransformFlowNode {
  return {
    id,
    key: stepKeyFor("transform", takenKeys),
    type: "transform",
    position: { ...position },
    config: { code: DEFAULT_TRANSFORM_CODE },
  };
}

const LAYOUT_COL = 300;
const LAYOUT_ROW = 150;
const LAYOUT_MARGIN = 60;

/** Arrange nodes in dependency columns: depth = longest path from a root. */
export function autoLayoutNodes(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
): FlowNode[] {
  const order = topoOrder(nodes, edges);
  if (!order) return [...nodes];

  const depth = new Map(order.map((id) => [id, 0]));
  for (const id of order) {
    for (const edge of edges) {
      if (edge.source !== id || !depth.has(edge.target)) continue;
      depth.set(edge.target, Math.max(depth.get(edge.target)!, depth.get(id)! + 1));
    }
  }

  const rowsPerColumn = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of order) {
    const column = depth.get(id)!;
    const row = rowsPerColumn.get(column) ?? 0;
    rowsPerColumn.set(column, row + 1);
    positions.set(id, { x: LAYOUT_MARGIN + column * LAYOUT_COL, y: LAYOUT_MARGIN + row * LAYOUT_ROW });
  }

  let changed = false;
  const nextNodes = nodes.map((node) => {
    const position = positions.get(node.id)!;
    if (node.position.x === position.x && node.position.y === position.y) return node;
    changed = true;
    return { ...node, position };
  });
  return changed ? nextNodes : [...nodes];
}

export function commitNodePositions(
  nodes: FlowNode[],
  positionedNodes: readonly { id: string; position: { x: number; y: number } }[],
): FlowNode[] {
  const positions = new Map(positionedNodes.map((node) => [node.id, node.position]));
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || (node.position.x === position.x && node.position.y === position.y)) return node;
    changed = true;
    return { ...node, position: { ...position } };
  });
  return changed ? nextNodes : nodes;
}

export function removeGraphElements(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  removedNodeIds: ReadonlySet<string>,
  removedEdgeIds: ReadonlySet<string>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nextNodes = nodes.filter((node) => !removedNodeIds.has(node.id));
  const nodeIds = new Set(nextNodes.map((node) => node.id));
  return {
    nodes: nextNodes,
    edges: edges.filter((edge) => (
      !removedEdgeIds.has(edge.id)
      && nodeIds.has(edge.source)
      && nodeIds.has(edge.target)
    )),
  };
}
