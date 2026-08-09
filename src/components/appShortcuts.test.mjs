import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../App.tsx", import.meta.url), "utf8");

test("Cmd/Ctrl+Enter runs the active flow and otherwise runs the active request", async () => {
  const app = await appSource();

  assert.match(app, /const mod = e\.metaKey \|\| e\.ctrlKey/);
  assert.match(app, /import \{ runActiveFlow \} from "\.\/lib\/flow\/engine"/);
  assert.match(
    app,
    /if \(mod && e\.key === "Enter"\) \{\s*e\.preventDefault\(\);\s*const activeTabKind = useApp\.getState\(\)\.tabs\.find\(\(tab\) => tab\.id === useApp\.getState\(\)\.activeTabId\)\?\.kind;\s*if \(activeTabKind === "flow"\) void runActiveFlow\(\);\s*else void runActiveRequest\(\);\s*\}/,
  );
});

test("New request takes Ctrl+N only outside Monaco so Vim Ctrl+N stays available", async () => {
  const app = await appSource();

  assert.match(app, /const inEditor = !!\(e\.target as HTMLElement \| null\)\?\.closest\?\.\("\.monaco-editor"\)/);
  assert.match(
    app,
    /if \(\(e\.metaKey \|\| \(e\.ctrlKey && !inEditor\)\) && key === "n"\) \{ e\.preventDefault\(\); newRequestTab\(\); \}/,
  );
  // a bare `mod` would swallow Vim's Ctrl+N inside the editor
  assert.doesNotMatch(app, /if \(mod && key === "n"\)/);
});
