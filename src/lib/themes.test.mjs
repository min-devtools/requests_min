import assert from "node:assert/strict";
import test from "node:test";
import { THEMES, isThemeId, themeBase } from "./themes.ts";

test("built-in ids resolve and picker labels are unique", () => {
  assert.equal(themeBase("dark"), "dark");
  assert.equal(themeBase("light"), "light");
  const labels = THEMES.map(({ label }) => label);
  assert.equal(new Set(labels).size, labels.length);
});

test("legacy persisted ids stay valid and match their canonical base", () => {
  for (const [legacy, canonical] of [
    ["default-dark", "dark"],
    ["bearded-solarized", "bearded-solarized-dark"],
    ["slate-neutral-dark-schematic", "slate-neutral-dark"],
  ]) {
    assert.ok(isThemeId(legacy), legacy);
    assert.equal(themeBase(legacy), themeBase(canonical));
  }
});
