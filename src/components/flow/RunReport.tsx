import { useRef, useState } from "react";
import type { GrpcResponse, HttpResponse } from "../../lib/api";
import type { FlowNode } from "../../lib/flow/types";
import { isRequestNode, isTransformNode } from "../../lib/flow/types";
import { topoOrder } from "../../lib/flow/validate";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";

type Response = HttpResponse | GrpcResponse;

const HEIGHT_KEY = "requestsmin:flow-report-height";

const responseStatus = (response: Response): string => "status" in response
  ? `HTTP ${response.status}`
  : `gRPC ${response.statusCode}`;

const responseStatusClass = (response: Response): string => {
  if ("status" in response) return response.status < 300 ? "ok" : response.status < 500 ? "warn" : "err";
  return response.statusCode === "OK" ? "ok" : "err";
};

const responseIcon = (node: FlowNode): "timer" | "grpc" | "request" | "braces" => {
  if (node.type === "delay") return "timer";
  if (node.type === "transform") return "braces";
  return node.config.request.protocol === "grpc" ? "grpc" : "request";
};

export function RunReport({ tabId }: { tabId: string }) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(() => Number(localStorage.getItem(HEIGHT_KEY)) || 0);
  if (!ft?.run) return null;

  const { flow, run } = ft;
  const order = topoOrder(flow.nodes, flow.edges) ?? flow.nodes.map((node) => node.id);
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const nodes = order.map((id) => byId.get(id)).filter((node): node is FlowNode => Boolean(node));
  const successCount = nodes.filter((node) => {
    const step = run.steps[node.id];
    return step?.status === "success" && !step.stale;
  }).length;
  const staleCount = nodes.filter((node) => run.steps[node.id]?.stale).length;
  const freshTotal = nodes.length - staleCount;

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const content = contentRef.current;
      if (!content) return;
      const next = Math.min(
        Math.max(120, content.getBoundingClientRect().bottom - move.clientY),
        Math.round(window.innerHeight * 0.7),
      );
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setHeight((final) => {
        if (final) localStorage.setItem(HEIGHT_KEY, String(Math.round(final)));
        return final;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const openStep = (node: FlowNode) => {
    // request steps jump to the Step Result tab (response/time/error); delay steps just highlight
    updateFlowTab(tabId, {
      selectedNodeId: node.id,
      panelNodeId: isRequestNode(node) || isTransformNode(node) ? node.id : ft.panelNodeId,
      dockTab: "result",
    });
  };

  return (
    <details className="flow-report" open={run.status !== "running"}>
      <summary>
        <span className={`flow-report-run-status status-${run.status}`}>
          <span className="flow-report-dot" />
          Run {run.status}
        </span>
        <span>{run.totalMs != null ? `${run.totalMs} ms` : "In progress"}</span>
        <span className={successCount === freshTotal ? "flow-report-count all-ok" : "flow-report-count"}>
          {successCount}/{freshTotal} steps successful{staleCount > 0 ? ` · ${staleCount} stale` : ""}
        </span>
      </summary>
      <div
        className="flow-report-content"
        ref={contentRef}
        style={height ? { height: `${height}px`, maxHeight: "none" } : undefined}
      >
        <div className="flow-report-resize" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize run report" />
        <div className="flow-report-head" aria-hidden="true">
          <span />
          <span>Step</span>
          <span>Status</span>
          <span>Time</span>
          <span>Detail</span>
        </div>
        <div className="flow-report-steps" aria-label="Flow run steps">
          {nodes.map((node) => {
            const result = run.steps[node.id];
            const response = result?.response;
            const detail = result?.error ?? (response ? responseStatus(response) : "");
            return (
              <button
                type="button"
                className={`flow-report-row status-${result?.status ?? "idle"}${result?.stale ? " is-stale" : ""}`}
                key={node.id}
                onClick={() => openStep(node)}
                aria-label={`Open ${node.key}, ${result?.status ?? "idle"}${result?.stale ? " (stale)" : ""}`}
              >
                <Icon name={responseIcon(node)} size={13} />
                <span className="flow-report-key">{node.key}</span>
                <span className="flow-report-status">{result?.status ?? "idle"}</span>
                <span>{result?.timeMs != null ? `${result.timeMs} ms` : "—"}</span>
                <span className="flow-report-detail" title={detail}>
                  {result?.error
                    ? detail
                    : response
                      ? <span className={`flow-report-code ${responseStatusClass(response)}`}>{responseStatus(response)}</span>
                      : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}
