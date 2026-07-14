import assert from "node:assert/strict";
import test from "node:test";
import { mergeJson, normalizeJson, normalizeJsonMany } from "./normalizeJson.ts";

const response = [
  { q: "One loses many laughs by not laughing at oneself.", a: "Mary Engelbreit", c: 49, h: "<blockquote>…</blockquote>" },
  { q: "It is not because things are difficult that we do not dare…", a: "Seneca", c: 115, h: "<blockquote>…</blockquote>" },
];

test("value.$.a projects the field across every array item", () => {
  assert.deepEqual(normalizeJson(response, "value.$.a"), [{ a: "Mary Engelbreit" }, { a: "Seneca" }]);
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

test("nested paths and errors behave", () => {
  assert.deepEqual(normalizeJson({ data: { items: [{ id: 1 }, { id: 2 }] } }, "value.data.items.$.id"), { data: { items: [{ id: 1 }, { id: 2 }] } });
  assert.throws(() => normalizeJson(response, "items.$.a"), /must begin with "value"/);
  assert.throws(() => normalizeJson(response, "value.$.missing"), /does not exist/);
  assert.throws(() => normalizeJson({ a: 1 }, "value.$"), /requires an array/);
});
