import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Inspector variable rows edit in place and write back to the active environment", async () => {
  const inspector = await readFile(new URL("components/Inspector.tsx", root), "utf8");

  // clicking a row opens the draft input; dynamic ($) rows keep their read-only render
  assert.match(inspector, /inspector-variable-row editable/);
  assert.match(inspector, /onClick=\{\(\) => editing === name \|\| startEdit\(name, value \?\? ""\)\}/);
  assert.match(inspector, /className="inspector-variable-edit"/);
  // secrets go to secret_write, plain vars to env_write — both merged into the full map
  assert.match(inspector, /api\.secretWrite\(activeEnv, \{ \.\.\.secrets, \[name\]: draft \}\)/);
  assert.match(inspector, /api\.envWrite\(activeEnv, \{ \.\.\.vars, \[name\]: draft \}\)/);
  // bumpEnv re-triggers the [activeEnv, envVersion] read effect, which is what syncs the panel
  assert.match(inspector, /bumpEnv\(\);/);
  assert.match(inspector, /\}, \[activeEnv, envVersion\]\);/);
  // Escape must not save via the blur that follows it
  assert.match(inspector, /if \(cancelled\.current \|\| !activeEnv\) return;/);
  // no environment selected = nothing to write to
  assert.match(inspector, /if \(!activeEnv\) \{ showToast\("No environment"/);
});

test("Environments view reloads when a variable is edited elsewhere", async () => {
  const view = await readFile(new URL("components/views/EnvironmentsView.tsx", root), "utf8");

  assert.match(view, /\}, \[env, envVersion\]\);/);
});
