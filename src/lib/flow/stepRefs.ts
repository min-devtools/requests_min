import type { KV, Request } from "../api";
import type { Flow, FlowRun } from "./types";
import { isRequestNode } from "./types.ts";
import { isStepKey } from "./validate.ts";

export interface StepRefCtx {
  steps: Record<string, unknown>;
  vars: Record<string, unknown>;
}

type KVRecord = Record<string, string | string[]>;

const kvRecord = (kvs: KV[]): KVRecord => {
  const record = Object.create(null) as KVRecord;
  for (const kv of kvs) {
    const key = kv.key.toLowerCase();
    const current = record[key];
    if (current === undefined) record[key] = kv.value;
    else if (Array.isArray(current)) current.push(kv.value);
    else record[key] = [current, kv.value];
  }
  return record;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isKvArray = (value: unknown): value is KV[] =>
  Array.isArray(value)
  && value.every((entry) =>
    isRecord(entry)
    && typeof entry.key === "string"
    && typeof entry.value === "string"
  );

const tryParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const invalidResponse = (stepKey: string): never => {
  throw new Error(`Step "${stepKey}": Invalid response shape`);
};

const normalizeResponse = (rawResponse: unknown, stepKey: string): unknown => {
  if (rawResponse === undefined) return undefined;
  if (!isRecord(rawResponse)) return invalidResponse(stepKey);

  if (
    typeof rawResponse.status === "number"
    && Number.isFinite(rawResponse.status)
    && isKvArray(rawResponse.headers)
    && typeof rawResponse.body === "string"
    && typeof rawResponse.timeMs === "number"
    && Number.isFinite(rawResponse.timeMs)
    && typeof rawResponse.sizeBytes === "number"
    && Number.isFinite(rawResponse.sizeBytes)
  ) {
    return {
      status: rawResponse.status,
      headers: kvRecord(rawResponse.headers),
      body: tryParse(rawResponse.body),
      bodyText: rawResponse.body,
      timeMs: rawResponse.timeMs,
    };
  }

  if (
    typeof rawResponse.statusCode === "string"
    && isKvArray(rawResponse.headers)
    && isKvArray(rawResponse.trailers)
    && typeof rawResponse.bodyJson === "string"
    && typeof rawResponse.timeMs === "number"
    && Number.isFinite(rawResponse.timeMs)
  ) {
    return {
      status: rawResponse.statusCode,
      headers: kvRecord(rawResponse.headers),
      trailers: kvRecord(rawResponse.trailers),
      body: tryParse(rawResponse.bodyJson),
      bodyText: rawResponse.bodyJson,
      timeMs: rawResponse.timeMs,
    };
  }

  return invalidResponse(stepKey);
};

const hasSerializableValues = (value: unknown, ancestors: Set<object>): boolean => {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    return Object.values(value).every((entry) => hasSerializableValues(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
};

const serializeRef = (value: unknown, token: string, ref: string): string => {
  try {
    if (!hasSerializableValues(value, new Set())) throw new Error("unsupported");
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("unsupported");
    return serialized;
  } catch {
    throw new Error(`Cannot serialize ${token}: reference "${ref}" is not JSON-serializable`);
  }
};

export function buildStepCtx(flow: Flow, run: FlowRun): StepRefCtx {
  const steps = Object.create(null) as Record<string, unknown>;

  for (const node of flow.nodes) {
    const result = run.steps[node.id];
    if (!result || result.status !== "success" || result.stale) continue;
    if (isRequestNode(node)) {
      if (!isStepKey(node.key)) throw new Error(`Invalid step key "${node.key}" on node "${node.id}"`);
      steps[node.key] = {
        request: result.resolvedRequest,
        response: normalizeResponse(result.response, node.key),
      };
    } else if (node.type === "transform") {
      if (!isStepKey(node.key)) throw new Error(`Invalid step key "${node.key}" on node "${node.id}"`);
      // the return value is exposed directly: {{steps.<key>.field}} and the next transform's `value`
      steps[node.key] = result.output;
    }
  }

  return { steps, vars: {} };
}

export function resolvePath(root: unknown, path: string): unknown {
  let current = root;

  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function substituteRefs(text: string, ctx: StepRefCtx): string {
  return text.replace(
    /\{\{\s*((?:steps|vars)\.[^{}]+?)\s*\}\}/g,
    (token: string, ref: string) => {
      const value = resolvePath(ctx, ref);
      if (value === undefined) {
        throw new Error(`Cannot resolve ${token}: the step has not run yet or the path is wrong`);
      }
      return typeof value === "string" ? value : serializeRef(value, token, ref);
    },
  );
}

export function substituteRequest(request: Request, ctx: StepRefCtx): Request {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return substituteRefs(value, ctx);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, walk(entry)]),
      );
    }
    return value;
  };

  return walk(structuredClone(request)) as Request;
}
