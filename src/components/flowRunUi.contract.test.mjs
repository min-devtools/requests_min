import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, src), "utf8").catch(() => "");

test("the titlebar owns run, cancel, and save for flow tabs", async () => {
  const titlebar = await read("components/Titlebar.tsx");

  assert.match(titlebar, /import \{ cancelFlow, runActiveFlow \} from "\.\.\/lib\/flow\/engine"/);
  assert.match(titlebar, /import \{ saveActiveFlow \} from "\.\.\/lib\/flow\/flowActions"/);
  assert.match(titlebar, /if \(isFlow\) void runActiveFlow\(\);/);
  assert.match(titlebar, /if \(isFlow\) cancelFlow\(activeTabId\);/);
  assert.match(titlebar, /else if \(isFlow\) void saveActiveFlow\(\)/);
  assert.match(titlebar, /rt\?\.dirty \?\? ft\?\.dirty \?\? false/);
  assert.match(titlebar, /rt\?\.running \?\? ft\?\.running \?\? false/);
});

test("flow toolbar keeps per-node runs plus arrange, and no duplicate run button", async () => {
  const view = await read("components/views/FlowView.tsx");

  assert.match(view, /onRunNode=\{\(nodeId\) => void runFlow\(tabId, nodeId\)\}/);
  // arrange execution moved into the canvas (measured sizes + tween); the toolbar drives it via ref
  assert.match(view, /arrangeApi\.current\?\.\(direction\)/);
  assert.doesNotMatch(view, /cancelFlow/);
  assert.doesNotMatch(view, /"tool-btn" onClick=\{\(\) => void runFlow\(tabId\)\}/);
});

test("run report rows open the step dock and stay accessible", async () => {
  const report = await read("components/flow/RunReport.tsx");

  assert.match(report, /if \(!ft\?\.run\) return null/);
  // loop back-edges would make plain topoOrder bail; the report walks the acyclic remainder
  assert.match(report, /topoOrder\(flow\.nodes, dagEdges\(flow\)\) \?\? flow\.nodes\.map/);
  assert.match(report, /<button[^>]+type="button"[^>]+className=\{`flow-report-row/s);
  // every row focuses its step: requests/transforms land on Step Result, loop/delay on Step detail
  assert.match(report, /panelNodeId: node\.id/);
  assert.match(report, /dockTab: hasResult \? "result" : "step"/);
  // row glyphs mirror the canvas blocks via the shared stepIcon helper
  assert.match(report, /stepIcon\(node\)/);
  assert.match(report, /import \{ stepIcon, stepTypeClass \} from "\.\/nodeBits"/);
  assert.match(report, /`HTTP \$\{response\.status\}`/);
  assert.match(report, /`gRPC \$\{response\.statusCode\}`/);
  assert.doesNotMatch(report, /Final response/);
});

test("run report paginates loop passes with a jump-to-page input", async () => {
  const [report, types, engine, css] = await Promise.all([
    read("components/flow/RunReport.tsx"),
    read("lib/flow/types.ts"),
    read("lib/flow/engine.ts"),
    read("styles/views.css"),
  ]);
  // the engine keeps one snapshot per pass; the report pages body rows by it
  assert.match(types, /loopPasses\?: Record<string, StepResult>\[\]/);
  assert.match(engine, /snapshotPass\(\)/);
  // every loop that ran gets paged, not just the first one on the canvas
  assert.match(report, /loopsWithPasses/);
  assert.match(report, /for \(const bodyId of loopBodyNodes\(flow, entry\.node\.id\)\) passesByBodyStep\.set/);
  assert.match(report, /passes\[Math\.min\(safePage, passes\.length - 1\)\]/);
  assert.match(report, /className="flow-report-pager"/);
  assert.match(report, /aria-label="Pass number"/);
  assert.match(report, /aria-label="Previous pass"/);
  assert.match(report, /aria-label="Next pass"/);
  assert.match(report, /goToPage\(parsed - 1\)/); // typing a page number jumps straight to it
  assert.match(report, /\/ \{formatNumber\(pageCount\)\} passes/);
  assert.match(css, /\.flow-report-pager input/);
});

test("run report is a bounded, resizable third flow row with semantic tokens", async () => {
  const [view, css] = await Promise.all([
    read("components/views/FlowView.tsx"),
    read("styles/views.css"),
  ]);

  assert.match(view, /<RunReport tabId=\{tabId\} \/>/);
  assert.match(css, /\.content\.flow-view\.active\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/s);
  assert.match(css, /\.flow-report-content\s*\{[^}]*max-height:[^}]*overflow:\s*auto/s);
  assert.match(css, /\.flow-report-row\.status-failed[^}]*var\(--status-danger\)/s);
  const reportCss = css.slice(css.indexOf(".flow-report"), css.indexOf("@keyframes flow-pulse"));
  assert.doesNotMatch(reportCss, /var\(--(?:border|panel|ok|err)(?:\)|,)/);
});
