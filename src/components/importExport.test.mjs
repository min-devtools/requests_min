import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("command imports open an unsaved request tab instead of requiring a collection", async () => {
  const view = await readFile(new URL("components/views/ImportExportView.tsx", root), "utf8");

  assert.match(view, /newRequestTab\(request\.protocol\)/);
  assert.match(view, /updateRequestTab\(tabId, \{ request \}\)/);
  assert.doesNotMatch(view, /Select a collection before importing/);
  assert.match(view, /importCollectionId/);
  assert.match(view, /Open as new request/);
  assert.match(view, /isGrpcurl\(text\)/);
  assert.match(view, /\["command", "postman", "openapi"\]/);
});

test("collection imports show a selected-file success state and export owns collection selection", async () => {
  const view = await readFile(new URL("components/views/ImportExportView.tsx", root), "utf8");

  assert.match(view, /import-file \$\{fileName \? "selected" : ""\}/);
  assert.match(view, /Icon name=\{fileName \? "check" : "folder"\}/);
  assert.match(view, /Collection file ready/);
  assert.match(view, /exportCollectionId/);
  assert.match(view, /Copy collection JSON/);
  assert.match(view, /importCollectionId/);
  assert.match(view, /Create new collection/);
  assert.match(view, /api\.colMergeDraft/);
});
