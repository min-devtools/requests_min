import assert from "node:assert/strict";
import test from "node:test";
import { collectPaths, mergeJson, normalizeJson, normalizeJsonMany, rankPaths } from "./normalizeJson.ts";

const response = [
  { q: "One loses many laughs by not laughing at oneself.", a: "Mary Engelbreit", c: 49, h: "<blockquote>…</blockquote>" },
  { q: "It is not because things are difficult that we do not dare…", a: "Seneca", c: 115, h: "<blockquote>…</blockquote>" },
];

test("value.$.a projects the field across every array item", () => {
  assert.deepEqual(normalizeJson(response, "value.$.a"), [{ a: "Mary Engelbreit" }, { a: "Seneca" }]);
});

test("array projections keep item positions and omit missing nested branches", () => {
  const uneven = [
    { user: { profile: { name: "Ada" } }, id: 1 },
    { user: { profile: {} }, id: 2 },
    { id: 3 },
  ];

  assert.deepEqual(normalizeJson(uneven, "value.$.user.profile.name"), [
    { user: { profile: { name: "Ada" } } },
    {},
    {},
  ]);
});

test("value[0].a projects only the first item", () => {
  assert.deepEqual(normalizeJson(response, "value[0].a"), { a: "Mary Engelbreit" });
});

test("multiple paths combine into one projection", () => {
  assert.deepEqual(normalizeJsonMany(response, ["value.$.a", "value.$.c"]),
    [{ a: "Mary Engelbreit", c: 49 }, { a: "Seneca", c: 115 }]);
  assert.deepEqual(normalizeJsonMany(response, ["value.$.a", "value[0].q"]),
    [{ a: "Mary Engelbreit" }, { a: "Seneca" }]);
});

test("merge conflicts keep the value from the earlier path", () => {
  assert.deepEqual(mergeJson({ a: 1, b: { x: 1 } }, { a: 2, b: { y: 2 }, c: 3 }), { a: 1, b: { x: 1, y: 2 }, c: 3 });
  assert.deepEqual(mergeJson([{ a: 1 }], [{ a: 9, b: 2 }, { c: 3 }]), [{ a: 1, b: 2 }, { c: 3 }]);
  assert.equal(mergeJson("first", "second"), "first");
});

test("suggestions list every path shape, arrays collapsed to $", () => {
  assert.deepEqual(collectPaths({ hits: { hits: [{ _source: { name: "a" } }, { _source: { age: 1 } } ] } }), [
    "value.hits",
    "value.hits.hits",
    "value.hits.hits.$",
    "value.hits.hits.$._source",
    "value.hits.hits.$._source.name",
    "value.hits.hits.$._source.age",
  ]);
  assert.deepEqual(collectPaths({ "a.b": 1, ok: 2 }), ["value.ok"]); // dotted keys are not expressible
});

test("suggestions rank prefix matches first and accept unprefixed drafts", () => {
  const paths = collectPaths({ name: 1, meta: { name: 2 } });
  assert.deepEqual(rankPaths(paths, "value.name"), ["value.name", "value.meta.name"]);
  assert.deepEqual(rankPaths(paths, "name"), ["value.name", "value.meta.name"]);
  assert.deepEqual(rankPaths(paths, "value.meta."), ["value.meta.name"]);
  assert.deepEqual(rankPaths(paths, ""), paths);
  assert.deepEqual(rankPaths(paths, "zzz"), []);
});

test("keys outside the identifier charset still project", () => {
  assert.deepEqual(normalizeJson({ "@timestamp": "now" }, "value.@timestamp"), { "@timestamp": "now" });
});

test("nested paths and errors behave", () => {
  assert.deepEqual(normalizeJson({ data: { items: [{ id: 1 }, { id: 2 }] } }, "value.data.items.$.id"), { data: { items: [{ id: 1 }, { id: 2 }] } });
  assert.throws(() => normalizeJson(response, "items.$.a"), /must begin with "value"/);
  assert.deepEqual(normalizeJson(response, "value.$.missing"), [{}, {}]);
  assert.throws(() => normalizeJson({ a: 1 }, "value.$"), /requires an array/);
});
