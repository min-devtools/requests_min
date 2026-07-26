import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("EnvInput suggests dynamic variables only once something is typed after {{", async () => {
  const input = await readFile(new URL("ui/EnvInput.tsx", root), "utf8");

  assert.match(input, /DYNAMIC_VARIABLES/);
  // bare "{{" keeps the dropdown to the environment's own variables
  assert.match(input, /query === "" \? \[\] : DYNAMIC_VARIABLES\.filter/);
  // dynamic entries carry their description + example as a tooltip
  assert.match(input, /title=\{dynamicVariable\(name\)/);
});

test("JsonEditor completion offers dynamic variables below env vars with docs", async () => {
  const editor = await readFile(new URL("ui/JsonEditor.tsx", root), "utf8");

  assert.match(editor, /DYNAMIC_VARIABLES\.map\(\(v\) => \(\{ label: v\.name/);
  assert.match(editor, /sortText: `~\$\{v\.name\}`/);
  assert.match(editor, /documentation: v\.description/);
  assert.match(editor, /insertText: `\{\{\$\{v\.name\}\}\}`/);
});

test("Inspector shows known $ variables as Auto and typo'd ones as unresolved", async () => {
  const inspector = await readFile(new URL("components/Inspector.tsx", root), "utf8");

  assert.match(inspector, /isDynamicName\(name\)\s*\? !dynamicVariable\(name\)/);
  assert.match(inspector, /\{known \? "Auto" : "Missing"\}/);
  assert.match(inspector, /Unknown dynamic variable/);
});

test("Rust interpolate routes $ names to the dynamic registry, never to env/secrets", async () => {
  const collection = await readFile(new URL("../../src-tauri/src/collection.rs", import.meta.url), "utf8");

  assert.match(collection, /name\.strip_prefix\('\$'\)/);
  assert.match(collection, /dynamic::dynamic_value/);
  assert.match(collection, /unknown dynamic variable/);
});
