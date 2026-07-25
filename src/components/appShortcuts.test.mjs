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

test("New request is Command+N only so Vim Ctrl+N stays available", async () => {
  const app = await appSource();

  assert.match(app, /if \(e\.metaKey && key === "n"\) \{ e\.preventDefault\(\); newRequestTab\(\); \}/);
  assert.doesNotMatch(app, /if \(mod && key === "n"\)/);
});
