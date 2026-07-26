import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DYNAMIC_VARIABLES, dynamicVariable, isDynamicName } from "./dynamicVariables.ts";

test("every catalog entry is a complete, $-prefixed, unique definition", () => {
  const names = DYNAMIC_VARIABLES.map((v) => v.name);
  assert.equal(new Set(names).size, names.length, "duplicate names");
  for (const v of DYNAMIC_VARIABLES) {
    assert.match(v.name, /^\$[a-zA-Z][a-zA-Z0-9]*$/, v.name);
    assert.ok(v.description.length > 0, `${v.name} missing description`);
    assert.ok(v.example.length > 0, `${v.name} missing example`);
  }
});

test("isDynamicName / dynamicVariable answer by $ prefix and catalog membership", () => {
  assert.equal(isDynamicName("$uuid"), true);
  assert.equal(isDynamicName("baseUrl"), false);
  assert.equal(dynamicVariable("$uuid")?.description, "Random UUID v4");
  assert.equal(dynamicVariable("$nope"), undefined);
});

test("frontend catalog stays in sync with the Rust registry (src-tauri/src/dynamic.rs)", async () => {
  const rust = await readFile(new URL("../../src-tauri/src/dynamic.rs", import.meta.url), "utf8");
  const rustNames = new Set();
  // only the registry itself — the Rust test module repeats names in asserts
  for (const line of rust.split("#[cfg(test)]")[0].split("\n")) {
    const arrow = line.indexOf("=>");
    if (arrow === -1) continue;
    for (const m of line.slice(0, arrow).matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)) rustNames.add(m[1]);
  }
  const tsNames = new Set(DYNAMIC_VARIABLES.map((v) => v.name.slice(1)));
  assert.ok(rustNames.size >= 25, `suspiciously few Rust match arms parsed: ${rustNames.size}`);
  assert.deepEqual([...tsNames].sort(), [...rustNames].sort());
});
