import type { Request } from "../api.ts";
import type {
  DelayFlowNode,
  FlowEdge,
  FlowNode,
  LoopFlowNode,
  RequestFlowNode,
  TransformFlowNode,
} from "./types.ts";
import dagre from "@dagrejs/dagre";
import { DEFAULT_TRANSFORM_CODE } from "./transform.ts";
import { dagEdges, loopBackEdgeMap, stepKeyFor } from "./validate.ts";

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

export function createLoopFlowNode(
  id: string,
  takenKeys: ReadonlySet<string>,
  position: { x: number; y: number },
): LoopFlowNode {
  return {
    id,
    key: stepKeyFor("loop", takenKeys),
    type: "loop",
    position: { ...position },
    config: { count: 3 },
  };
}

export type LayoutDirection = "LR" | "TB";

const LAYOUT_NODE_SEP = 48;   // gap between blocks sharing a rank
const LAYOUT_RANK_SEP = 90;   // gap between successive ranks
const LAYOUT_MARGIN = 60;
const LOOP_LANE_GAP = 60;     // clearance pushing loop blocks off the chain lane

/** Layered auto-layout via dagre; direction picks the main axis (LR or TB). */
export function layoutGraph(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  direction: LayoutDirection,
  sizes: ReadonlyMap<string, NodeSize>,
): FlowNode[] {
  if (nodes.length === 0) return [];
  // loop back-edges close circles on purpose; layout walks the acyclic remainder, same as
  // the engine — otherwise any flow with a loop would knot the layered ranking
  const layoutEdges = dagEdges({ nodes, edges });
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    nodesep: LAYOUT_NODE_SEP,
    ranksep: LAYOUT_RANK_SEP,
    marginx: LAYOUT_MARGIN,
    marginy: LAYOUT_MARGIN,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { ...(sizes.get(node.id) ?? DEFAULT_NODE_SIZE) });
  for (const edge of layoutEdges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  // A looped-back loop block leaves the chain lane so its back wire routes outside the
  // blocks: below the chain when arranging LR, to the right of it when arranging TB
  const loopIds = new Set(
    [...loopBackEdgeMap({ nodes, edges })]
      .filter(([, backs]) => backs.length > 0)
      .map(([id]) => id),
  );
  let laneEdge = -Infinity;
  for (const node of nodes) {
    if (loopIds.has(node.id)) continue;
    const placed = graph.node(node.id);
    laneEdge = Math.max(laneEdge, direction === "LR" ? placed.y + placed.height / 2 : placed.x + placed.width / 2);
  }

  let changed = false;
  const nextNodes = nodes.map((node) => {
    const placed = graph.node(node.id);
    // dagre reports centers; flow nodes store top-left corners
    let x = placed.x - placed.width / 2;
    let y = placed.y - placed.height / 2;
    if (loopIds.has(node.id) && laneEdge > -Infinity) {
      if (direction === "LR") y = Math.max(y, laneEdge + LOOP_LANE_GAP);
      else x = Math.max(x, laneEdge + LOOP_LANE_GAP);
    }
    x = Math.round(x);
    y = Math.round(y);
    if (node.position.x === x && node.position.y === y) return node;
    changed = true;
    return { ...node, position: { x, y } };
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

export interface NodeSize { width: number; height: number }
/** Pre-measure fallback footprint for a canvas block. */
export const DEFAULT_NODE_SIZE: NodeSize = { width: 220, height: 88 };

const nodeCenter = (
  node: FlowNode,
  axis: "x" | "y",
  sizes: ReadonlyMap<string, NodeSize>,
): number => {
  const size = sizes.get(node.id) ?? DEFAULT_NODE_SIZE;
  return axis === "x" ? node.position.x + size.width / 2 : node.position.y + size.height / 2;
};

const placeCenter = (
  node: FlowNode,
  axis: "x" | "y",
  center: number,
  sizes: ReadonlyMap<string, NodeSize>,
): { x: number; y: number } => {
  const size = sizes.get(node.id) ?? DEFAULT_NODE_SIZE;
  return axis === "x"
    ? { x: Math.round(center - size.width / 2), y: node.position.y }
    : { x: node.position.x, y: Math.round(center - size.height / 2) };
};

/** Align the picked blocks' centers on one coordinate ("y" = one row, "x" = one column). */
export function alignNodes(
  nodes: readonly FlowNode[],
  ids: ReadonlySet<string>,
  axis: "x" | "y",
  sizes: ReadonlyMap<string, NodeSize>,
): FlowNode[] {
  const picked = nodes.filter((node) => ids.has(node.id));
  if (picked.length < 2) return [...nodes];
  const target = picked.reduce((sum, node) => sum + nodeCenter(node, axis, sizes), 0) / picked.length;
  return nodes.map((node) => {
    if (!ids.has(node.id)) return node;
    const position = placeCenter(node, axis, target, sizes);
    return position.x === node.position.x && position.y === node.position.y
      ? node
      : { ...node, position };
  });
}

/** Spread the picked blocks so center gaps are equal along one axis; the outermost two stay put. */
export function distributeNodes(
  nodes: readonly FlowNode[],
  ids: ReadonlySet<string>,
  axis: "x" | "y",
  sizes: ReadonlyMap<string, NodeSize>,
): FlowNode[] {
  const picked = nodes.filter((node) => ids.has(node.id));
  if (picked.length < 3) return [...nodes];
  const sorted = [...picked].sort((a, b) => nodeCenter(a, axis, sizes) - nodeCenter(b, axis, sizes));
  const first = nodeCenter(sorted[0], axis, sizes);
  const step = (nodeCenter(sorted[sorted.length - 1], axis, sizes) - first) / (sorted.length - 1);
  const targets = new Map(sorted.map((node, index) => [node.id, first + step * index]));
  return nodes.map((node) => {
    const center = targets.get(node.id);
    if (center === undefined) return node;
    const position = placeCenter(node, axis, center, sizes);
    return position.x === node.position.x && position.y === node.position.y
      ? node
      : { ...node, position };
  });
}

/**
 * Folds React Flow select/remove changes into the store's recency-ordered selection.
 * Returns the SAME array reference when nothing changed so callers can skip the write.
 */
export function nextSelection(
  current: string[],
  changes: readonly { type: string; id?: string; selected?: boolean }[],
): string[] {
  let next = current;
  for (const change of changes) {
    if (!change.id) continue;
    if (change.type === "select" && change.selected) {
      if (!next.includes(change.id)) next = [...next, change.id];
    } else if (change.type === "select" || change.type === "remove") {
      if (next.includes(change.id)) next = next.filter((id) => id !== change.id);
    }
  }
  return next;
}

export interface FlowClipboard {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Deep-clones the selected nodes plus the edges whose both ends are selected, so the
 * clipboard stays valid no matter how the graph changes afterwards. Null when nothing
 * usable is selected.
 */
export function copyGraphElements(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  selectedNodeIds: ReadonlySet<string>,
): FlowClipboard | null {
  const picked = nodes.filter((node) => selectedNodeIds.has(node.id));
  if (picked.length === 0) return null;
  const pickedIds = new Set(picked.map((node) => node.id));
  return structuredClone({
    nodes: picked,
    edges: edges.filter((edge) => pickedIds.has(edge.source) && pickedIds.has(edge.target)),
  });
}

/**
 * Re-ids and re-keys the clipboard contents for insertion: every pasted node gets a fresh
 * id, a collision-safe step key, and an offset position; edges follow the id remap.
 */
export function pasteGraphElements(
  clipboard: FlowClipboard,
  takenKeys: ReadonlySet<string>,
  makeId: (prefix: "n" | "e") => string,
  offset: { x: number; y: number },
): FlowClipboard {
  const keys = new Set(takenKeys);
  const idMap = new Map<string, string>();
  const nodes = clipboard.nodes.map((node) => {
    const id = makeId("n");
    idMap.set(node.id, id);
    const key = stepKeyFor(node.key, keys);
    keys.add(key);
    return {
      ...structuredClone(node),
      id,
      key,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
    };
  });
  const edges = clipboard.edges.map((edge) => ({
    ...edge,
    id: makeId("e"),
    source: idMap.get(edge.source)!,
    target: idMap.get(edge.target)!,
  }));
  return { nodes, edges };
}

/** Copy + paste in one move: clones the picked subgraph with fresh ids/keys at an offset. */
export function duplicateGraphElements(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  ids: ReadonlySet<string>,
  makeId: (prefix: "n" | "e") => string,
  offset: { x: number; y: number },
): FlowClipboard | null {
  const clipboard = copyGraphElements(nodes, edges, ids);
  if (!clipboard) return null;
  return pasteGraphElements(clipboard, new Set(nodes.map((node) => node.key)), makeId, offset);
}
