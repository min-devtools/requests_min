import assert from "node:assert/strict";
import test from "node:test";
import { changeFontSize, clampFontSize } from "./fontScale.ts";

test("changes interface font size in 0.5px steps", () => {
  assert.equal(changeFontSize(13, 1), 13.5);
  assert.equal(changeFontSize(13, -1), 12.5);
});

test("clamps interface font size to 10px through 20px", () => {
  assert.equal(clampFontSize(9), 10);
  assert.equal(clampFontSize(21), 20);
  assert.equal(changeFontSize(20, 1), 20);
  assert.equal(changeFontSize(10, -1), 10);
});

test("font families are represented by CSS variable values", async () => {
  const { readFile } = await import("node:fs/promises");
  const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
  const base = await readFile(new URL("../styles/base.css", import.meta.url), "utf8");

  assert.match(tokens, /--font-body-default/);
  assert.match(tokens, /--font-mono-default/);
  assert.match(base, /font: 450 1rem\/1\.45 var\(--font-body\)/);
});
