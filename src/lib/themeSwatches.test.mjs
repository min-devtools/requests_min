import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { THEMES } from "./themes.ts";
import { parseThemeSwatches, swatchFor } from "./themeSwatches.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("every picker theme resolves to a real swatch from the shipped CSS", async () => {
  const [themesCss, tokensCss] = await Promise.all([read("../styles/themes.css"), read("../styles/tokens.css")]);
  const swatches = parseThemeSwatches(themesCss, tokensCss);
  // defaults come from tokens.css, the rest from themes.css — no hardcoded hexes
  assert.ok(swatches.dark, "default dark swatch from tokens :root");
  assert.ok(swatches.light, "default light swatch from tokens body.light");
  for (const theme of THEMES) {
    const swatch = swatchFor(swatches, theme.id);
    assert.ok(swatch, `missing swatch for "${theme.id}"`);
    for (const [key, value] of Object.entries(swatch)) {
      assert.match(value, /^(#[0-9a-fA-F]{3,8}|rgba?\()/, `${theme.id} ${key} not a color: ${value}`);
    }
  }
});

test("legacy theme ids resolve to their successor's swatch", async () => {
  const [themesCss, tokensCss] = await Promise.all([read("../styles/themes.css"), read("../styles/tokens.css")]);
  const swatches = parseThemeSwatches(themesCss, tokensCss);
  assert.deepEqual(swatchFor(swatches, "default-dark"), swatchFor(swatches, "dark"));
  assert.deepEqual(swatchFor(swatches, "bearded-solarized"), swatchFor(swatches, "bearded-solarized-dark"));
});
