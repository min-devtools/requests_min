type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Segment = { kind: "field"; key: string } | { kind: "index"; index: number } | { kind: "all" };

function parsePath(path: string): Segment[] {
  const input = path.trim();
  if (!input.startsWith("value")) throw new Error('Path must begin with "value".');
  const segments: Segment[] = [];
  let cursor = "value".length;

  while (cursor < input.length) {
    if (input.startsWith(".$", cursor)) {
      segments.push({ kind: "all" });
      cursor += 2;
      continue;
    }
    const field = input.slice(cursor).match(/^\.([A-Za-z_$][\w$-]*)/);
    if (field) {
      segments.push({ kind: "field", key: field[1] });
      cursor += field[0].length;
      continue;
    }
    const index = input.slice(cursor).match(/^\[(\d+)\]/);
    if (index) {
      segments.push({ kind: "index", index: Number(index[1]) });
      cursor += index[0].length;
      continue;
    }
    throw new Error(`Invalid JSON path near "${input.slice(cursor)}".`);
  }
  return segments;
}

function project(value: Json, segments: Segment[]): Json {
  const [segment, ...rest] = segments;
  if (!segment) return value;
  if (segment.kind === "all") {
    if (!Array.isArray(value)) throw new Error("$ requires an array value.");
    return value.map((item) => project(item, rest));
  }
  if (segment.kind === "index") {
    if (!Array.isArray(value) || segment.index >= value.length) throw new Error(`Array item [${segment.index}] does not exist.`);
    return project(value[segment.index], rest);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object" || !(segment.key in value)) {
    throw new Error(`Field "${segment.key}" does not exist.`);
  }
  return { [segment.key]: project(value[segment.key], rest) };
}

/** Projects a response using paths such as value.$.a or value[0].a. */
export function normalizeJson(value: Json, path: string): Json {
  return project(value, parsePath(path));
}

const isObject = (v: Json): v is { [key: string]: Json } =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Deep-merges two projections; on conflict the first value wins. */
export function mergeJson(first: Json, second: Json): Json {
  if (Array.isArray(first) && Array.isArray(second)) {
    return Array.from({ length: Math.max(first.length, second.length) }, (_, i) =>
      i >= first.length ? second[i] : i >= second.length ? first[i] : mergeJson(first[i], second[i]));
  }
  if (isObject(first) && isObject(second)) {
    const out: { [key: string]: Json } = { ...first };
    for (const key of Object.keys(second)) out[key] = key in first ? mergeJson(first[key], second[key]) : second[key];
    return out;
  }
  return first;
}

/** Projects each path and merges the results in order; earlier paths win conflicts. */
export function normalizeJsonMany(value: Json, paths: string[]): Json {
  return paths.map((path) => normalizeJson(value, path)).reduce((acc, cur) => mergeJson(acc, cur));
}
