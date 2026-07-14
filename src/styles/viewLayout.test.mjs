import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("page views define header/content rows instead of stretching implicit grid rows", async () => {
  const css = await readFile(new URL("requestsmin.css", import.meta.url), "utf8");
  assert.match(css, /\.environments-view,\s*\.ai-import-view\s*\{[^}]*grid-template-rows:\s*auto auto[^}]*align-content:\s*start/s);
  assert.match(css, /\.collections-view\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/s);
});

test("response viewer editor always gets the remaining height, even with no paths row", async () => {
  const css = await readFile(new URL("requestsmin.css", import.meta.url), "utf8");
  const viewer = await readFile(new URL("../ui/JsonResponseViewer.tsx", import.meta.url), "utf8");
  assert.match(css, /\.json-response-viewer\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.json-response-editor\s*\{[^}]*flex:\s*1;\s*min-height:\s*0/s);
  assert.match(viewer, /<div className="json-response-editor">/);
});
