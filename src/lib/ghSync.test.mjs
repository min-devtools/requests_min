import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("default repo is requests_min_collections and no stale typo remains", async () => {
  const ghSync = await readFile(new URL("lib/ghSync.ts", root), "utf8");
  assert.match(ghSync, /export const DEFAULT_REPO = "requests_min_collections"/);

  const walk = async (dir) => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(p)));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
    return out;
  };
  for (const file of await walk(new URL(".", root).pathname)) {
    const text = await readFile(file, "utf8");
    assert.ok(!text.includes("request_min_collections"), `stale repo name in ${file}`);
  }
});

test("auto sync never pulls over never-synced local collections", async () => {
  const ghSync = await readFile(new URL("lib/ghSync.ts", root), "utf8");
  assert.match(ghSync, /if \(!status\.lastSha\) return hasLocal \? "push" : "pull"/);
  assert.match(ghSync, /if \(!status\.repo\) \{\s*await api\.ghConfigure\(DEFAULT_REPO\)/);
});

test("auto sync is wired: app start + debounced push on every mutation", async () => {
  const app = await readFile(new URL("App.tsx", root), "utf8");
  assert.match(app, /void startAutoSync\(\)/);

  const apiSrc = await readFile(new URL("lib/api.ts", root), "utf8");
  for (const cmd of ["col_create", "col_rename", "col_delete", "req_write", "req_delete", "req_move", "env_write", "env_delete", "col_save_draft"]) {
    assert.match(apiSrc, new RegExp(`mutated\\(invoke[^)]*\\("${cmd}"`), `${cmd} not wrapped in mutated()`);
  }
  assert.ok(!/mutated\(invoke[^)]*\("secret_write"/.test(apiSrc), "secrets must not trigger sync");
});
