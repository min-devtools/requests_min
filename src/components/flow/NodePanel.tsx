import { useEffect } from "react";
import { emptyGrpc, emptyHttp } from "../../lib/api";
import { isRequestNode } from "../../lib/flow/types";
import { isStepKey } from "../../lib/flow/validate";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { SectionVeil } from "../../ui/SectionVeil";
import { RequestView } from "../views/RequestView";
import { confirmDeleteNode } from "./nodeActions";

// Lives inside the right dock (Inspector) as the "Step detail" tab — no overlay, no own resize.
export function NodePanel({ tabId }: { tabId: string }) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);
  const updateRequestTab = useApp((state) => state.updateRequestTab);
  const ensureFlowNodeEditor = useApp((state) => state.ensureFlowNodeEditor);
  const opened = ft?.flow.nodes.find((item) => item.id === ft.panelNodeId);
  // the editor is request-only: delay nodes edit through their on-node modal
  const node = opened && isRequestNode(opened) ? opened : undefined;
  const editorId = node ? `flowreq:${tabId}:${node.id}` : null;
  const stepResult = node ? ft?.run?.steps[node.id] : undefined;

  useEffect(() => {
    if (node && editorId) {
      ensureFlowNodeEditor(editorId, node.config.request, {
        response: stepResult?.response ?? null,
        error: stepResult?.status === "failed" ? stepResult.error ?? null : null,
      });
    }
  }, [editorId, ensureFlowNodeEditor, node, stepResult]);

  if (!ft || !node || !editorId) {
    return (
      <div className="inspector-empty flow-panel-hint">
        Click a request block on the canvas to edit it here.
      </div>
    );
  }

  const updateKey = (key: string) => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    updateFlowTab(tabId, {
      flow: {
        ...current.flow,
        nodes: current.flow.nodes.map((item) => item.id === node.id ? { ...item, key } : item),
      },
    });
  };

  // protocol lives here (the embedded editor drops its own REST/gRPC rail) — flows reject ws, so http/grpc only
  const setProtocol = (protocol: "http" | "grpc") => {
    const cur = useApp.getState().requestTabs[editorId]?.request;
    if (!cur || cur.protocol === protocol || useApp.getState().flowTabs[tabId]?.running) return;
    updateRequestTab(editorId, {
      request: {
        ...cur,
        protocol,
        http: protocol === "http" ? cur.http ?? emptyHttp() : cur.http,
        grpc: protocol === "grpc" ? cur.grpc ?? emptyGrpc() : cur.grpc,
      },
    });
  };

  const keyError = !isStepKey(node.key)
    ? "Lowercase letters, digits and dashes only (e.g. login-request)"
    : ft.flow.nodes.some((item) => item.id !== node.id && item.key === node.key)
      ? "This key is already used by another step"
      : null;

  return (
    <section className="flow-node-panel" aria-label="Selected flow step">
      <div className="flow-node-panel-head">
        <label>
          <span>Key</span>
          <input
            value={node.key}
            disabled={ft.running}
            aria-invalid={keyError !== null}
            onChange={(event) => updateKey(event.target.value)}
          />
        </label>
        <select
          className="method-select flow-proto-select"
          value={node.config.request.protocol}
          disabled={ft.running}
          aria-label="Step protocol"
          onChange={(event) => setProtocol(event.target.value as "http" | "grpc")}
        >
          <option value="http">REST</option>
          <option value="grpc">gRPC</option>
        </select>
        <button
          type="button"
          className="tool-btn icon-only danger"
          title="Delete step"
          aria-label={`Delete step ${node.key}`}
          disabled={ft.running}
          onClick={() => void confirmDeleteNode(tabId, node.id, node.key)}
        >
          <Icon name="trash" />
        </button>
        <button
          type="button"
          className="tool-btn icon-only"
          title="Close step details"
          aria-label="Close step details"
          onClick={() => updateFlowTab(tabId, { panelNodeId: null })}
        >
          <Icon name="x" />
        </button>
      </div>
      {keyError && <div className="flow-key-error">{keyError}</div>}

      {stepResult?.error && <div className="flow-step-error">{stepResult.error}</div>}

      <div className="flow-node-editor">
        <RequestView tabId={editorId} active embedded />
        <SectionVeil on={ft.running} label="Flow running…" />
      </div>
    </section>
  );
}
