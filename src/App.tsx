import { memo, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Titlebar as TitlebarImpl } from "./components/Titlebar";
import { Sidebar as SidebarImpl } from "./components/Sidebar";
import { TabsBar as TabsBarImpl } from "./components/TabsBar";
import { Inspector as InspectorImpl } from "./components/Inspector";
import { Statusbar as StatusbarImpl } from "./components/Statusbar";
import { CommandPalette as CommandPaletteImpl } from "./components/CommandPalette";
import { Toast as ToastImpl } from "./components/Toast";
import { Dialog as DialogImpl } from "./components/Dialog";
import { PanelResizeHandles as PanelResizeHandlesImpl } from "./components/ResizeHandles";
import { WelcomeView as WelcomeViewImpl } from "./components/views/WelcomeView";
import { RequestView as RequestViewImpl } from "./components/views/RequestView";
import { CollectionsView as CollectionsViewImpl } from "./components/views/CollectionsView";
import { EnvironmentsView as EnvironmentsViewImpl } from "./components/views/EnvironmentsView";
import { SettingsView as SettingsViewImpl } from "./components/views/SettingsView";
import { HistoryView as HistoryViewImpl } from "./components/views/HistoryView";
import { ImportExportView as ImportExportViewImpl } from "./components/views/ImportExportView";
import { GithubSyncView as GithubSyncViewImpl } from "./components/views/GithubSyncView";
import { FlowsView as FlowsViewImpl } from "./components/views/FlowsView";
import { FlowView as FlowViewImpl } from "./components/views/FlowView";

// App re-renders on shell state (dock collapse, theme, tab switches). Without memo
// that re-render cascades into every panel — including motion components whose
// `layout` props re-measure the DOM — right while the dock CSS transition is
// already reflowing every frame. Memoized, a dock toggle re-renders App alone.
const Titlebar = memo(TitlebarImpl);
const Sidebar = memo(SidebarImpl);
const TabsBar = memo(TabsBarImpl);
const Inspector = memo(InspectorImpl);
const Statusbar = memo(StatusbarImpl);
const CommandPalette = memo(CommandPaletteImpl);
const Toast = memo(ToastImpl);
const Dialog = memo(DialogImpl);
const PanelResizeHandles = memo(PanelResizeHandlesImpl);
const WelcomeView = memo(WelcomeViewImpl);
const RequestView = memo(RequestViewImpl);
const CollectionsView = memo(CollectionsViewImpl);
const EnvironmentsView = memo(EnvironmentsViewImpl);
const SettingsView = memo(SettingsViewImpl);
const HistoryView = memo(HistoryViewImpl);
const ImportExportView = memo(ImportExportViewImpl);
const GithubSyncView = memo(GithubSyncViewImpl);
const FlowsView = memo(FlowsViewImpl);
const FlowView = memo(FlowViewImpl);
import { useApp, type TabDef } from "./store";
import { runActiveRequest, saveActiveRequest } from "./lib/runRequest";
import { runActiveFlow } from "./lib/flow/engine";
import { saveActiveFlow } from "./lib/flow/flowActions";
import { Icon } from "./ui/Icon";
import { retintMonaco } from "./lib/monaco";
import { themeBase } from "./lib/themes";
import { startAutoSync } from "./lib/ghSync";

function renderView(tab: TabDef, active: boolean) {
  switch (tab.kind) {
    case "welcome": return <WelcomeView key={tab.id} active={active} />;
    case "request": return <RequestView key={tab.id} tabId={tab.id} active={active} />;
    case "flows": return <FlowsView key={tab.id} active={active} />;
    case "flow": return <FlowView key={tab.id} tabId={tab.id} active={active} />;
    case "collections": return <CollectionsView key={tab.id} active={active} />;
    case "environments": return <EnvironmentsView key={tab.id} active={active} />;
    case "history": return <HistoryView key={tab.id} active={active} />;
    case "import-export": return <ImportExportView key={tab.id} active={active} />;
    case "github-sync": return <GithubSyncView key={tab.id} active={active} />;
    case "settings": return <SettingsView key={tab.id} active={active} />;
  }
}

