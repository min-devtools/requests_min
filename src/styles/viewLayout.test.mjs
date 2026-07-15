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

test("response JSON does not pin parent scopes while scrolling", async () => {
  const viewer = await readFile(new URL("../ui/JsonResponseViewer.tsx", import.meta.url), "utf8");
  assert.match(viewer, /stickyScroll:\s*\{\s*enabled:\s*false\s*\}/);
});

test("stacked response can expand until only the editor tab bar remains", async () => {
  const css = await readFile(new URL("requestsmin.css", import.meta.url), "utf8");
  const resizeHandles = await readFile(new URL("../components/ResizeHandles.tsx", import.meta.url), "utf8");
  assert.match(css, /grid-template-rows:\s*38px 52px minmax\(39px, var\(--request-top\)\) 7px minmax\(170px, 1fr\)/);
  assert.match(resizeHandles, /clamp\(startTop \+ \(e\.clientY - startY\), 39, Math\.max\(39, rect\.height - 86\)\)/);
});

test("history rows have breathing room for request name and URL", async () => {
  const css = await readFile(new URL("views.css", import.meta.url), "utf8");
  const view = await readFile(new URL("../components/views/HistoryView.tsx", import.meta.url), "utf8");
  assert.match(view, /className="history-table"/);
  assert.match(css, /\.history-table td\s*\{[^}]*height:\s*52px;[^}]*padding:\s*8px 12px/s);
});
