import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("GitHub sync labels omit the footer repo and inspector organization", async () => {
  const statusbar = await readFile(new URL("components/Statusbar.tsx", root), "utf8");
  const inspector = await readFile(new URL("components/Inspector.tsx", root), "utf8");

  assert.doesNotMatch(statusbar, /<span>\{gh\.repo\.split\("\/"\)\.pop\(\)\}<\/span>/);
  // repo details left the inspector entirely — the statusbar shows a compact sync badge instead
  assert.doesNotMatch(inspector, /gh\?\.repo/);
  assert.match(statusbar, /sync-badge/);
});

test("right dock selects the app-wide environment", async () => {
  const inspector = await readFile(new URL("components/Inspector.tsx", root), "utf8");

  assert.match(inspector, /setActiveEnv/);
  assert.match(inspector, /api\.envList\(\)/);
  assert.match(inspector, /className="inspector-env-row">\s*<select/);
  assert.match(inspector, /setActiveEnv\(event\.target\.value \|\| null\)/);
});

test("Environment saves through Cmd+S and request editors suggest environment variables", async () => {
  const [app, environments, editor, view] = await Promise.all([
    readFile(new URL("App.tsx", root), "utf8"),
    readFile(new URL("components/views/EnvironmentsView.tsx", root), "utf8"),
    readFile(new URL("ui/JsonEditor.tsx", root), "utf8"),
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
  ]);

  assert.match(app, /activeTab\?\.kind === "environments"/);
  assert.match(app, /new Event\("requestsmin:save-environment"\)/);
  assert.match(environments, /addEventListener\("requestsmin:save-environment", save\)/);
  assert.match(environments, /api\.envWrite/);
  assert.match(editor, /registerCompletionItemProvider/);
  assert.match(editor, /endsWith\("\{\{"\)/);
  assert.match(editor, /createDecorationsCollection/);
  assert.match(editor, /env-variable-token/);
  assert.match(editor, /\{\{\$\{name\}\}\}/);
  assert.match(view, /variableNames=/);
});

test("single-line request fields highlight only environment tokens with the primary color", async () => {
  const [input, view, styles] = await Promise.all([
    readFile(new URL("ui/EnvInput.tsx", root), "utf8"),
    readFile(new URL("components/views/RequestView.tsx", root), "utf8"),
    readFile(new URL("styles/components.css", root), "utf8"),
  ]);

  assert.match(input, /className="env-input-token"/);
  assert.match(input, /before\.match\(\/\\\{\\\{\(\[\^\{\}\]\*\)\$\//);
  assert.match(input, /`\{\{\$\{name\}\}\}`/);
  assert.match(view, /<EnvInput/);
  assert.doesNotMatch(view, /has-env-variable/);
  assert.match(input, /className={`env-input \$\{focused \? "editing" : ""\}/);
  assert.match(styles, /\.env-input-token[^{]*\{[^}]*padding: 2px 6px[^}]*var\(--purple\)/s);
  assert.doesNotMatch(styles, /\.env-input-token[^{]*\{[^}]*margin:/s);
  assert.match(styles, /\.env-input\.editing \.env-input-overlay \{ display: none; \}/);
});