export default function App() {
  // narrow subscription: keystrokes only touch requestTabs, which App doesn't render
  const {
    tabs, activeTabId, theme, compact, uiFontSize, uiFont, editorFont, leftCollapsed, rightCollapsed,
    toggleLeft, toggleRight, setCommandOpen, newRequestTab, confirmCloseTab, openTab,
  } = useApp(useShallow((s) => ({
    tabs: s.tabs, activeTabId: s.activeTabId, theme: s.theme, compact: s.compact,
    uiFontSize: s.uiFontSize, uiFont: s.uiFont, editorFont: s.editorFont,
    leftCollapsed: s.leftCollapsed, rightCollapsed: s.rightCollapsed,
    toggleLeft: s.toggleLeft, toggleRight: s.toggleRight, setCommandOpen: s.setCommandOpen,
    newRequestTab: s.newRequestTab, confirmCloseTab: s.confirmCloseTab, openTab: s.openTab,
  })));
  const activeKind = tabs.find((tab) => tab.id === activeTabId)?.kind;
  const inspectorAvailable = activeKind === "request" || activeKind === "flow";

  useEffect(() => {
    document.body.dataset.theme = theme;
    document.body.classList.toggle("light", themeBase(theme) === "light");
    document.body.classList.toggle("compact", compact);
    document.body.classList.toggle("left-collapsed", leftCollapsed);
    document.body.classList.toggle("right-collapsed", rightCollapsed);
    document.body.classList.toggle("inspector-unavailable", !inspectorAvailable);
    // flow tabs host the full step editor in the dock — pin a min dock width so it can't collapse the editor UI
    document.body.classList.toggle("flow-active", activeKind === "flow");
    document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
    document.documentElement.style.setProperty("--font-body", uiFont ? `"${uiFont}", var(--font-body-default)` : "var(--font-body-default)");
    document.documentElement.style.setProperty("--font-mono", editorFont ? `"${editorFont}", var(--font-mono-default)` : "var(--font-mono-default)");
    retintMonaco(themeBase(theme));
  }, [theme, compact, uiFontSize, uiFont, editorFont, leftCollapsed, rightCollapsed, inspectorAvailable, activeKind]);

  useEffect(() => {
    const preventFileDrop = (e: DragEvent) => {
      // Prevent browser from navigating when dropping files anywhere on the app
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };
    window.addEventListener("dragover", preventFileDrop);
    window.addEventListener("drop", preventFileDrop);
    return () => {
      window.removeEventListener("dragover", preventFileDrop);
      window.removeEventListener("drop", preventFileDrop);
    };
  }, []);

  useEffect(() => { void startAutoSync(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Monaco's own addCommand bindings (e.g. ⌘↵ in the body editor) call preventDefault
      // before this bubbles to document — skip so we don't double-fire the same shortcut.
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") { e.preventDefault(); setCommandOpen(true); }
      // ⌘N always. Ctrl+N only outside Monaco — inside it, Vim mode owns Ctrl+N.
      // Dropping ctrlKey entirely would leave Windows/Linux with no New-request key.
      const inEditor = !!(e.target as HTMLElement | null)?.closest?.(".monaco-editor");
      if ((e.metaKey || (e.ctrlKey && !inEditor)) && key === "n") { e.preventDefault(); newRequestTab(); }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        const activeTabKind = useApp.getState().tabs.find((tab) => tab.id === useApp.getState().activeTabId)?.kind;
        if (activeTabKind === "flow") void runActiveFlow();
        else void runActiveRequest();
      }
      if (mod && key === "s") {
        e.preventDefault();
        const activeTab = useApp.getState().tabs.find((tab) => tab.id === useApp.getState().activeTabId);
        if (activeTab?.kind === "environments") window.dispatchEvent(new Event("requestsmin:save-environment"));
        else if (activeTab?.kind === "flow") void saveActiveFlow();
        else void saveActiveRequest();
      }
      if (mod && key === "z") {
        // let inputs / Monaco keep their native text undo; only the flow canvas gets graph undo
        const el = document.activeElement as HTMLElement | null;
        const editable = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        const st = useApp.getState();
        if (!editable && st.tabs.find((t) => t.id === st.activeTabId)?.kind === "flow") {
          e.preventDefault();
          if (e.shiftKey) st.redoFlow(st.activeTabId); else st.undoFlow(st.activeTabId);
        }
      }
      if (mod && key === "b") { e.preventDefault(); toggleLeft(); }
      if (mod && key === "r") {
        const state = useApp.getState();
        const kind = state.tabs.find((tab) => tab.id === state.activeTabId)?.kind;
        if (kind === "request" || kind === "flow") {
          e.preventDefault();
          toggleRight();
        }
      }
      if (mod && e.key === ",") { e.preventDefault(); openTab("settings"); }
      if (mod && key >= "1" && key <= "9") {
        const tab = useApp.getState().tabs[Number(key) - 1];
        if (tab) { e.preventDefault(); useApp.getState().activateTab(tab.id); }
      }
      if (mod && key === "w") { e.preventDefault(); void confirmCloseTab(useApp.getState().activeTabId); }
      // ⌘⇧[ / ⌘⇧] cycle tabs — e.code because ⇧[ yields "{" as e.key on US layouts
      if (mod && e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        e.preventDefault();
        const { tabs: allTabs, activeTabId: current, activateTab } = useApp.getState();
        const index = allTabs.findIndex((tab) => tab.id === current);
        const next = allTabs[(index + (e.code === "BracketRight" ? 1 : -1) + allTabs.length) % allTabs.length];
        if (next) activateTab(next.id);
      }
      if (mod && (e.key === "+" || e.key === "=")) { e.preventDefault(); useApp.getState().changeUiFontSize(1); }
      if (mod && (e.key === "-" || e.key === "_")) { e.preventDefault(); useApp.getState().changeUiFontSize(-1); }
      if (e.key === "Escape") setCommandOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setCommandOpen, newRequestTab, toggleLeft, toggleRight, confirmCloseTab, openTab]);

  return (
    <div className="app-frame">
      <Titlebar />
      <main className="main">
        <Sidebar />
        <section className="workspace">
          <TabsBar />
          {tabs.map((tab) => renderView(tab, tab.id === activeTabId))}
        </section>
        <Inspector />
        <PanelResizeHandles />
      </main>
      <Statusbar />
      <button type="button" className={`tool-btn panel-toggle panel-corner left ${leftCollapsed ? "" : "active"}`} title="Toggle sidebar (⌘B)" aria-label="Toggle sidebar" onClick={toggleLeft}>
        <Icon name="panel-left" />
      </button>
      <button type="button" className={`tool-btn panel-toggle panel-corner right ${rightCollapsed || !inspectorAvailable ? "" : "active"}`} title="Toggle inspector (⌘R)" aria-label="Toggle inspector" disabled={!inspectorAvailable} onClick={toggleRight}>
        <Icon name="panel-right" />
      </button>
      <CommandPalette />
      <Toast />
      <Dialog />
    </div>
  );
}
