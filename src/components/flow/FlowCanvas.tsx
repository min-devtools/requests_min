import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getSmoothStepPath,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../../lib/api";
import {
  commitNodePositions,
  createRequestFlowNode,
  parseRequestDropPayload,
  removeGraphElements,
} from "../../lib/flow/canvas";
import type { FlowEdge, FlowNode } from "../../lib/flow/types";
import { isRequestNode, isTransformNode } from "../../lib/flow/types";
import { themeBase } from "../../lib/themes";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { DelayNode, type DelayCanvasNode } from "./DelayNode";
import { RequestNode, type RequestCanvasNode } from "./RequestNode";
import { TransformNode, type TransformCanvasNode } from "./TransformNode";

// request & transform nodes open the dock editor on click; delay edits in its own modal
const opensDock = (node: FlowNode): boolean => isRequestNode(node) || isTransformNode(node);

type CanvasNode = RequestCanvasNode | DelayCanvasNode | TransformCanvasNode;
type CanvasEdge = Edge<{ tabId: string }, "flow">;

const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const;

function FlowEdgeView({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, data,
}: EdgeProps<CanvasEdge>) {
  // orthogonal routing: right-angle segments with lightly rounded corners instead of curvy bezier
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 8 });
  const removeEdge = () => {
    const tabId = data?.tabId;
    const current = tabId ? useApp.getState().flowTabs[tabId] : undefined;
    if (!tabId || !current || current.running) return;
    const graph = removeGraphElements(current.flow.nodes, current.flow.edges, new Set(), new Set([id]));
    useApp.getState().updateFlowTab(tabId, { flow: { ...current.flow, ...graph } });
  };
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="flow-edge-delete nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title="Delete connection"
            aria-label="Delete connection"
            onClick={removeEdge}
          >
            <Icon name="x" size={11} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { request: RequestNode, delay: DelayNode, transform: TransformNode };
const edgeTypes = { flow: FlowEdgeView };
const nextElementId = (prefix: "n" | "e") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const toCanvasNode = (
  tabId: string,
  node: FlowNode,
  status: "idle" | "running" | "success" | "failed" | "skipped",
  stale: boolean,
  selected: boolean,
  onRunNode?: (nodeId: string) => void,
): CanvasNode => {
  if (node.type === "request") {
    return { id: node.id, type: "request", position: node.position, selected, data: { node, status, stale, tabId, onRun: onRunNode } };
  }
  if (node.type === "transform") {
    return { id: node.id, type: "transform", position: node.position, selected, data: { node, status, stale, tabId } };
  }
  return { id: node.id, type: "delay", position: node.position, selected, data: { node, status, stale, tabId } };
};

const toFlowEdge = (edge: CanvasEdge): FlowEdge => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  sourceHandle: edge.sourceHandle ?? undefined,
});

