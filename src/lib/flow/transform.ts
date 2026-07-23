import { buildStepCtx, resolvePath, type StepRefCtx } from "./stepRefs.ts";
import type { Flow, FlowNode, FlowRun } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Placeholder parent key baked into the default template; TransformPanel swaps it for the
// real wired-in step's ref once one exists. Not a valid step key, so it never resolves by accident.
export const TRANSFORM_PLACEHOLDER = "{{steps.__parent__.response}}";

export const DEFAULT_TRANSFORM_CODE = `// value = the wired-in step's data. Rename \`value\` if you like — the rest follows it.
const value = ${TRANSFORM_PLACEHOLDER}

return {}
`;

/** The {{steps.*}} ref the default template should point at, based on the single wired-in parent. */
export function parentStepRef(flow: Flow, nodeId: string): string | null {
  const parents = flow.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => flow.nodes.find((node) => node.id === edge.source))
    .filter((node): node is FlowNode => Boolean(node));
  if (parents.length !== 1) return null;
  const parent = parents[0];
  if (parent.type === "request") return `{{steps.${parent.key}.response}}`;
  if (parent.type === "transform") return `{{steps.${parent.key}}}`;
  return null; // delay steps carry no data
}

// A parent's data shown in the panel's "wired input" preview:
//  request → parsed response body, transform → its output, delay → undefined.
const parentData = (flow: Flow, steps: Record<string, unknown>, parentId: string): unknown => {
  const parent = flow.nodes.find((node) => node.id === parentId);
  if (!parent) return undefined;
  const entry = steps[parent.key];
  if (parent.type === "request") {
    return isRecord(entry) && isRecord(entry.response) ? entry.response.body : undefined;
  }
  if (parent.type === "transform") return entry;
  return undefined;
};

/** Preview of the wired-in data (single parent → its data; many → keyed by step key). */
export function transformInput(flow: Flow, run: FlowRun, nodeId: string): unknown {
  const { steps } = buildStepCtx(flow, run);
  const parents = flow.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => flow.nodes.find((node) => node.id === edge.source))
    .filter((node): node is FlowNode => Boolean(node));

  if (parents.length === 1) return parentData(flow, steps, parents[0].id);

  const value: Record<string, unknown> = {};
  for (const parent of parents) value[parent.key] = parentData(flow, steps, parent.id);
  return value;
}

const REF = /\{\{\s*((?:steps|vars)\.[^{}]+?)\s*\}\}/g;

// Inline every {{steps.*}}/{{vars.*}} ref as a JSON literal so the code is runnable JS.
// Unlike request substitution, strings are JSON-quoted (so `const x = {{…name}}` is valid).
const inlineRefs = (code: string, ctx: StepRefCtx): string =>
  code.replace(REF, (token, ref: string) => {
    const value = resolvePath(ctx, ref);
    if (value === undefined) {
      throw new Error(`Cannot resolve ${token}: the step has not run yet or the path is wrong`);
    }
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      json = undefined; // circular structure
    }
    if (json === undefined) throw new Error(`Cannot serialize ${token} as JSON`);
    return json;
  });

/**
 * Run a transform's JS body. Refs like {{steps.<key>.response}} are inlined as JSON first, then
 * the body runs and its `return` is the output.
 * ponytail: new Function runs the user's own script on their own machine (CSP is null) — same trust
 * model as Postman pre-request scripts; no extra sandbox until one is asked for.
 */
export function runTransformCode(code: string, ctx: StepRefCtx): unknown {
  const fn = new Function(`"use strict";\n${inlineRefs(code, ctx)}`);
  const output = fn();
  // Non-cloneable output (function, promise, class instance) would blow up structuredClone deep in
  // the run loop and strand the tab in "running" — surface it as this step's failure instead.
  try {
    return structuredClone(output);
  } catch {
    throw new Error("Transform must return plain JSON data (no functions or promises)");
  }
}
