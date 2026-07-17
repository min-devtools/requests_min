import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("AI import can pick a folder and scan its selected path", async () => {
  const view = await readFile(new URL("components/views/AiImportView.tsx", root), "utf8");

  assert.match(view, /import \{ open \} from "@tauri-apps\/plugin-dialog"/);
  assert.match(view, /open\(\{\s*directory: true,\s*multiple: false/);
  assert.match(view, /setDir\(selectedDir\)/);
  assert.match(view, /scanPath\(selectedDir\)/);
  assert.match(view, />Choose folder</);
});

test("AI generation contract includes module names, payload examples, and batching", async () => {
  const source = await readFile(new URL("../src-tauri/src/ai.rs", root), "utf8");

  assert.match(source, /\[Module\] Action/);
  assert.match(source, /example JSON body/);
  assert.match(source, /source_batches/);
  assert.match(source, /enumerate\(\)/);
  assert.match(source, /merge_drafts/);
});

test("collection request sort toggles direction and refreshes the left dock", async () => {
  const view = await readFile(new URL("components/views/CollectionsView.tsx", root), "utf8");

  assert.match(view, /const \[sortDirection, setSortDirection\] = useState<"asc" \| "desc">\("desc"\)/);
  assert.match(view, /sortRequests\(sortDirection === "desc" \? "asc" : "desc"\)/);
  assert.match(view, /localeCompare\(b\.name/);
  assert.match(view, /api\.reqReorder\(collection\.id, order\)/);
  assert.match(view, /bumpReqList\(collection\.id\)/);
  assert.match(view, /iconOnly/);
  assert.match(view, /name=\{sortDirection === "asc" \? "sort-asc" : "sort-desc"\}/);
  assert.doesNotMatch(view, />A-Z</);
  assert.doesNotMatch(view, />Z-A</);
});

test("AI import lives inside Import Export without a separate navigation tab", async () => {
  const [app, sidebar, store, welcome, palette, importView] = await Promise.all([
    readFile(new URL("App.tsx", root), "utf8"),
    readFile(new URL("components/Sidebar.tsx", root), "utf8"),
    readFile(new URL("store.ts", root), "utf8"),
    readFile(new URL("components/views/WelcomeView.tsx", root), "utf8"),
    readFile(new URL("components/CommandPalette.tsx", root), "utf8"),
    readFile(new URL("components/views/ImportExportView.tsx", root), "utf8"),
  ]);

  assert.match(importView, /<AiImportView active=\{active\} embedded/);
  assert.doesNotMatch(app, /case "ai-import"/);
  assert.doesNotMatch(sidebar, /kind: "ai-import"/);
  assert.doesNotMatch(store, /\| "ai-import"/);
  assert.doesNotMatch(welcome, /openTab\("ai-import"\)/);
  assert.doesNotMatch(palette, /openTab\("ai-import"\)/);
  assert.match(store, /\(tab\.kind as string\) !== "ai-import"/);
  assert.match(store, /kind: "import-export", \.\.\.TAB_META\["import-export"\]/);
});
