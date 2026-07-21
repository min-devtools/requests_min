import assert from "node:assert/strict";
import test from "node:test";
import { mergeIntoTemplate } from "./protoMerge.ts";

test("keeps overlapping field, drops extra, adds missing", () => {
  const current = JSON.stringify({ name: "min", extra: "gone" });
  const template = JSON.stringify({ name: "", age: 0 });
  assert.deepEqual(JSON.parse(mergeIntoTemplate(current, template)), { name: "min", age: 0 });
});

test("recurses into nested messages", () => {
  const current = JSON.stringify({ user: { id: 7, stale: 1 } });
  const template = JSON.stringify({ user: { id: 0, role: "" } });
  assert.deepEqual(JSON.parse(mergeIntoTemplate(current, template)), { user: { id: 7, role: "" } });
});

test("invalid current JSON → fresh template", () => {
  assert.equal(mergeIntoTemplate("{not json", JSON.stringify({ a: 1 })), JSON.stringify({ a: 1 }, null, 2));
});

test("invalid template → returns current untouched", () => {
  assert.equal(mergeIntoTemplate('{"a":1}', "nope"), '{"a":1}');
});
