import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { useApp } from "../../store";
import { api } from "../../lib/api";

type Row = { key: string; value: string };
const toRows = (o: Record<string, string>): Row[] => Object.entries(o).map(([key, value]) => ({ key, value }));
const toRecord = (rows: Row[]): Record<string, string> =>
  Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));

export function EnvironmentsView({ active }: { active: boolean }) {
  const { activeEnv, setActiveEnv, openDialog, openConfirm, showToast, bumpEnv } = useApp(useShallow((s) => ({
    activeEnv: s.activeEnv, setActiveEnv: s.setActiveEnv, openDialog: s.openDialog,
    openConfirm: s.openConfirm, showToast: s.showToast, bumpEnv: s.bumpEnv,
  })));
  const [envs, setEnvs] = useState<string[]>([]);
  const [vars, setVars] = useState<Row[]>([]);
  const [secrets, setSecrets] = useState<Row[]>([]);
  const [showSecrets, setShowSecrets] = useState(false);

  const env = activeEnv;

  useEffect(() => {
    api.envList().then((list) => {
      setEnvs(list);
      if (!env && list.length) setActiveEnv(list[0]);
    }).catch(() => setEnvs([]));
  }, []);

  useEffect(() => {
    if (!env) { setVars([]); setSecrets([]); return; }
    api.envRead(env).then((v) => setVars(toRows(v))).catch(() => setVars([]));
    api.secretRead(env).then((v) => setSecrets(toRows(v))).catch(() => setSecrets([]));
  }, [env]);

  const newEnv = async () => {
    const name = await openDialog({ title: "New environment", message: "e.g. Development, Staging, Production" });
    if (!name?.trim()) return;
    await api.envWrite(name.trim(), {});
    setEnvs((e) => [...e, name.trim()]);
    setActiveEnv(name.trim());
  };

  const deleteEnv = async () => {
    if (!env) return;
    const ok = await openConfirm({ title: "Delete environment", message: `Delete "${env}"? Its variables and local secrets are removed.`, danger: true, confirmLabel: "Delete" });
    if (!ok) return;
    await api.envDelete(env);
    setEnvs((e) => e.filter((x) => x !== env));
    setActiveEnv(null);
  };

  const save = async () => {
    if (!env) return;
    await api.envWrite(env, toRecord(vars));
    await api.secretWrite(env, toRecord(secrets));
    bumpEnv();
    showToast("Saved", `${env} environment saved locally.`);
  };

  useEffect(() => {
    window.addEventListener("requestsmin:save-environment", save);
    return () => window.removeEventListener("requestsmin:save-environment", save);
  });

  const editRow = (rows: Row[], set: (r: Row[]) => void, i: number, patch: Partial<Row>) =>
    set(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = (rows: Row[], set: (r: Row[]) => void) => set([...rows, { key: "", value: "" }]);
  const removeRow = (rows: Row[], set: (r: Row[]) => void, i: number) => set(rows.filter((_, idx) => idx !== i));

  return (
    <section className={`content environments-view ${active ? "active" : ""}`} style={{ overflow: "auto", padding: 18 }}>
      <div className="page-head" style={{ padding: 0, border: 0, marginBottom: 16 }}>
        <div>
          <h1>Environments</h1>
          <p>Shared across the whole app. Variables resolve with {"{{var}}"} syntax at send time. Secrets stay local and are never pushed to GitHub.</p>
        </div>
        <div className="toolbar">
          <select className="method-select" style={{ width: 160 }} value={env ?? ""} onChange={(e) => setActiveEnv(e.target.value || null)}>
            <option value="">select environment…</option>
            {envs.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <ToolButton onClick={newEnv}><Icon name="plus" /> New</ToolButton>
          {env && <ToolButton variant="danger" onClick={deleteEnv}><Icon name="trash" /> Delete</ToolButton>}
          <ToolButton variant="primary" disabled={!env} onClick={save}><Icon name="save" /> Save</ToolButton>
        </div>
      </div>

      {!env && <div className="empty-note">Select or create an environment.</div>}

      {env && (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="panel">
            <h3>Variables</h3>
            <table className="env-table">
              <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
              <tbody>
                {vars.map((r, i) => (
                  <tr key={i}>
                    <td><input value={r.key} onChange={(e) => editRow(vars, setVars, i, { key: e.target.value })} /></td>
                    <td><input value={r.value} onChange={(e) => editRow(vars, setVars, i, { value: e.target.value })} /></td>
                    <td><button type="button" className="tool-btn icon-only" title="Remove variable" aria-label="Remove variable" onClick={() => removeRow(vars, setVars, i)}><Icon name="x" size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="action-btn" style={{ marginTop: 8 }} onClick={() => addRow(vars, setVars)}><Icon name="plus" /> Add variable</button>
          </section>

          <section className="panel">
            <h3 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Secrets (local only)</span>
              <button type="button" className="tool-btn" style={{ height: 24 }} onClick={() => setShowSecrets((s) => !s)}>{showSecrets ? "Hide" : "Show"}</button>
            </h3>
            <table className="env-table">
              <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
              <tbody>
                {secrets.map((r, i) => (
                  <tr key={i}>
                    <td><input value={r.key} onChange={(e) => editRow(secrets, setSecrets, i, { key: e.target.value })} /></td>
                    <td><input type={showSecrets ? "text" : "password"} value={r.value} onChange={(e) => editRow(secrets, setSecrets, i, { value: e.target.value })} /></td>
                    <td><button type="button" className="tool-btn icon-only" title="Remove secret" aria-label="Remove secret" onClick={() => removeRow(secrets, setSecrets, i)}><Icon name="x" size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="action-btn" style={{ marginTop: 8 }} onClick={() => addRow(secrets, setSecrets)}><Icon name="plus" /> Add secret</button>
          </section>
        </div>
      )}
    </section>
  );
}
