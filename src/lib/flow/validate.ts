import { isRequestNode, MAX_LOOP_COUNT } from "./types.ts";
import type { Flow, FlowEdge, FlowNode } from "./types.ts";

export interface FlowIssue {
  level: "error" | "warn";
  message: string;
  nodeId?: string;
}

const duplicateValues = (values: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
};

const isValidDelayConfig = (config: unknown): boolean => {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return false;
  const ms = (config as Record<string, unknown>).ms;
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0;
};

const isValidTransformConfig = (config: unknown): boolean => {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return false;
  return typeof (config as Record<string, unknown>).code === "string";
};

const isValidLoopConfig = (config: unknown): boolean => {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return false;
  const count = (config as Record<string, unknown>).count;
  return typeof count === "number"
    && Number.isInteger(count)
    && count >= 1
    && count <= MAX_LOOP_COUNT;
};

const STEP_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isStepKey = (key: unknown): key is string =>
  typeof key === "string" && STEP_KEY_PATTERN.test(key);

const reachesViaEdges = (edges: readonly FlowEdge[], from: string, to: string): boolean => {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const seen = new Set<string>([from]);
  const pending = [from];
  while (pending.length > 0) {
    const id = pending.pop()!;
    for (const next of outgoing.get(id) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return false;
};

/** Structural subset of Flow that graph walkers need (lets canvas helpers reuse them). */
export type FlowGraph = { nodes: readonly FlowNode[]; edges: readonly FlowEdge[] };

/**
 * Loop back-edges per loop node: an outgoing edge L→T counts as a back-edge when T can
 * still reach L without that edge — i.e. the edge closes a circle body…→L→T(→body).
 */
export function loopBackEdgeMap(graph: FlowGraph): Map<string, { edgeId: string; targetId: string }[]> {
  const map = new Map<string, { edgeId: string; targetId: string }[]>();
  for (const node of graph.nodes) {
    if (node.type !== "loop") continue;
    const backs: { edgeId: string; targetId: string }[] = [];
    for (const edge of graph.edges) {
      if (edge.source !== node.id) continue;
      const rest = graph.edges.filter((candidate) => candidate.id !== edge.id);
      if (reachesViaEdges(rest, edge.target, node.id)) {
        backs.push({ edgeId: edge.id, targetId: edge.target });
      }
    }
    map.set(node.id, backs);
  }
  return map;
}

/** Graph edges minus loop back-edges — the acyclic graph the scheduler and validators walk. */
export function dagEdges(graph: FlowGraph): FlowEdge[] {
  const backEdgeIds = new Set<string>();
  for (const backs of loopBackEdgeMap(graph).values()) {
    for (const back of backs) backEdgeIds.add(back.edgeId);
  }
  return graph.edges.filter((edge) => !backEdgeIds.has(edge.id));
}

/**
 * Topo-ordered body of a loop: the back-edge target plus every node that is both reachable
 * from it and able to reach the loop — the segment the loop re-runs count-1 extra times.
 */
export function loopBodyNodes(graph: FlowGraph, loopId: string): string[] {
  const target = loopBackEdgeMap(graph).get(loopId)?.[0]?.targetId;
  if (target === undefined) return [];
  const edges = dagEdges(graph);

  const descendants = new Set<string>([target]);
  const forward = [target];
  while (forward.length > 0) {
    const id = forward.pop()!;
    for (const edge of edges) {
      if (edge.source !== id || descendants.has(edge.target)) continue;
      descendants.add(edge.target);
      forward.push(edge.target);
    }
  }

  const ancestors = new Set<string>();
  const backward = [loopId];
  while (backward.length > 0) {
    const id = backward.pop()!;
    for (const edge of edges) {
      if (edge.target !== id || ancestors.has(edge.source)) continue;
      ancestors.add(edge.source);
      backward.push(edge.source);
    }
  }

  const body = new Set([...descendants].filter((id) => ancestors.has(id)));
  const order = topoOrder(graph.nodes, edges);
  if (!order) return [];
  return order.filter((id) => body.has(id));
}

/** Kahn topological sort with a queue seeded in input-node order. */
export function topoOrder(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
): string[] | null {
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) return null;
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const queue = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const nextIndegree = indegree.get(next)! - 1;
      indegree.set(next, nextIndegree);
      if (nextIndegree === 0) queue.push(next);
    }
  }

  return order.length === nodes.length ? order : null;
}

