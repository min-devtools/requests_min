import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Command Palette opens a live-preview theme picker", async () => {
  const command = await readFile(new URL("components/CommandPalette.tsx", root), "utf8");

  assert.match(command, /label: "Theme picker"/);
  assert.match(command, /setThemePicker\(true\)/);
  assert.match(command, /className="modal"/);
  assert.match(command, /value=\{theme\}/);
  assert.match(command, /onChange=\{\(event\) => setTheme\(event\.target\.value\)\}/);
  assert.match(command, /THEMES\.filter\(\(item\) => item\.base === "dark"\)/);
  assert.doesNotMatch(command, /<ToolButton variant="primary" autoFocus onClick=\{\(\) => setThemePicker\(false\)\}>Done<\/ToolButton>/);
});

test("Command Palette keeps the Flows tab command but omits individual flow commands", async () => {
  const command = await readFile(new URL("components/CommandPalette.tsx", root), "utf8");

  assert.match(command, /label: "Open Flows"/);
  assert.doesNotMatch(command, /label: `Open flow:/);
  assert.doesNotMatch(command, /api\.flowList/);
});

test("Command Palette keeps the Collections tab command but omits collection switch commands", async () => {
  const command = await readFile(new URL("components/CommandPalette.tsx", root), "utf8");

  assert.match(command, /label: "Open Collections"/);
  assert.doesNotMatch(command, /label: `Switch collection:/);
  assert.doesNotMatch(command, /setActiveCollection/);
});
