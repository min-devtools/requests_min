// When the user switches gRPC method, we don't want to blow away a payload they
// hand-crafted. Merge the current message onto the new method's input template:
// keep the current value for any field the new method also has (recursing into
// nested messages), drop fields the new method lacks, fill missing ones from the
// template. If the current text isn't valid JSON we can't merge — fall back to the
// fresh template so the editor is at least valid for the new method.

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function mergeValue(current: unknown, template: unknown): unknown {
  // both messages → recurse field by field, template drives the field set
  if (isPlainObject(current) && isPlainObject(template)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(template)) {
      out[key] = key in current ? mergeValue(current[key], template[key]) : template[key];
    }
    return out;
  }
  // scalar/array/type-mismatch → keep what the user typed
  return current;
}

/** Returns pretty-printed JSON for the new method, preserving overlapping user input. */
export function mergeIntoTemplate(currentJson: string, templateJson: string): string {
  let template: unknown;
  try { template = JSON.parse(templateJson); } catch { return currentJson; }
  let current: unknown;
  try { current = JSON.parse(currentJson); } catch { return JSON.stringify(template, null, 2); }
  return JSON.stringify(mergeValue(current, template), null, 2);
}
