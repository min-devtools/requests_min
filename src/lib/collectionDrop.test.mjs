import assert from "node:assert/strict";
import test from "node:test";
import { collectionDropTarget } from "./collectionDrop.ts";

const order = ["alpha", "beta", "gamma", "delta"];

test("collection dragged upward lands before the whole target", () => {
  assert.deepEqual(collectionDropTarget(order, "delta", "beta"), { edge: "before", beforeId: "beta" });
});

test("collection dragged downward lands after the whole target", () => {
  assert.deepEqual(collectionDropTarget(order, "alpha", "gamma"), { edge: "after", beforeId: "delta" });
});

test("collection drop ignores self and missing targets", () => {
  assert.equal(collectionDropTarget(order, "beta", "beta"), null);
  assert.equal(collectionDropTarget(order, "missing", "beta"), null);
});
