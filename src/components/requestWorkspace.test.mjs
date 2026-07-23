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

test("HTTP body types share the main editor tab row and omit the TLS status label", async () => {
  const view = await readFile(new URL("components/views/RequestView.tsx", root), "utf8");

  assert.doesNotMatch(view, /TLS verify/);
  assert.match(view, /editorTab === "body" && \(\s*<div className="body-type-tabs">/);
  assert.doesNotMatch(view, /<div className="body-editor">\s*<div className="body-type-tabs">/);
});

test("HTTP Params uses one table; URL path variables show a bare, locked key (Postman-style)", async () => {
  const view = await readFile(new URL("components/views/RequestView.tsx", root), "utf8");
  const editor = await readFile(new URL("ui/KvEditor.tsx", root), "utf8");

  assert.doesNotMatch(view, /Path Params/);
  assert.doesNotMatch(view, /Query Params/);
  assert.match(view, /pathParams/);
  assert.match(view, /extractPathParams/);
  assert.match(view, /renderPathParams/);
  // no colon-prefix trick and no URL string-surgery on rename/remove — the key column is
  // just locked (readOnly) for the leading path-param rows; add/remove that param by editing the URL
  assert.doesNotMatch(view, /key\.startsWith\(":"\)/);
  assert.match(view, /lockedCount={httpPathParams\.length}/);
  assert.match(editor, /readOnly={locked}/);
  assert.match(editor, /locked \? <span \/> : <button/);
});

test("path params normalize from the URL even when a loaded request's pathParams is empty (imported requests)", async () => {
  const view = await readFile(new URL("components/views/RequestView.tsx", root), "utf8");

  // regression: `request.http?.pathParams ?? extractPathParams(...)` never falls back for
  // an imported request's `[]`, so its ":id" segment never gets a Params row or a value at send time
  assert.doesNotMatch(view, /request\.http\?\.pathParams \?\? extractPathParams/);
  assert.match(view, /const httpPathParams = extractPathParams\(request\.http\?\.url \?\? "", request\.http\?\.pathParams\)/);
  assert.match(view, /normalize once so Send substitutes real/);
});

test("shared JSON editors expose format, minify, and validate actions", async () => {
  const editor = await readFile(new URL("ui/JsonEditor.tsx", root), "utf8");

  assert.match(editor, /const format = \(\) => transform\(true\)/);
  assert.match(editor, /const minify = \(\) => transform\(false\)/);
  assert.match(editor, /const validate = \(\) =>/);
  // toolbar buttons are icon-only now — the action name lives in title/aria-label
  assert.match(editor, /title="Format" aria-label="Format"/);
  assert.match(editor, /title="Minify" aria-label="Minify"/);
  assert.match(editor, /title="Validate" aria-label="Validate"/);
});

test("response dock resizer persists a bounded vertical split", async () => {
  const [view, handles, styles] = await Promise.all([
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("components/ResizeHandles.tsx", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
  ]);

  assert.match(view, /startResize\(event, horizontal \? "request-x" : "request"\)/);
  assert.match(handles, /axis: "left" \| "right" \| "request" \| "request-x"/);
  assert.match(handles, /requestsmin:request-top/);
  assert.match(handles, /--request-top/);
  assert.match(handles, /export function toggleRequestEditorSize\(event: React\.MouseEvent, horizontal: boolean\)/);
  assert.match(handles, /if \(horizontal\) return/);
  assert.match(handles, /classList\.remove\("editor-maxed"\)/);
  // double-click toggles the dock: body flush to tabs (MIN_TOP) <-> 50% split
  assert.match(handles, /cur <= MIN_TOP \+ 8 \? Math\.round\(screenH \/ 2\) : MIN_TOP/);
  assert.match(view, /onDoubleClick=\{\(event\) => toggleRequestEditorSize\(event, horizontal\)\}/);
  assert.match(styles, /minmax\(39px, var\(--request-top\)\)/);
  assert.match(styles, /\.request-screen:not\(\.layout-cols\)\.editor-maxed[^}]*grid-template-rows:\s*38px 52px minmax\(39px, 1fr\) 0 0/s);
  assert.match(styles, /\.request-screen \.editor-pane[^}]*overflow:\s*hidden/s);
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

test("request navigation keeps sidebar actions and async tab opening on the active request", async () => {
  const [sidebar, store] = await Promise.all([
    readFile(new URL("components/Sidebar.tsx", root), "utf8"),
    readFile(new URL("store.ts", root), "utf8"),
  ]);

  assert.match(store, /let activationSequence = 0/);
  assert.match(store, /const activation = \+\+activationSequence;[\s\S]*await api\.reqRead/);
  assert.match(store, /activeTabId: activation === activationSequence \? id : s\.activeTabId/);
  assert.match(store, /activateTab: \(id\) => \{\s*activationSequence\+\+;/);
  assert.match(store, /const colId = s\.requestTabs\[id\]\?\.collectionId/);
  assert.doesNotMatch(sidebar, /const \[selected, setSelected\]/);
  assert.match(sidebar, /const selected = activeRequest\?\.collectionId/);
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

test("collection rows leave space after the method prefix and distinguish gRPC", async () => {
  const styles = await readFile(new URL("styles/requestsmin.css", root), "utf8");

  assert.match(styles, /collection-request-head, \.collection-request-row \{[^}]*grid-template-columns: 96px/s);
  assert.match(styles, /\.method-tag\.RPC \{ color: var\(--orange\); \}/);
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
  assert.match(themes, /Bearded Arc/);
  assert.match(settings, /<optgroup label="Dark">/);
  assert.match(store, /setTheme: \(theme: string\) => void/);
  assert.match(app, /retintMonaco\(themeBase\(theme\)\)/);
  assert.match(monaco, /export function retintMonaco\(theme: "dark" \| "light"\)/);
  // themes.css is a symlink into the shared design-systems source
  assert.match(main, /import "\.\/styles\/themes\.css"/);
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

test("response Header and Cookie tabs reuse their editor icons", async () => {
  const view = await readFile(new URL("components/views/RequestView.tsx", root), "utf8");

  assert.match(view, /<Icon name="braces" size=\{13\} \/> Pretty/);
  assert.match(view, /<Icon name="code" size=\{13\} \/> Raw/);
  assert.match(view, /setResponseTab\("headers"\)}><Icon name="activity" size=\{13\} \/> Headers/);
  assert.match(view, /setResponseTab\("cookies"\)}><Icon name="list" size=\{13\} \/> Cookies/);
});

test("response metadata uses theme-aware semantic colors", async () => {
  const [inspector, view, kv, styles] = await Promise.all([
    readFile(new URL("components/Inspector.tsx", root), "utf8"),
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("ui/Kv.tsx", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
  ]);

  assert.match(kv, /className=\{`kv \$\{className\}`\}/);
  // inspector run rows color by status; the response head shows duration and size chips
  assert.match(inspector, /runStatusClass\(entry\)/);
  assert.match(inspector, /className="inspector-run-row"/);
  assert.match(view, /className="metric-duration"/);
  assert.match(view, /className="metric-size"/);
  assert.match(styles, /\.metric-duration/);
  assert.match(styles, /\.metric-size/);
  assert.match(styles, /\.metric-status\.ok/);
  assert.match(styles, /color-mix\(in oklab/);
});

test("right dock keeps unique context actions and copies live HTTP and gRPC commands", async () => {
  const [inspector, requestView, styles] = await Promise.all([
    readFile(new URL("components/Inspector.tsx", root), "utf8"),
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
  ]);

  assert.match(inspector, /className="inspector-environment"/);
  assert.match(inspector, /Environment/);
  assert.match(inspector, /saveActiveRequest/);
  assert.match(inspector, /buildCurl\(request\)/);
  assert.match(inspector, /buildGrpcurl\(request\)/);
  assert.match(inspector, /Copy \{request\.protocol === "grpc" \? "grpcurl" : "cURL"\}/);
  assert.match(inspector, /Recent runs/);
  assert.match(requestView, /export function buildCurl/);
  assert.match(requestView, /export function buildGrpcurl/);
  assert.doesNotMatch(inspector, /GitHub sync/);
  assert.doesNotMatch(inspector, /runActiveRequest/);
  assert.doesNotMatch(inspector, /inspector-metrics/);
  assert.doesNotMatch(inspector, /inspector-request-title/);
  assert.doesNotMatch(inspector, /api\.exportCurl/);
  assert.match(styles, /\.inspector-environment\s*\{/);
  assert.match(styles, /\.inspector-error\s*\{/);
});

test("right dock inspects only variables used by the live request and protects secrets", async () => {
  const [inspector, variables, styles] = await Promise.all([
    readFile(new URL("components/Inspector.tsx", root), "utf8"),
    readFile(new URL("lib/requestVariables.ts", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
  ]);

  assert.match(variables, /export function requestVariableNames/);
  assert.match(variables, /new Set/);
  assert.match(inspector, /api\.secretRead\(activeEnv\)/);
  assert.match(inspector, /requestVariableNames\(request\)/);
  assert.match(inspector, /Secret/);
  assert.match(inspector, /Unresolved/);
  assert.match(inspector, /onPointerDown/);
  assert.match(inspector, /onPointerUp/);
  assert.doesNotMatch(inspector, /Request details/);
  assert.match(styles, /\.inspector-variable-row/);
  assert.match(styles, /\.inspector-variable-warning/);
});

test("environment autocomplete consumes existing closing braces when inserting a suggestion", async () => {
  const input = await readFile(new URL("ui/EnvInput.tsx", root), "utf8");

  assert.match(input, /export const replaceEnvSuggestion/);
  assert.match(input, /slice\(caret\)\.match\(\/\^\\}\+\//);
  assert.match(input, /replaceEnvSuggestion\(value, start, caret, name\)/);
});

test("right dock wraps full variable values and previews the resolved request target", async () => {
  const [inspector, variables, styles] = await Promise.all([
    readFile(new URL("components/Inspector.tsx", root), "utf8"),
    readFile(new URL("lib/requestVariables.ts", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
  ]);

  assert.match(variables, /export function resolveRequestTarget/);
  assert.match(inspector, /Resolved preview/);
  assert.match(inspector, /resolveRequestTarget\(request, vars, secrets, revealSecrets\)/);
  assert.match(inspector, /inspector-preview-target/);
  assert.match(styles, /\.inspector-variable-row strong[^}]*white-space:\s*pre-wrap/s);
  assert.match(styles, /\.inspector-variable-row strong[^}]*overflow-wrap:\s*anywhere/s);
  assert.doesNotMatch(styles, /\.inspector-variable-row strong[^}]*max-width:\s*112px/s);
  assert.match(styles, /\.inspector-preview\s*\{/);
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
  assert.match(viewer, /const refillPath = \(path: string\) =>/);
  assert.match(viewer, /setDraft\(path\)/);
  assert.match(viewer, /draftRef\.current\?\.focus\(\)/);
  assert.match(viewer, /<Icon name="copy"/);
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

test("gRPC imports multiple proto files, describes them immediately, and uses readable selectors", async () => {
  const [view, styles, cargo, backend, capability] = await Promise.all([
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
    readFile(new URL("../src-tauri/Cargo.toml", root), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("../src-tauri/capabilities/default.json", root), "utf8"),
  ]);

  assert.match(view, /import \{ open \} from "@tauri-apps\/plugin-dialog"/);
  assert.match(view, /multiple: true/);
  assert.match(view, /extensions: \["proto"\]/);
  assert.match(view, /await describeSource\(src\.id, true\)/);
  assert.match(view, /Import \.proto/);
  // reflection describe lives in the Proto tab now, not the path bar
  assert.match(view, /editorTab === "proto"/);
  assert.doesNotMatch(view, /void describe\("reflection"\)/);
  assert.match(view, /grpc-method-pickers/);
  assert.match(styles, /\.proto-panel/);
  assert.match(styles, /\.grpc-method-pickers/);
  assert.match(cargo, /tauri-plugin-dialog/);
  assert.match(backend, /tauri_plugin_dialog::init/);
  assert.match(capability, /dialog:allow-open/);
});

test("grpcurl proto files automatically bind a reusable source and surface describe failures", async () => {
  const view = await readFile(new URL("components/views/RequestView.tsx", root), "utf8");

  assert.match(view, /const matchingSource = protoSources\.find/);
  assert.match(view, /name: parsed\.grpc\.protoFiles\[0\]\.split/);
  assert.match(view, /sourceId: source\.id/);
  assert.match(view, /await describeSource\(source\.id, true\)/);
  assert.match(view, /setDescError\(String\(err\)\)/);
});

test("gRPC service and method use searchable comboboxes on the editor tab row", async () => {
  const [view, combobox, styles] = await Promise.all([
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("ui/Combobox.tsx", root), "utf8"),
    readFile(new URL("styles/requestsmin.css", root), "utf8"),
  ]);

  assert.match(view, /<div className="grpc-method-pickers">/);
  assert.match(view, /<Combobox[\s\S]*placeholder="Select service/);
  assert.match(view, /<Combobox[\s\S]*placeholder="Select method/);
  assert.doesNotMatch(view, /grpc-catalog-row/);
  assert.match(combobox, /role="combobox"/);
  assert.match(combobox, /aria-autocomplete="list"/);
  assert.match(combobox, /fuzzyMatch/);
  assert.match(combobox, /event\.key === "ArrowDown"/);
  assert.match(combobox, /event\.key === "Enter"/);
  assert.match(styles, /\.grpc-method-pickers/);
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
