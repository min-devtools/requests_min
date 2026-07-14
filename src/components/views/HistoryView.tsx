import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { useApp } from "../../store";

export function HistoryView({ active }: { active: boolean }) {
  const { history, clearHistory, newRequestTab, openConfirm } = useApp();

  const reopen = (index: number) => {
    const entry = history[index];
    if (!entry) return;
    newRequestTab(entry.request.protocol, entry.collectionId);
    const state = useApp.getState();
    const tabId = state.activeTabId;
    state.updateRequestTab(tabId, { request: structuredClone(entry.request) });
  };

  return (
    <section className={`content utility-view ${active ? "active" : ""}`}>
      <header className="page-head">
        <div><div className="eyebrow">Activity</div><h1>Request History</h1><p>The last 100 HTTP and gRPC executions stored on this device.</p></div>
        <ToolButton variant="danger" disabled={!history.length} onClick={async () => {
          if (await openConfirm({ title: "Clear request history", message: "Remove all local request history?", danger: true, confirmLabel: "Clear" })) clearHistory();
        }}><Icon name="trash" /> Clear</ToolButton>
      </header>
      <div className="utility-body">
        {!history.length ? <div className="empty-state"><Icon name="history" size={22} /><strong>No requests run yet</strong><span>Send an HTTP or gRPC request and it will appear here.</span></div> : (
          <div className="table-panel"><table><thead><tr><th>Time</th><th>Protocol</th><th>Request</th><th>Status</th><th>Duration</th><th /></tr></thead><tbody>
            {history.map((entry, index) => <tr key={entry.id} onDoubleClick={() => reopen(index)}>
              <td className="cell-date">{new Date(entry.timestamp).toLocaleString()}</td>
              <td><span className={`method-tag ${entry.request.protocol === "grpc" ? "RPC" : "API"}`}>{entry.request.protocol.toUpperCase()}</span></td>
              <td><strong>{entry.request.name}</strong><small className="row-subtitle">{entry.request.http?.url ?? entry.request.grpc?.endpoint}</small></td>
              <td className={entry.error ? "soft-red" : "soft-green"}>{entry.error ? "failed" : entry.status}</td>
              <td>{entry.timeMs == null ? "—" : `${entry.timeMs}ms`}</td>
              <td><ToolButton onClick={() => reopen(index)}>Open</ToolButton></td>
            </tr>)}
          </tbody></table></div>
        )}
      </div>
    </section>
  );
}
