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
  assert.match(editor, /wordWrap: wordWrap \? "on" : "off"/);
  assert.match(editor, /name="wrap"/);
  assert.ok(JSON.parse(pkg).dependencies["@monaco-editor/react"]);
});

test("Icon.tsx maps wrap icon", async () => {
  const iconFile = await readFile(new URL("ui/Icon.tsx", root), "utf8");
  assert.match(iconFile, /WrapText/);
  assert.match(iconFile, /wrap:\s*WrapText/);
});

test("JsonEditor paints template-aware JSON diagnostics itself (worker squiggles stay off)", async () => {
  const [editor, monacoLib] = await Promise.all([
    readFile(new URL("ui/JsonEditor.tsx", root), "utf8"),
    readFile(new URL("lib/monaco.ts", root), "utf8"),
  ]);
  assert.match(editor, /diagnoseJsonWithTemplates/);
  assert.match(editor, /setModelMarkers\(model, "json-template"/);
  assert.match(editor, /MarkerSeverity\.Error/);
  // no post-hoc worker marker filtering — the worker never validates ({{var}} cascades false errors)
  assert.doesNotMatch(editor, /onDidChangeMarkers/);
  assert.match(monacoLib, /validate: false/);
});

