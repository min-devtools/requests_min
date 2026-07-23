import { isRequestNode } from "./types.ts";
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

const STEP_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isStepKey = (key: unknown): key is string =>
  typeof key === "string" && STEP_KEY_PATTERN.test(key);

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
  if (
    flow.nodes.length > 0
    && duplicateNodeIds.length === 0
    && topoOrder(flow.nodes, flow.edges) === null
  ) {
    issues.push({ level: "error", message: "Flow has a cycle" });
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
    const connectionKey = JSON.stringify([edge.source, edge.target, edge.sourceHandle ?? null]);
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
