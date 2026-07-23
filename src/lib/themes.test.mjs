import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("Monaco receives the persisted theme before React mounts", async () => {
  const main = await readFile(new URL("../main.tsx", import.meta.url), "utf8");

  assert.match(main, /retintMonaco\(themeBase\(initialTheme\)\);/);
  assert.ok(main.indexOf("retintMonaco(themeBase(initialTheme));") < main.indexOf("ReactDOM.createRoot"));
});