export function validateFlow(flow: Flow): FlowIssue[] {
  const issues: FlowIssue[] = [];

  if (flow.nodes.length === 0) {
    issues.push({ level: "error", message: "Flow has no nodes" });
  }

  const duplicateNodeIds = duplicateValues(flow.nodes.map((node) => node.id));
  for (const id of duplicateNodeIds) {
    issues.push({ level: "error", message: `Duplicate node id "${id}"` });
  }
  // Cycles are only legal through a loop step's back-edge; everything else still deadlocks.
  const graphEdges = dagEdges(flow);
  if (
    flow.nodes.length > 0
    && duplicateNodeIds.length === 0
    && topoOrder(flow.nodes, graphEdges) === null
  ) {
    issues.push({ level: "error", message: "Flow has a cycle" });
  }

  const loopBacks = loopBackEdgeMap(flow);
  for (const node of flow.nodes) {
    if (node.type !== "loop") continue;
    const backs = loopBacks.get(node.id) ?? [];
    if (backs.length === 0) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `Step "${node.key}": Loop needs a connection from it back to an earlier step`,
      });
    } else if (backs.length > 1) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `Step "${node.key}": Loop has multiple loop-back connections; keep exactly one`,
      });
    } else if (loopBodyNodes(flow, node.id).length === 0) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `Step "${node.key}": Loop body is empty`,
      });
    }
    // Note: genuinely nested loops always surface above as "multiple loop-back connections" —
    // a loop inside another loop's re-run segment necessarily closes a second circle.
  }

  const keyCounts = new Map<string, number>();
  for (const node of flow.nodes) {
    keyCounts.set(node.key, (keyCounts.get(node.key) ?? 0) + 1);
  }
  for (const [key, count] of keyCounts) {
    if (count > 1) {
      issues.push({ level: "error", message: `Duplicate step key "${key}"` });
    }
  }
  for (const node of flow.nodes) {
    if (!isStepKey(node.key)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `Step "${node.key}": Invalid step key; expected ^[a-z0-9]+(?:-[a-z0-9]+)*$`,
      });
    }
  }

  for (const id of duplicateValues(flow.edges.map((edge) => edge.id))) {
    issues.push({ level: "error", message: `Duplicate edge id "${id}"` });
  }

  const connections = new Map<string, { edge: FlowEdge; count: number }>();
  for (const edge of flow.edges) {
    const connectionKey = JSON.stringify([edge.source, edge.target, edge.sourceHandle ?? null, edge.targetHandle ?? null]);
    const existing = connections.get(connectionKey);
    if (existing) existing.count += 1;
    else connections.set(connectionKey, { edge, count: 1 });
  }
  for (const { edge, count } of connections.values()) {
    if (count < 2) continue;
    const handle = edge.sourceHandle === undefined
      ? ""
      : ` using source handle "${edge.sourceHandle}"`;
    issues.push({
      level: "error",
      message: `Duplicate edge connection "${edge.source}" -> "${edge.target}"${handle}`,
    });
  }

  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  const validEdges: FlowEdge[] = [];
  for (const edge of flow.edges) {
    const missingEndpoints: string[] = [];
    if (!nodeIds.has(edge.source)) missingEndpoints.push(`source node "${edge.source}"`);
    if (!nodeIds.has(edge.target)) missingEndpoints.push(`target node "${edge.target}"`);
    if (missingEndpoints.length > 0) {
      issues.push({
        level: "error",
        message: `Edge "${edge.id}" references missing ${missingEndpoints.join(" and ")}`,
      });
    } else {
      validEdges.push(edge);
    }
  }

  for (const node of flow.nodes) {
    if (node.type === "request") {
      const runtimeNode: unknown = node;
      if (!isRequestNode(runtimeNode)) {
        issues.push({
          level: "error",
          nodeId: node.id,
          message: `Step "${node.key}": Invalid request configuration`,
        });
      } else if (runtimeNode.config.request.protocol === "ws") {
        issues.push({
          level: "error",
          nodeId: node.id,
          message: `Step "${node.key}": WebSocket requests are not supported in flows`,
        });
      }
    } else if (node.type === "delay" && !isValidDelayConfig(node.config)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `Step "${node.key}": Invalid delay configuration`,
      });
    } else if (node.type === "loop" && !isValidLoopConfig(node.config)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `Step "${node.key}": Invalid loop configuration; count must be a whole number from 1 to ${MAX_LOOP_COUNT}`,
      });
    } else if (node.type === "transform" && !isValidTransformConfig(node.config)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `Step "${node.key}": Invalid transform configuration`,
      });
    }
  }

  if (flow.nodes.length > 1) {
    const linkedNodeIds = new Set(validEdges.flatMap((edge) => [edge.source, edge.target]));
    for (const node of flow.nodes) {
      if (!linkedNodeIds.has(node.id)) {
        issues.push({
          level: "warn",
          nodeId: node.id,
          message: `Step "${node.key}" is not connected`,
        });
      }
    }
  }

  return issues;
}

/** Creates a lowercase ASCII step key, suffixing collisions with -2, -3, and so on. */
export function stepKeyFor(name: string, taken: ReadonlySet<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "step";
  let key = base;
  for (let suffix = 2; taken.has(key); suffix += 1) {
    key = `${base}-${suffix}`;
  }
  return key;
}
