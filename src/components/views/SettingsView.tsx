import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { useApp } from "../../store";
import { api, type GhStatus } from "../../lib/api";
import { DEFAULT_REPO } from "../../lib/ghSync";
import { THEMES, themeBase } from "../../lib/themes";

export function SettingsView({ active }: { active: boolean }) {
  const { theme, setTheme, compact, toggleCompact, vimMode, toggleVimMode, uiFontSize, changeUiFontSize, resetUiFontSize, uiFont, editorFont, setUiFont, setEditorFont, aiEndpoint, aiModel, aiApiKey, setAiSettings, showToast } = useApp(useShallow((s) => ({
    theme: s.theme, setTheme: s.setTheme, compact: s.compact, toggleCompact: s.toggleCompact,
    vimMode: s.vimMode, toggleVimMode: s.toggleVimMode, uiFontSize: s.uiFontSize, changeUiFontSize: s.changeUiFontSize,
    resetUiFontSize: s.resetUiFontSize, uiFont: s.uiFont, editorFont: s.editorFont, setUiFont: s.setUiFont,
    setEditorFont: s.setEditorFont, aiEndpoint: s.aiEndpoint, aiModel: s.aiModel, aiApiKey: s.aiApiKey,
    setAiSettings: s.setAiSettings, showToast: s.showToast,
  })));
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [aiEndpointDraft, setAiEndpointDraft] = useState(aiEndpoint);
  const [aiModelDraft, setAiModelDraft] = useState(aiModel);
  const [aiKeyDraft, setAiKeyDraft] = useState(aiApiKey);
  const [fonts, setFonts] = useState<string[]>([]);

  const refresh = () => api.ghStatus().then((s) => { setGh(s); setRepo(s.repo ?? DEFAULT_REPO); }).catch(() => setGh(null));
  useEffect(() => { void refresh(); void api.listFonts().then(setFonts).catch(() => setFonts([])); }, []);

  const saveToken = async () => {
    if (!token.trim()) return;
    try {
      await api.ghSetToken(token.trim());
      setToken("");
      showToast("Token saved", "Stored locally — never exported or pushed.");
      await refresh();
    } catch (err) {
      showToast("Failed to save token", String(err), "err");
    }
  };

  const saveRepo = async () => {
    if (!repo.trim()) return;
    try {
      await api.ghConfigure(repo.trim());
      showToast("Repository configured", repo.trim());
      await refresh();
    } catch (err) {
      showToast("Failed to configure repo", String(err), "err");
    }
  };

  return (
    <section className={`content settings-view ${active ? "active" : ""}`}>
      <div className="settings-shell">
        <div className="settings-header">
          <h2>Settings</h2>
          <p style={{ margin: 0, color: "var(--text-3)", fontSize: "0.9231rem" }}>Appearance, GitHub sync, and keyboard shortcuts for this workspace.</p>
        </div>

        <section className="settings-card">
          <h3>Appearance</h3>
          <div className="settings-row">
            <span className="settings-icon"><Icon name={themeBase(theme) === "dark" ? "moon" : "sun"} size={15} /></span>
            <div className="settings-copy"><strong>Theme</strong><span>Palette applies across the workspace and JSON editor.</span></div>
            <div className="settings-control">
              <select className="settings-select" value={theme} onChange={(event) => setTheme(event.target.value)}><optgroup label="Dark">{THEMES.filter((item) => item.base === "dark").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup><optgroup label="Light">{THEMES.filter((item) => item.base === "light").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup></select>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="braces" size={15} /></span>
            <div className="settings-copy"><strong>Interface font size</strong><span>Scales all interface text in 0.5px steps. Current: {uiFontSize}px.</span></div>
            <div className="settings-control" style={{ gap: 6 }}>
              <ToolButton iconOnly title="Decrease interface font (⌘−)" onClick={() => changeUiFontSize(-1)}>−</ToolButton>
              <ToolButton onClick={resetUiFontSize}>{uiFontSize}px</ToolButton>
              <ToolButton iconOnly title="Increase interface font (⌘+)" onClick={() => changeUiFontSize(1)}>+</ToolButton>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="rows" size={15} /></span>
            <div className="settings-copy"><strong>Interface font family</strong><span>Applied across the workspace and saved on this device.</span></div>
            <div className="settings-control"><select className="settings-select" value={uiFont} style={uiFont ? { fontFamily: `"${uiFont}"` } : undefined} onChange={(event) => setUiFont(event.target.value)}><option value="">Design default</option>{fonts.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}"` }}>{font}</option>)}</select></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="braces" size={15} /></span>
            <div className="settings-copy"><strong>Editor font family</strong><span>Applied to JSON and request editors.</span></div>
            <div className="settings-control"><select className="settings-select" value={editorFont} style={editorFont ? { fontFamily: `"${editorFont}"` } : undefined} onChange={(event) => setEditorFont(event.target.value)}><option value="">Design default</option>{fonts.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}"` }}>{font}</option>)}</select></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="rows" size={15} /></span>
            <div className="settings-copy"><strong>Compact density</strong><span>Use the same dense data layout available in ElasticMin.</span></div>
            <div className="settings-control"><label className="switch"><input type="checkbox" checked={compact} onChange={toggleCompact} /><span /></label></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="keyboard" size={15} /></span>
            <div className="settings-copy"><strong>Vim mode</strong><span>Modal editing via monaco-vim in the query editor. Toggle also lives in the editor footer.</span></div>
            <div className="settings-control"><label className="switch"><input type="checkbox" checked={vimMode} onChange={() => { toggleVimMode(); showToast("Vim mode", vimMode ? "Disabled." : "Enabled — NORMAL mode in query editor."); }} /><span /></label></div>
          </div>
        </section>

        <section className="settings-card">
          <h3>AI provider</h3>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="globe" size={15} /></span>
            <div className="settings-copy"><strong>Endpoint</strong><span>OpenAI-compatible API base URL used by AI Import.</span></div>
            <div className="settings-control"><input className="settings-select" value={aiEndpointDraft} onChange={(e) => setAiEndpointDraft(e.target.value)} /></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="braces" size={15} /></span>
            <div className="settings-copy"><strong>Model</strong><span>Model used to infer requests from selected source files.</span></div>
            <div className="settings-control"><input className="settings-select" value={aiModelDraft} onChange={(e) => setAiModelDraft(e.target.value)} /></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="key" size={15} /></span>
            <div className="settings-copy"><strong>API key</strong><span>Stored only in this app profile on the current device.</span></div>
            <div className="settings-control" style={{ gap: 6 }}>
              <input type="password" className="settings-select" placeholder="sk-…" value={aiKeyDraft} onChange={(e) => setAiKeyDraft(e.target.value)} />
              <ToolButton onClick={() => { setAiSettings({ endpoint: aiEndpointDraft.trim(), model: aiModelDraft.trim(), apiKey: aiKeyDraft.trim() }); showToast("AI provider saved", `${aiModelDraft.trim()} · ${aiEndpointDraft.trim()}`); }}>Save</ToolButton>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <h3>GitHub collections</h3>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="key" size={15} /></span>
            <div className="settings-copy"><strong>Personal access token</strong><span>Stored locally only. Needs repo scope to push/pull collections.</span></div>
            <div className="settings-control" style={{ gap: 6 }}>
              <input type="password" className="settings-select" style={{ width: 180 }} placeholder="ghp_…" value={token} onChange={(e) => setToken(e.target.value)} />
              <ToolButton onClick={saveToken}>Save</ToolButton>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="github" size={15} /></span>
            <div className="settings-copy"><strong>Repository</strong><span>Single repo used as JSON storage for all collections, e.g. you/api-collections.</span></div>
            <div className="settings-control" style={{ gap: 6 }}>
              <input className="settings-select" style={{ width: 180 }} placeholder={DEFAULT_REPO} value={repo} onChange={(e) => setRepo(e.target.value)} />
              <ToolButton onClick={saveRepo}>Save</ToolButton>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="check" size={15} /></span>
            <div className="settings-copy"><strong>Status</strong><span>{gh?.connected ? `Connected as ${gh.login}` : "Not connected"}{gh?.lastSha ? ` · last sync ${gh.lastSha.slice(0, 7)}` : ""}</span></div>
            <div className="settings-control" />
          </div>
        </section>

        <section className="settings-card">
          <h3>Shortcuts</h3>
          <div className="shortcut-grid">
            <div className="shortcut-row"><span>Command palette</span><span className="kbd">⌘K</span></div>
            <div className="shortcut-row"><span>New request</span><span className="kbd">⌘N</span></div>
            <div className="shortcut-row"><span>Save request</span><span className="kbd">⌘S</span></div>
            <div className="shortcut-row"><span>Send request</span><span className="kbd">⌘↵</span></div>
            <div className="shortcut-row"><span>Toggle sidebar</span><span className="kbd">⌘B</span></div>
            <div className="shortcut-row"><span>Toggle inspector</span><span className="kbd">⌘R</span></div>
            <div className="shortcut-row"><span>Close tab</span><span className="kbd">⌘W</span></div>
            <div className="shortcut-row"><span>Switch tab 1…9</span><span className="kbd">⌘1…9</span></div>
            <div className="shortcut-row"><span>Next / previous tab</span><span className="kbd">⌘⇧] / ⌘⇧[</span></div>
            <div className="shortcut-row"><span>Increase font</span><span className="kbd">⌘+</span></div>
            <div className="shortcut-row"><span>Decrease font</span><span className="kbd">⌘−</span></div>
            <div className="shortcut-row"><span>Open settings</span><span className="kbd">⌘,</span></div>
          </div>
        </section>

        <section className="settings-card">
          <h3>Data</h3>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="database" size={15} /></span>
            <div className="settings-copy"><strong>Collections</strong><span>Stored on disk under ~/RequestsMin (collections/, environments/). Right-click a collection in the sidebar to edit or remove it.</span></div>
            <div className="settings-control" />
          </div>
        </section>
        <div className="settings-credit">
          <a className="settings-github" href="https://github.com/min-devtools/requests_min" target="_blank" rel="noreferrer"><Icon name="github" size={15} /> View on GitHub</a>
          <strong>RequestsMin</strong>
          <a className="settings-credit-link" href="https://www.linkedin.com/in/ngthminh-dev/" target="_blank" rel="noreferrer">Created by @ngthminhdev</a>
        </div>
      </div>
    </section>
  );
}
