import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("request tabs show the request method instead of a protocol icon", async () => {
  const tabs = await readFile(new URL("components/TabsBar.tsx", root), "utf8");

  assert.match(tabs, /const method = rt\?\.request\.protocol === "http"/);
  assert.match(tabs, /className={`tab-method method-tag \$\{method\}`}/);
  assert.match(tabs, /<span className="tab-title">/);
  assert.match(tabs, /rt \? <span className={`tab-method method-tag \$\{method\}`}>\{method\}<\/span> : <Icon name=\{tab\.icon\}/);
});

test("shared JSON editors expose format, minify, and validate actions", async () => {
  const editor = await readFile(new URL("ui/JsonEditor.tsx", root), "utf8");

  assert.match(editor, /const format = \(\) => transform\(true\)/);
  assert.match(editor, /const minify = \(\) => transform\(false\)/);
  assert.match(editor, /const validate = \(\) =>/);
  assert.match(editor, />Format<\/button>/);
  assert.match(editor, />Minify<\/button>/);
  assert.match(editor, />Validate<\/button>/);
});

test("response dock resizer persists a bounded vertical split", async () => {
  const [view, handles, styles] = await Promise.all([
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("components/ResizeHandles.tsx", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
  ]);

  assert.match(view, /onPointerDown=\{\(event\) => startResize\(event, "request"\)\}/);
  assert.match(handles, /axis: "left" \| "right" \| "request"/);
  assert.match(handles, /requestsmin:request-top/);
  assert.match(handles, /--request-top/);
  assert.match(styles, /minmax\(220px, var\(--request-top\)\)/);
  assert.match(styles, /touch-action: none/);
});

test("saved requests expose open and delete actions from their context menus", async () => {
  const [sidebar, tabs, store, menu] = await Promise.all([
    readFile(new URL("components/Sidebar.tsx", root), "utf8"),
    readFile(new URL("components/TabsBar.tsx", root), "utf8"),
    readFile(new URL("store.ts", root), "utf8"),
    readFile(new URL("components/RequestContextMenu.tsx", root), "utf8"),
  ]);

  assert.match(sidebar, /onContextMenu=\{\(event\) => openRequestMenu\(event, c\.id, r\)\}/);
  assert.match(tabs, /onContextMenu=\{\(event\) => \{ if \(!rt\?\.collectionId \|\| !rt\.relPath\) return;/);
  assert.match(menu, /<strong>Open request<\/strong>/);
  assert.match(menu, /<strong>Delete request<\/strong>/);
  assert.match(store, /deleteRequest: \(collectionId: string, relPath: string\) => Promise<void>/);
  assert.match(store, /await api\.reqDelete\(collectionId, relPath\)/);
  assert.match(store, /closeTab\(tab\.id\)/);
});

test("Collections is a request manager without duplicate sync or import panels", async () => {
  const [view, menu, store] = await Promise.all([
    readFile(new URL("components/views/CollectionsView.tsx", root), "utf8"),
    readFile(new URL("components/RequestContextMenu.tsx", root), "utf8"),
    readFile(new URL("store.ts", root), "utf8"),
  ]);

  assert.match(view, /newRequestTab\("http", collection\.id\)/);
  assert.match(view, /<RequestContextMenu/);
  assert.doesNotMatch(view, /GitHub sync/);
  assert.doesNotMatch(view, /<h3>Import<\/h3>/);
  assert.match(menu, /<strong>Rename request<\/strong>/);
  assert.match(menu, /<strong>Duplicate request<\/strong>/);
  assert.match(store, /renameRequest: \(collectionId: string, relPath: string, name: string\) => Promise<void>/);
  assert.match(store, /duplicateRequest: \(collectionId: string, relPath: string, name: string\) => Promise<void>/);
});

test("Settings exposes persistent UI and editor font family controls", async () => {
  const [settings, store, styles, api, backend] = await Promise.all([
    readFile(new URL("components/views/SettingsView.tsx", root), "utf8"),
    readFile(new URL("store.ts", root), "utf8"),
    readFile(new URL("styles/views.css", root), "utf8"),
    readFile(new URL("lib/api.ts", root), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", root), "utf8"),
  ]);

  assert.match(settings, /Interface font family/);
  assert.match(settings, /Editor font family/);
  assert.match(store, /setUiFont: \(font: string\) => void/);
  assert.match(store, /setEditorFont: \(font: string\) => void/);
  assert.match(settings, /api\.listFonts\(\)/);
  assert.match(api, /listFonts: \(\) => invoke<string\[\]>\("list_fonts"\)/);
  assert.match(backend, /async fn list_fonts\(\) -> Result<Vec<String>, String>/);
  assert.match(styles, /width: max-content/);
});

test("theme picker uses named palettes and retints Monaco from the active palette", async () => {
  const [themes, settings, store, app, monaco, main] = await Promise.all([
    readFile(new URL("lib/themes.ts", root), "utf8"),
    readFile(new URL("components/views/SettingsView.tsx", root), "utf8"),
    readFile(new URL("store.ts", root), "utf8"),
    readFile(new URL("App.tsx", root), "utf8"),
    readFile(new URL("lib/monaco.ts", root), "utf8"),
    readFile(new URL("main.tsx", root), "utf8"),
  ]);

  assert.match(themes, /Catppuccin Mocha/);
  assert.match(themes, /Tokyo Night/);
  assert.match(themes, /Bearded Aquarelle Cymbidium/);
  assert.match(settings, /<optgroup label="Dark">/);
  assert.match(store, /setTheme: \(theme: string\) => void/);
  assert.match(app, /retintMonaco\(themeBase\(theme\)\)/);
  assert.match(monaco, /export function retintMonaco\(theme: "dark" \| "light"\)/);
  assert.match(main, /elatic_min\/src\/styles\/themes\.css/);
});

test("responses use the shared theme-aware JSON view", async () => {
  const [view, jsonView, format] = await Promise.all([
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("ui/JsonView.tsx", root), "utf8"),
    readFile(new URL("lib/format.ts", root), "utf8"),
  ]);

  assert.match(view, /import \{ JsonView \}/);
  assert.match(view, /<JsonView className="response-code json-tree"/);
  assert.match(jsonView, /highlightJson/);
  assert.match(format, /syntax-key/);
});

test("JSON responses use Monaco scope folding and path projection Normalize", async () => {
  const [view, viewer, normalize] = await Promise.all([
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("ui/JsonResponseViewer.tsx", root), "utf8"),
    readFile(new URL("lib/normalizeJson.ts", root), "utf8"),
  ]);

  assert.match(view, /import \{ JsonResponseViewer \}/);
  assert.match(view, /<JsonResponseViewer value=/);
  assert.match(viewer, /readOnly: true/);
  assert.match(viewer, /folding: true/);
  assert.match(viewer, /showFoldingControls: "always"/);
  assert.match(viewer, /actions\.find/);
  assert.match(viewer, /setNormalize\(\(v\) => !v\)/);
  assert.match(viewer, /placeholder="value\.\$\.a or value\[0\]\.a"/);
  assert.match(normalize, /export function normalizeJson/);
  assert.match(normalize, /value\.\$\.a/);
  assert.match(normalize, /value\[0\]\.a/);
});

test("release bundle uses a valid identifier and excludes test-only gRPC helpers", async () => {
  const [config, grpc] = await Promise.all([
    readFile(new URL("../src-tauri/tauri.conf.json", root), "utf8"),
    readFile(new URL("../src-tauri/src/grpc.rs", root), "utf8"),
  ]);

  assert.match(config, /"identifier": "com\.requestsmin"/);
  assert.doesNotMatch(config, /"identifier": "[^"]+\.app"/);
  assert.match(grpc, /#\[cfg\(test\)\]\npub fn message_to_bytes/);
  assert.match(grpc, /#\[cfg\(test\)\]\npub fn bytes_to_json/);
});

test("GitHub setup defaults to requests_min_collections and initializes first sync", async () => {
  const [sync, settings, github] = await Promise.all([
    readFile(new URL("components/views/GithubSyncView.tsx", root), "utf8"),
    readFile(new URL("components/views/SettingsView.tsx", root), "utf8"),
    readFile(new URL("../src-tauri/src/github.rs", root), "utf8"),
  ]);

  assert.match(sync, /DEFAULT_REPO/);
  assert.match(settings, /DEFAULT_REPO/);
  assert.match(github, /\/contents\/\.requestsmin/);
  assert.match(github, /ref_status == 404 \|\| ref_status == 409/, "empty repo (409) must get an initial commit like a missing branch (404)");
});
