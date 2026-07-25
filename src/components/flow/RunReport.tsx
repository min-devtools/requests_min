import { useEffect, useRef, useState } from "react";
import type { GrpcResponse, HttpResponse } from "../../lib/api";
import type { FlowNode, StepResult } from "../../lib/flow/types";
import { isRequestNode, isTransformNode } from "../../lib/flow/types";
import { dagEdges, loopBodyNodes, topoOrder } from "../../lib/flow/validate";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { stepIcon, stepTypeClass } from "./nodeBits";
import { formatNumber, formatDuration } from "../../lib/format";

type Response = HttpResponse | GrpcResponse;

const HEIGHT_KEY = "requestsmin:flow-report-height";

const responseStatus = (response: Response): string => "status" in response
  ? `HTTP ${response.status}`
  : `gRPC ${response.statusCode}`;

const responseStatusClass = (response: Response): string => {
  if ("status" in response) return response.status < 300 ? "ok" : response.status < 500 ? "warn" : "err";
  return response.statusCode === "OK" ? "ok" : "err";
};

export function RunReport({ tabId }: { tabId: string }) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(() => Number(localStorage.getItem(HEIGHT_KEY)) || 0);

  // loop pass pager: each page shows one iteration's body results. Follows the newest pass
  // as it lands until the user picks a page; a fresh run follows again.
  const [page, setPage] = useState(0);
  const [pageText, setPageText] = useState("1");
  const [pinned, setPinned] = useState(false);
  // every loop that ran, not just the first: each body step maps to its own loop's snapshots,
  // and one pager drives them all (each clamped to its own pass count)
  const loopsWithPasses = (ft?.flow.nodes ?? [])
    .map((node) => ({ node, passes: ft?.run?.steps[node.id]?.loopPasses }))
    .filter((entry): entry is { node: FlowNode; passes: Record<string, StepResult>[] } =>
      entry.node.type === "loop" && (entry.passes?.length ?? 0) > 0);
  const pageCount = loopsWithPasses.reduce((max, entry) => Math.max(max, entry.passes.length), 0);
  const runId = ft?.run?.startedAt ?? 0;
  useEffect(() => setPinned(false), [runId]);
  useEffect(() => {
    if (!pinned) setPage(Math.max(0, pageCount - 1));
  }, [pageCount, pinned]);
  useEffect(() => setPageText(String(page + 1)), [page]);

  if (!ft?.run) return null;

  const { flow, run } = ft;
  // loop back-edges would make plain topoOrder bail; the report walks the acyclic remainder
  const order = topoOrder(flow.nodes, dagEdges(flow)) ?? flow.nodes.map((node) => node.id);
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const nodes = order.map((id) => byId.get(id)).filter((node): node is FlowNode => Boolean(node));
  const successCount = nodes.filter((node) => {
    const step = run.steps[node.id];
    return step?.status === "success" && !step.stale;
  }).length;
  const staleCount = nodes.filter((node) => run.steps[node.id]?.stale).length;
  const freshTotal = nodes.length - staleCount;

  // paged rows: loop body steps show the viewed pass's snapshot; everything else shows latest
  const passesByBodyStep = new Map<string, Record<string, StepResult>[]>();
  for (const entry of loopsWithPasses) {
    for (const bodyId of loopBodyNodes(flow, entry.node.id)) passesByBodyStep.set(bodyId, entry.passes);
  }
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const resultFor = (node: FlowNode): StepResult | undefined => {
    const passes = passesByBodyStep.get(node.id);
    // a shorter loop just pins to its own last pass rather than blanking out
    if (passes) return passes[Math.min(safePage, passes.length - 1)]?.[node.id];
    return run.steps[node.id];
  };
  const goToPage = (next: number) => {
    setPinned(true);
    setPage(Math.min(Math.max(0, next), Math.max(0, pageCount - 1)));
  };
  const commitPageText = () => {
    const parsed = Math.floor(Number(pageText.trim()));
    if (Number.isFinite(parsed)) goToPage(parsed - 1);
    else setPageText(String(safePage + 1));
  };

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
    // requests/transforms land on their Step Result (response/time/error); loop & delay produce
    // no result, so their rows open the Step detail tab — where their values now edit inline
    const hasResult = isRequestNode(node) || isTransformNode(node);
    updateFlowTab(tabId, {
      selectedNodeId: node.id,
      panelNodeId: node.id,
      dockTab: hasResult ? "result" : "step",
    });
  };

  return (
    <details className="flow-report" open={run.status !== "running"}>
      <summary>
        <span className={`flow-report-run-status status-${run.status}`}>
          <span className="flow-report-dot" />
          Run {run.status}
        </span>
        <span>{run.totalMs != null ? formatDuration(run.totalMs, true) : "In progress"}</span>
        <span className={successCount === freshTotal ? "flow-report-count all-ok" : "flow-report-count"}>
          {formatNumber(successCount)}/{formatNumber(freshTotal)} steps successful{staleCount > 0 ? ` · ${formatNumber(staleCount)} stale` : ""}
        </span>
        {pageCount > 1 && (
          <span className="flow-report-pager" aria-label="Loop pass pages">
            <button
              type="button"
              aria-label="Previous pass"
              title="Previous pass"
              disabled={safePage <= 0}
              onClick={() => goToPage(safePage - 1)}
            >
              <Icon name="chevron-left" size={12} />
            </button>
            <input
              value={pageText}
              aria-label="Pass number"
              title="Type a pass number and press Enter"
              inputMode="numeric"
              onChange={(event) => setPageText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPageText();
                }
              }}
              onBlur={commitPageText}
            />
            <span className="flow-report-pager-total">/ {formatNumber(pageCount)} passes</span>
            <button
              type="button"
              aria-label="Next pass"
              title="Next pass"
              disabled={safePage >= pageCount - 1}
              onClick={() => goToPage(safePage + 1)}
            >
              <Icon name="chevron-right" size={12} />
            </button>
          </span>
        )}
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
            const result = resultFor(node);
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
                <Icon name={stepIcon(node)} size={13} className={`flow-report-type flow-report-type-${stepTypeClass(node)}`} />
                <span className="flow-report-key">{node.key}</span>
                <span className="flow-report-status">{result?.status ?? "idle"}</span>
                <span>{result?.timeMs != null ? formatDuration(result.timeMs, true) : "—"}</span>
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
