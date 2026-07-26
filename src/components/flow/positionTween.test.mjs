import assert from "node:assert/strict";
import test from "node:test";

import { easeOutCubic, lerpTargets } from "./positionTween.ts";

test("easeOutCubic anchors 0→0 and 1→1 and decelerates", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5); // ease-out is ahead of linear mid-flight
});

test("lerpTargets interpolates eased positions and clamps progress", () => {
  const targets = [{ id: "a", from: { x: 0, y: 0 }, to: { x: 100, y: -100 } }];
  assert.deepEqual(lerpTargets(targets, 0).get("a"), { x: 0, y: 0 });
  assert.deepEqual(lerpTargets(targets, 1).get("a"), { x: 100, y: -100 });
  assert.deepEqual(lerpTargets(targets, 5).get("a"), { x: 100, y: -100 });
  const mid = lerpTargets(targets, 0.5).get("a");
  assert.ok(mid.x > 50 && mid.x < 100);
  assert.equal(mid.y, -mid.x);
});
