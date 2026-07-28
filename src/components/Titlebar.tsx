import { useShallow } from "zustand/react/shallow";
import { ToolButton } from "../ui/ToolButton";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import { runActiveRequest, saveActiveRequest } from "../lib/runRequest";
import { cancelFlow, runActiveFlow } from "../lib/flow/engine";
import { saveActiveFlow } from "../lib/flow/flowActions";
import { requestTargetConfigured } from "../lib/requestReadiness";
import logo from "../assets/logo.png";
import { themeBase } from "../lib/themes";

export function Titlebar() {
  // derived primitives only — a keystroke in a body editor must not re-render the titlebar
  const {
    activeTabId, activeKind, request, relPath, dirty, running, isWs, hasFlowNodes,
    setCommandOpen, newRequestTab, toggleTheme, toggleCompact, theme, reloadCollections, showToast, openTab,
  } = useApp(useShallow((s) => {
    const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
    const rt = activeTab?.kind === "request" ? s.requestTabs[s.activeTabId] : null;
    const ft = activeTab?.kind === "flow" ? s.flowTabs[s.activeTabId] : null;
    return {
      activeTabId: s.activeTabId, activeKind: activeTab?.kind,
      request: rt?.request ?? null, relPath: rt?.relPath ?? null,
      dirty: rt?.dirty ?? ft?.dirty ?? false, running: rt?.running ?? ft?.running ?? false,
      isWs: rt?.request.protocol === "ws", hasFlowNodes: (ft?.flow.nodes.length ?? 0) > 0,
      setCommandOpen: s.setCommandOpen, newRequestTab: s.newRequestTab, toggleTheme: s.toggleTheme,
      toggleCompact: s.toggleCompact, theme: s.theme, reloadCollections: s.reloadCollections,
      showToast: s.showToast, openTab: s.openTab,
    };
  }));
  const isFlow = activeKind === "flow";
  const save = () => {
    if (activeKind === "environments") window.dispatchEvent(new Event("requestsmin:save-environment"));
    else if (isFlow) void saveActiveFlow().catch((error) => showToast("Save failed", String(error), "err"));
    else void saveActiveRequest();
  };
  const send = () => {
    if (isFlow) void runActiveFlow();
    else void runActiveRequest();
  };
  const cancel = () => {
    if (isFlow) cancelFlow(activeTabId);
  };
  const canSend = isFlow ? hasFlowNodes : !!request && !isWs && requestTargetConfigured(request);
  const canSave = activeKind === "environments"
    || (isFlow && dirty)
    || (activeKind === "request" && (dirty || !relPath));

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic">
        <img src={logo} alt="" className="app-logo" />
        <strong>RequestsMin</strong>
        <Badge tone="idle">API workspace</Badge>
      </div>
      <button type="button" className="search" title="Search everywhere (⌘K)" onClick={() => setCommandOpen(true)}>
        <Icon name="search" size={13} />
        <span>Search requests, collections, commands</span>
        <span style={{ marginLeft: "auto" }} />
        <kbd>⌘K</kbd>
      </button>
      <div className="toolbar">
        {(activeKind === "request" || isFlow) && (
          <ToolButton iconOnly variant="primary" title={isFlow ? "Run flow (⌘↵)" : "Send request (⌘↵)"} aria-label={isFlow ? "Run flow" : "Send request"} disabled={running || !canSend} onClick={send}>
            <Icon name="send" />
          </ToolButton>
        )}
        <ToolButton iconOnly title="New request (⌘N)" aria-label="New request" onClick={() => newRequestTab()}>
          <Icon name="plus" />
        </ToolButton>
        {isFlow && (
          <ToolButton iconOnly variant="danger" title="Cancel flow run" aria-label="Cancel flow run" disabled={!running} onClick={cancel}>
            <Icon name="x" />
          </ToolButton>
        )}
        <ToolButton iconOnly title="Refresh collections" aria-label="Refresh collections" onClick={() => void reloadCollections().then(() => showToast("Refreshed", "Collections reloaded from disk."))}>
          <Icon name="refresh" />
        </ToolButton>
        {(activeKind === "request" || activeKind === "environments" || isFlow) && (
          <ToolButton iconOnly title={activeKind === "environments" ? "Save environment (⌘S)" : isFlow ? "Save flow (⌘S)" : "Save request (⌘S)"} aria-label={activeKind === "environments" ? "Save environment" : isFlow ? "Save flow" : "Save request"} disabled={!canSave} onClick={save}>
            <Icon name="save" />
          </ToolButton>
        )}
        <ToolButton iconOnly title="Toggle theme" aria-label="Toggle theme" onClick={toggleTheme}>
          <Icon name={themeBase(theme) === "dark" ? "sun" : "moon"} />
        </ToolButton>
        <ToolButton iconOnly title="Toggle compact density" aria-label="Toggle compact density" onClick={toggleCompact}>
          <Icon name="rows" />
        </ToolButton>
        <ToolButton iconOnly title="Settings (⌘,)" aria-label="Open settings" onClick={() => openTab("settings")}>
          <Icon name="settings" />
        </ToolButton>
      </div>
    </header>
  );
}
