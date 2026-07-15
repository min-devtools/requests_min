import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../", import.meta.url);

test("sidebar nests method-labelled requests inside collapsible collections", async () => {
  const [sidebar, api, layout] = await Promise.all([
    readFile(new URL("components/Sidebar.tsx", src), "utf8"),
    readFile(new URL("lib/api.ts", src), "utf8"),
    readFile(new URL("styles/layout.css", src), "utf8"),
  ]);
  assert.match(sidebar, /collection-requests/);
  assert.match(sidebar, /collapsedCollections/);
  assert.doesNotMatch(sidebar, /return "API"/);
  assert.match(api, /method: string/);
  assert.match(layout, /\.nav-item\.request-node \{[^}]*grid-template-columns: 38px minmax\(0, 1fr\) auto/s);
  assert.match(layout, /\.collection-node > span:nth-child\(2\), \.request-node > span:nth-child\(2\) \{[^}]*min-width: 0;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/s);
  assert.match(sidebar, /kind: "collection", id: c\.id/);
  assert.match(sidebar, /reorderCollections\(from, collectionId\)/);
  assert.match(sidebar, /reorderRequests\(c\.id, from\.relPath, r\.relPath\)/);
  assert.match(sidebar, /dropIndicator/);
  assert.match(sidebar, /drop-prefix/);
  assert.match(layout, /\.drop-prefix::before\s*\{[^}]*content: "\|"/s);
  assert.match(api, /colReorder:/);
  assert.match(api, /reqReorder:/);
});

test("Postman and OpenAPI import read a selected file", async () => {
  const view = await readFile(new URL("components/views/ImportExportView.tsx", src), "utf8");
  assert.match(view, /type="file"/);
  assert.match(view, /await file\.text\(\)/);
  assert.doesNotMatch(view, /Paste collection JSON or OpenAPI JSON\/YAML/);
});
