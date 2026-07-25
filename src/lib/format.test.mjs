import test from "node:test";
import assert from "node:assert/strict";
import { formatNumber, formatDuration, formatBytes } from "./format.ts";

test("formatNumber formats numbers with locale comma separators", () => {
  assert.equal(formatNumber(1227), "1,227");
  assert.equal(formatNumber(5000), "5,000");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber("10000"), "10,000");
  assert.equal(formatNumber(null), "—");
  assert.equal(formatNumber(undefined), "—");
  assert.equal(formatNumber(""), "—");
});

test("formatDuration formats milliseconds with optional unit spacing", () => {
  assert.equal(formatDuration(1227), "1,227ms");
  assert.equal(formatDuration(1227, true), "1,227 ms");
  assert.equal(formatDuration(5000), "5,000ms");
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(undefined), "—");
});

test("formatBytes formats byte sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(null), "0 B");
});
