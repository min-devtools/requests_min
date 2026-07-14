import { ToolButton } from "../ui/ToolButton";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import { runActiveRequest, saveActiveRequest } from "../lib/runRequest";
import logo from "../assets/logo.png";
import { themeBase } from "../lib/themes";

export function Titlebar() {
  const { tabs, activeTabId, requestTabs, setCommandOpen, newRequestTab, toggleTheme, toggleCompact, theme, openTab, reloadCollections, showToast, updateRequestTab } = useApp();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const rt = activeTab?.kind === "request" ? requestTabs[activeTabId] : null;
  const dirty = rt ? JSON.stringify(rt.request) !== rt.original : false;
  const save = () => {
    if (activeTab?.kind === "environments") window.dispatchEvent(new Event("requestsmin:save-environment"));
    else void saveActiveRequest();
  };

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
        <ToolButton iconOnly variant="primary" title="Send request (⌘↵)" aria-label="Send request" disabled={!rt || rt.running || rt.request.protocol === "ws"} onClick={runActiveRequest}>
          <Icon name="send" />
        </ToolButton>
        <ToolButton iconOnly title="New request (⌘N)" aria-label="New request" onClick={() => newRequestTab()}>
          <Icon name="plus" />
        </ToolButton>
        <ToolButton iconOnly variant="danger" title="Cancel request" aria-label="Cancel request" disabled={!rt?.running} onClick={() => rt && updateRequestTab(activeTabId, { running: false })}>
          <Icon name="x" />
        </ToolButton>
        <ToolButton iconOnly title="Refresh collections" aria-label="Refresh collections" onClick={() => void reloadCollections().then(() => showToast("Refreshed", "Collections reloaded from disk."))}>
          <Icon name="refresh" />
        </ToolButton>
        <ToolButton iconOnly title={activeTab?.kind === "environments" ? "Save environment (⌘S)" : "Save request (⌘S)"} aria-label={activeTab?.kind === "environments" ? "Save environment" : "Save request"} disabled={activeTab?.kind === "environments" ? false : !dirty} onClick={save}>
          <Icon name="save" />
        </ToolButton>
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
