type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Segment = { kind: "field"; key: string } | { kind: "index"; index: number } | { kind: "all" };
const MISSING = Symbol("missing");

function parsePath(path: string): Segment[] {
  const input = path.trim();
  if (!input.startsWith("value")) throw new Error('Path must begin with "value".');
  const segments: Segment[] = [];
  let cursor = "value".length;

  while (cursor < input.length) {
    if (/^\.\$(?=[.[]|$)/.test(input.slice(cursor))) {
      segments.push({ kind: "all" });
      cursor += 2;
      continue;
    }
    // any key that is not a path separator — Elasticsearch fields like @timestamp count
    const field = input.slice(cursor).match(/^\.([^.[\]]+)/);
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

function project(value: Json, segments: Segment[], optional = false): Json | typeof MISSING {
  const [segment, ...rest] = segments;
  if (!segment) return value;
  if (segment.kind === "all") {
    if (!Array.isArray(value)) throw new Error("$ requires an array value.");
    return value.map((item) => {
      const projected = project(item, rest, true);
      return projected === MISSING ? {} : projected;
    });
  }
  if (segment.kind === "index") {
    if (!Array.isArray(value) || segment.index >= value.length) {
      if (optional) return MISSING;
      throw new Error(`Array item [${segment.index}] does not exist.`);
    }
    return project(value[segment.index], rest, optional);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object" || !(segment.key in value)) {
    if (optional) return MISSING;
    throw new Error(`Field "${segment.key}" does not exist.`);
  }
  const projected = project(value[segment.key], rest, optional);
  return projected === MISSING ? MISSING : { [segment.key]: projected };
}

/** Projects a response using paths such as value.$.a or value[0].a. */
export function normalizeJson(value: Json, path: string): Json {
  const projected = project(value, parsePath(path));
  if (projected === MISSING) throw new Error("Path does not exist.");
  return projected;
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

const PATH_SAFE = /^[^.[\]]+$/;

/** Every path shape the response contains; arrays collapse to `$` so the list stays schema-sized. */
export function collectPaths(value: Json, limit = 500, maxDepth = 8): string[] {
  const out = new Set<string>();
  const walk = (node: Json, path: string, depth: number) => {
    if (out.size >= limit || depth >= maxDepth) return;
    if (Array.isArray(node)) {
      if (node.length === 0) return;
      const next = `${path}.$`;
      out.add(next);
      // ponytail: samples 10 items — enough for heterogeneous arrays, raise if fields go missing
      for (const item of node.slice(0, 10)) walk(item, next, depth + 1);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      if (!PATH_SAFE.test(key)) continue; // not expressible as a path
      const next = `${path}.${key}`;
      out.add(next);
      walk(node[key], next, depth + 1);
    }
  };
  walk(value, "value", 0);
  return [...out];
}

/** Paths matching what has been typed so far; prefix matches rank above substring matches. */
export function rankPaths(paths: string[], draft: string, limit = 8): string[] {
  const query = draft.trim().replace(/^value/, "").toLowerCase();
  if (!query) return paths.slice(0, limit);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const path of paths) {
    const tail = path.slice("value".length).toLowerCase();
    if (tail.startsWith(query)) starts.push(path);
    else if (tail.includes(query)) contains.push(path);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
