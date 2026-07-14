import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("REST and gRPC JSON inputs use the shared Monaco editor", async () => {
  const [view, editor, pkg] = await Promise.all([
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("ui/JsonEditor.tsx", root), "utf8"),
    readFile(new URL("../package.json", root), "utf8"),
  ]);

  assert.match(view, /import \{ JsonEditor \}/);
  assert.equal((view.match(/<JsonEditor/g) ?? []).length, 2);
  assert.doesNotMatch(view, /className="json-editor"/);
  assert.match(editor, /language=\{language\}/);
  assert.match(editor, /language = "json"/);
  assert.match(editor, /automaticLayout: true/);
  assert.ok(JSON.parse(pkg).dependencies["@monaco-editor/react"]);
});
