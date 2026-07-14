import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../", import.meta.url);

test("sidebar nests method-labelled requests inside collapsible collections", async () => {
  const [sidebar, api] = await Promise.all([
    readFile(new URL("components/Sidebar.tsx", src), "utf8"),
    readFile(new URL("lib/api.ts", src), "utf8"),
  ]);
  assert.match(sidebar, /collection-requests/);
  assert.match(sidebar, /collapsedCollections/);
  assert.doesNotMatch(sidebar, /return "API"/);
  assert.match(api, /method: string/);
});

test("Postman and OpenAPI import read a selected file", async () => {
  const view = await readFile(new URL("components/views/ImportExportView.tsx", src), "utf8");
  assert.match(view, /type="file"/);
  assert.match(view, /await file\.text\(\)/);
  assert.doesNotMatch(view, /Paste collection JSON or OpenAPI JSON\/YAML/);
});