function Canvas({
  tabId,
  active,
  onRunNode,
}: {
  tabId: string;
  active: boolean;
  onRunNode?: (nodeId: string) => void;
}) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);
  const showToast = useApp((state) => state.showToast);
  const theme = useApp((state) => state.theme);
  const { fitView, getNodes, screenToFlowPosition } = useReactFlow<CanvasNode, CanvasEdge>();
  const updateNodeInternals = useUpdateNodeInternals();

  const storeNodes = useMemo<CanvasNode[]>(() => ft.flow.nodes.map((node) => toCanvasNode(
    tabId,
    node,
    ft.run?.steps[node.id]?.status ?? "idle",
    ft.run?.steps[node.id]?.stale ?? false,
    ft.selectedNodeId === node.id,
    onRunNode,
  )), [ft.flow.nodes, ft.run, ft.selectedNodeId, onRunNode, tabId]);
  const storeEdges = useMemo<CanvasEdge[]>(() => ft.flow.edges.map((edge) => ({
    ...edge,
    type: "flow" as const,
    data: { tabId },
    markerEnd: EDGE_MARKER,
    animated: ft.run?.steps[edge.source]?.status === "success"
      && ft.run?.steps[edge.target]?.status === "running",
  })), [ft.flow.edges, ft.run, tabId]);

  const [nodes, setNodes] = useState<CanvasNode[]>(storeNodes);
  const [edges, setEdges] = useState<CanvasEdge[]>(storeEdges);

  useEffect(() => setNodes(storeNodes), [storeNodes]);
  useEffect(() => setEdges(storeEdges), [storeEdges]);

  const wasActive = useRef(false);
  useEffect(() => {
    if (!active) {
      wasActive.current = false;
      return;
    }
    if (wasActive.current) return;
    wasActive.current = true;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const nodeIds = getNodes().map((node) => node.id);
        if (nodeIds.length > 0) updateNodeInternals(nodeIds);
        void fitView({ padding: 0.2, duration: 120 });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [active, fitView, getNodes, updateNodeInternals]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const current = useApp.getState().flowTabs[tabId];
    const running = current?.running ?? true;
    const allowedChanges = running
      ? changes.filter((change) => change.type === "select" || change.type === "dimensions")
      : changes;
    setNodes((current) => applyNodeChanges(allowedChanges, current));

    if (!current) return;
    const removedNodeIds = new Set(
      running
        ? []
        : changes.filter((change) => change.type === "remove").map((change) => change.id),
    );
    let selectedNodeId = current.selectedNodeId;
    for (const change of changes) {
      if (change.type !== "select") continue;
      if (change.selected) selectedNodeId = change.id;
      else if (selectedNodeId === change.id) selectedNodeId = null;
    }
    if (selectedNodeId && removedNodeIds.has(selectedNodeId)) selectedNodeId = null;

    if (removedNodeIds.size > 0) {
      const graph = removeGraphElements(
        current.flow.nodes,
        current.flow.edges,
        removedNodeIds,
        new Set(),
      );
      updateFlowTab(tabId, {
        flow: { ...current.flow, ...graph },
        selectedNodeId,
      });
    } else if (selectedNodeId !== current.selectedNodeId) {
      // clicking a request/transform block opens (or retargets) its detail dock; a delay/nothing leaves the dock as-is
      const selected = selectedNodeId ? current.flow.nodes.find((node) => node.id === selectedNodeId) : undefined;
      const panelNodeId = selected && opensDock(selected) ? selected.id : current.panelNodeId;
      updateFlowTab(tabId, { selectedNodeId, panelNodeId, dockTab: "step" });
    }
  }, [tabId, updateFlowTab]);

  const onNodeDragStop = useCallback((_: MouseEvent | TouchEvent, node: CanvasNode, draggedNodes: CanvasNode[]) => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    const nextNodes = commitNodePositions(
      current.flow.nodes,
      draggedNodes.length > 0 ? draggedNodes : [node],
    );
    if (nextNodes === current.flow.nodes) return;
    updateFlowTab(tabId, {
      flow: { ...current.flow, nodes: nextNodes },
    });
  }, [tabId, updateFlowTab]);

  const onEdgesChange = useCallback((changes: EdgeChange<CanvasEdge>[]) => {
    const current = useApp.getState().flowTabs[tabId];
    const running = current?.running ?? true;
    const allowedChanges = running
      ? changes.filter((change) => change.type === "select")
      : changes;
    const nextEdges = applyEdgeChanges(allowedChanges, edges);
    setEdges(nextEdges);
    if (running || !changes.some((change) => change.type === "remove")) return;

    if (!current) return;
    const removedEdgeIds = new Set(
      changes.filter((change) => change.type === "remove").map((change) => change.id),
    );
    const graph = removeGraphElements(
      current.flow.nodes,
      current.flow.edges,
      new Set(),
      removedEdgeIds,
    );
    updateFlowTab(tabId, { flow: { ...current.flow, ...graph } });
  }, [edges, tabId, updateFlowTab]);

  const onConnect = useCallback((connection: Connection) => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    const nextEdges = addEdge<CanvasEdge>({
      ...connection,
      id: nextElementId("e"),
      type: "flow",
      data: { tabId },
      markerEnd: EDGE_MARKER,
    }, edges);
    setEdges(nextEdges);
    updateFlowTab(tabId, {
      flow: { ...current.flow, edges: nextEdges.map(toFlowEdge) },
    });
  }, [edges, tabId, updateFlowTab]);

  const onDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    const screenPosition = { x: event.clientX, y: event.clientY };
    const position = screenToFlowPosition(screenPosition);
    const rawPayload = event.dataTransfer.getData("application/json");

    let payload;
    try {
      payload = parseRequestDropPayload(rawPayload);
    } catch (error) {
      showToast("Request drop failed", String(error), "err");
      return;
    }

    const beforeRead = useApp.getState().flowTabs[tabId];
    if (!beforeRead) return;
    if (beforeRead.running) {
      showToast("Flow is running", "Wait for the run to finish before changing the graph.", "warn");
      return;
    }

    try {
      const request = await api.reqRead(payload.collectionId, payload.relPath);
      const current = useApp.getState().flowTabs[tabId];
      if (!current) return;
      if (current.running) {
        showToast("Flow is running", "The dropped request was not added.", "warn");
        return;
      }
      const node = createRequestFlowNode({
        id: nextElementId("n"),
        request,
        origin: { collectionId: payload.collectionId, relPath: payload.relPath },
        position,
        takenKeys: new Set(current.flow.nodes.map((item) => item.key)),
      });
      updateFlowTab(tabId, {
        flow: { ...current.flow, nodes: [...current.flow.nodes, node] },
        selectedNodeId: node.id,
        // open the new block's detail dock right away instead of waiting for a click
        panelNodeId: node.id,
        dockTab: "step",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/WebSocket requests/i.test(message)) {
        showToast("WebSocket not supported", message, "warn");
      } else {
        showToast("Request drop failed", message, "err");
      }
    }
  }, [screenToFlowPosition, showToast, tabId, updateFlowTab]);

  return (
    <ReactFlow<CanvasNode, CanvasEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      isValidConnection={(connection) => connection.source !== connection.target}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onDrop={(event) => void onDrop(event)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onPaneClick={() => updateFlowTab(tabId, { selectedNodeId: null })}
      onNodeDoubleClick={(_, canvasNode) => {
        // single-click already opens the dock; double-click stays as an explicit open for request nodes
        const current = useApp.getState().flowTabs[tabId];
        const flowNode = current?.flow.nodes.find((item) => item.id === canvasNode.id);
        if (flowNode && opensDock(flowNode)) {
          updateFlowTab(tabId, { panelNodeId: flowNode.id, selectedNodeId: flowNode.id, dockTab: "step" });
        }
      }}
      nodesDraggable={!ft.running}
      nodesConnectable={!ft.running}
      edgesReconnectable={false}
      deleteKeyCode={ft.running ? null : ["Backspace", "Delete"]}
      colorMode={themeBase(theme)}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={2}
    >
      <Background gap={16} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function FlowCanvas(props: {
  tabId: string;
  active: boolean;
  onRunNode?: (nodeId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
