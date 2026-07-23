import type { GrpcPart, GrpcResponse, HttpResponse, Request } from "../api";
import { buildStepCtx, substituteRequest } from "./stepRefs.ts";
import { runTransformCode } from "./transform.ts";
import type { Flow, FlowRun, StepResult } from "./types.ts";
import { topoOrder, validateFlow } from "./validate.ts";

type Response = HttpResponse | GrpcResponse;

export interface FlowExecutorTab {
  flow: Flow;
  run: FlowRun | null;
  running: boolean;
}

export interface FlowExecutorDependencies {
  getFlowTab: (tabId: string) => FlowExecutorTab | undefined;
  getActiveEnv: () => string | null;
  updateFlowTab: (
    tabId: string,
    patch: { run?: FlowRun | null; running?: boolean },
  ) => void;
  showToast: (title: string, body?: string, kind?: "ok" | "warn" | "err") => void;
  httpRequest: (env: string | null, request: Request) => Promise<HttpResponse>;
  grpcUnary: (env: string | null, part: GrpcPart) => Promise<GrpcResponse>;
  mirrorResponse?: (tabId: string, nodeId: string, response: Response) => void;
  addHistory?: (entry: {
    collectionId: string | null;
    request: Request;
    response: Response | null;
    status: string;
    timeMs: number | null;
    error: string | null;
  }) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FlowExecutor {
  runFlow: (tabId: string, onlyNodeId?: string) => Promise<void>;
  cancelFlow: (tabId: string) => void;
}

interface RunToken {
  cancelled: boolean;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const ancestorsOf = (flow: Flow, nodeId: string): Set<string> => {
  const incoming = new Map<string, string[]>();
  for (const edge of flow.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }

  const ancestors = new Set<string>();
  const pending = [...(incoming.get(nodeId) ?? [])];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    pending.push(...(incoming.get(id) ?? []));
  }
  return ancestors;
};

const responseFailure = (response: Response): string | undefined => {
  if ("status" in response) {
    return response.status < 400 ? undefined : `Request returned HTTP ${response.status}`;
  }
  return response.statusCode === "OK"
    ? undefined
    : `Request returned gRPC ${response.statusCode}`;
};

export function createFlowExecutor(dependencies: FlowExecutorDependencies): FlowExecutor {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep
    ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const activeRuns = new Map<string, RunToken>();

  const cancelFlow = (tabId: string): void => {
    const token = activeRuns.get(tabId);
    if (token) token.cancelled = true;
  };

  const waitForDelay = async (ms: number, token: RunToken): Promise<void> => {
    let remaining = ms;
    while (remaining > 0 && !token.cancelled) {
      const slice = Math.min(100, remaining);
      await sleep(slice);
      remaining -= slice;
    }
  };

  const runFlow = async (tabId: string, onlyNodeId?: string): Promise<void> => {
    const sourceTab = dependencies.getFlowTab(tabId);
    if (!sourceTab || sourceTab.running || activeRuns.has(tabId)) return;

    let flow: Flow;
    let previousRun: FlowRun | null;
    try {
      flow = structuredClone(sourceTab.flow);
      previousRun = sourceTab.run ? structuredClone(sourceTab.run) : null;
    } catch (error) {
      dependencies.showToast("Flow invalid", errorMessage(error), "err");
      return;
    }

    const errors = validateFlow(flow).filter((issue) => issue.level === "error");
    if (errors.length > 0) {
      dependencies.showToast(
        "Flow invalid",
        errors.map((issue) => issue.message).join(" · "),
        "err",
      );
      return;
    }

    const order = topoOrder(flow.nodes, flow.edges);
    if (!order) {
      dependencies.showToast("Flow invalid", "Flow has no deterministic execution order", "err");
      return;
    }

    if (onlyNodeId && !flow.nodes.some((node) => node.id === onlyNodeId)) {
      dependencies.showToast(
        "Flow step not found",
        `Cannot run missing node "${onlyNodeId}".`,
        "err",
      );
      return;
    }

    const token: RunToken = { cancelled: false };
    activeRuns.set(tabId, token);

    const steps: FlowRun["steps"] = {};
    if (onlyNodeId) {
      // Successful ancestors stay usable as {{steps.*}} sources; everything else is
      // carried over stale so the last run's statuses stay visible but unreferencable.
      const ancestors = ancestorsOf(flow, onlyNodeId);
      for (const nodeId of order) {
        if (nodeId === onlyNodeId) continue;
        const previous = previousRun?.steps[nodeId];
        if (!previous) continue;
        steps[nodeId] = ancestors.has(nodeId) && previous.status === "success"
          ? structuredClone(previous)
          : { ...structuredClone(previous), stale: true };
      }
    } else {
      for (const node of flow.nodes) steps[node.id] = { status: "idle" };
    }

    const startedAt = now();
    const run: FlowRun = { startedAt, status: "running", steps };
    const env = dependencies.getActiveEnv();
    const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
    const push = (running: boolean): void => {
      dependencies.updateFlowTab(tabId, { run: structuredClone(run), running });
    };

    // Execute one node: resolve refs, call the backend, record the result. Gating (skip / when to
    // start) is the scheduler's job below — this just runs whatever node it's handed.
    const runNode = async (nodeId: string): Promise<void> => {
      const node = nodes.get(nodeId)!;
      run.steps[nodeId] = { status: "running" };
      push(true);
      const stepStartedAt = now();
      let resolvedRequest: Request | undefined;
      try {
        if (node.type === "delay") {
          await waitForDelay(node.config.ms, token);
          run.steps[nodeId] = {
            status: token.cancelled ? "skipped" : "success",
            timeMs: now() - stepStartedAt,
          };
        } else if (node.type === "transform") {
          // no network: inline {{steps.*}} refs into the script, run it, capture its return
          const output = runTransformCode(node.config.code, buildStepCtx(flow, run));
          run.steps[nodeId] = {
            status: "success",
            timeMs: now() - stepStartedAt,
            output,
          };
        } else {
          resolvedRequest = substituteRequest(node.config.request, buildStepCtx(flow, run));
          let response: Response;
          if (resolvedRequest.protocol === "grpc") {
            if (!resolvedRequest.grpc) {
              throw new Error(`Step "${node.key}": Missing gRPC request configuration`);
            }
            response = await dependencies.grpcUnary(env, resolvedRequest.grpc);
          } else if (resolvedRequest.protocol === "http") {
            if (!resolvedRequest.http) {
              throw new Error(`Step "${node.key}": Missing HTTP request configuration`);
            }
            response = await dependencies.httpRequest(env, resolvedRequest);
          } else {
            throw new Error(`Step "${node.key}": Unsupported request protocol`);
          }

          const failure = responseFailure(response);
          run.steps[nodeId] = {
            status: failure ? "failed" : "success",
            timeMs: now() - stepStartedAt,
            resolvedRequest,
            response,
            error: failure,
          };
          dependencies.mirrorResponse?.(tabId, nodeId, response);
          dependencies.addHistory?.({
            collectionId: node.config.origin?.collectionId ?? null,
            request: structuredClone(resolvedRequest),
            response,
            status: "status" in response ? String(response.status) : response.statusCode,
            timeMs: response.timeMs,
            error: null,
          });
        }
      } catch (error) {
        const failed: StepResult = {
          status: "failed",
          timeMs: now() - stepStartedAt,
          resolvedRequest,
          error: errorMessage(error),
        };
        run.steps[nodeId] = failed;
        if (node.type === "request") {
          dependencies.addHistory?.({
            collectionId: node.config.origin?.collectionId ?? null,
            request: structuredClone(resolvedRequest ?? node.config.request),
            response: null,
            status: "failed",
            timeMs: null,
            error: failed.error ?? null,
          });
        }
      }
      push(true);
    };

    // Parallel DAG scheduler: a node starts as soon as every parent has settled, so independent
    // branches run concurrently. A node is skipped when a parent it depends on failed (unless that
    // parent is onError:"continue") or the run was cancelled — that scopes failures to descendants.
    const parentsOf = new Map<string, string[]>(flow.nodes.map((node) => [node.id, []]));
    const childrenOf = new Map<string, string[]>(flow.nodes.map((node) => [node.id, []]));
    for (const graphEdge of flow.edges) {
      parentsOf.get(graphEdge.target)?.push(graphEdge.source);
      childrenOf.get(graphEdge.source)?.push(graphEdge.target);
    }
    const remainingParents = new Map<string, number>(
      flow.nodes.map((node) => [node.id, parentsOf.get(node.id)!.length]),
    );
    const blockedBy = (nodeId: string): boolean => parentsOf.get(nodeId)!.some((parentId) => {
      const status = run.steps[parentId]?.status;
      if (status === "success") return false;
      const parent = nodes.get(parentId);
      // a failed parent set to "continue" doesn't block — downstream {{refs}} just resolve empty
      if (status === "failed" && parent?.type === "request" && parent.config.onError === "continue") return false;
      return true;
    });

    const launched = new Set<string>();
    const pending: Promise<void>[] = [];
    const launch = (nodeId: string): void => {
      if (launched.has(nodeId)) return;
      launched.add(nodeId);
      pending.push((async () => {
        if (token.cancelled || blockedBy(nodeId)) {
          run.steps[nodeId] = { status: "skipped" };
          push(true);
        } else {
          await runNode(nodeId);
        }
        for (const child of childrenOf.get(nodeId)!) {
          remainingParents.set(child, remainingParents.get(child)! - 1);
          if (remainingParents.get(child) === 0) launch(child);
        }
      })());
    };

    try {
      push(true);

      if (onlyNodeId) {
        if (token.cancelled) { run.steps[onlyNodeId] = { status: "skipped" }; push(true); }
        else await runNode(onlyNodeId);
      } else {
        for (const node of flow.nodes) {
          if (remainingParents.get(node.id) === 0) launch(node.id);
        }
        // pending grows as children unlock; re-reading .length drains the whole DAG
        for (let index = 0; index < pending.length; index += 1) await pending[index];
      }

      run.totalMs = now() - startedAt;
      if (token.cancelled) {
        run.status = "cancelled";
      } else if (onlyNodeId) {
        run.status = run.steps[onlyNodeId].status === "success" ? "success" : "failed";
      } else {
        run.status = Object.values(run.steps).some((step) => step.status === "failed")
          ? "failed"
          : "success";
      }
      push(false);

      if (!onlyNodeId) {
        const title = run.status === "success" ? "Flow finished" : `Flow ${run.status}`;
        const kind = run.status === "success" ? "ok" : run.status === "failed" ? "err" : "warn";
        dependencies.showToast(title, `${run.totalMs} ms`, kind);
      }
    } finally {
      activeRuns.delete(tabId);
    }
  };

  return { runFlow, cancelFlow };
}

export interface LiveFlowStoreState {
  tabs: readonly { id: string; kind: string }[];
  activeTabId: string;
  activeEnv: string | null;
  flowTabs: Record<string, FlowExecutorTab>;
  requestTabs: Record<string, unknown>;
  updateFlowTab: (
    tabId: string,
    patch: { run?: FlowRun | null; running?: boolean },
  ) => void;
  updateRequestTab: (tabId: string, patch: { response: Response }) => void;
  showToast: (title: string, body?: string, kind?: "ok" | "warn" | "err") => void;
  addHistory: (entry: {
    collectionId: string | null;
    request: Request;
    response: Response | null;
    status: string;
    timeMs: number | null;
    error: string | null;
  }) => void;
}

export interface LiveFlowApi {
  httpRequest: (env: string | null, request: Request) => Promise<HttpResponse>;
  grpcUnary: (env: string | null, part: GrpcPart) => Promise<GrpcResponse>;
}

export interface LiveFlowBindings extends FlowExecutor {
  runActiveFlow: () => Promise<void>;
}

export function createLiveFlowBindings(
  getState: () => LiveFlowStoreState,
  liveApi: LiveFlowApi,
  runtime: Pick<FlowExecutorDependencies, "now" | "sleep"> = {},
): LiveFlowBindings {
  const executor = createFlowExecutor({
    getFlowTab: (tabId) => getState().flowTabs[tabId],
    getActiveEnv: () => getState().activeEnv,
    updateFlowTab: (tabId, patch) => getState().updateFlowTab(tabId, patch),
    showToast: (title, body, kind) => getState().showToast(title, body, kind),
    httpRequest: (env, request) => liveApi.httpRequest(env, request),
    grpcUnary: (env, part) => liveApi.grpcUnary(env, part),
    mirrorResponse: (tabId, nodeId, response) => {
      const state = getState();
      const editorId = `flowreq:${tabId}:${nodeId}`;
      if (state.requestTabs[editorId]) state.updateRequestTab(editorId, { response });
    },
    addHistory: (entry) => getState().addHistory(entry),
    ...runtime,
  });

  const runActiveFlow = async (): Promise<void> => {
    const state = getState();
    const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
    if (tab?.kind === "flow") await executor.runFlow(tab.id);
  };

  return { ...executor, runActiveFlow };
}

let liveBindings: LiveFlowBindings | null = null;
let liveBindingsPromise: Promise<LiveFlowBindings> | null = null;

const getLiveBindings = async (): Promise<LiveFlowBindings> => {
  if (liveBindings) return liveBindings;
  if (!liveBindingsPromise) {
    liveBindingsPromise = Promise.all([import("../../store"), import("../api")]).then(
      ([{ useApp }, { api }]) => createLiveFlowBindings(
        () => useApp.getState(),
        api,
      ),
    ).then((executor) => {
      liveBindings = executor;
      return executor;
    });
  }
  return liveBindingsPromise;
};

export async function runFlow(tabId: string, onlyNodeId?: string): Promise<void> {
  const bindings = await getLiveBindings();
  await bindings.runFlow(tabId, onlyNodeId);
}

export function cancelFlow(tabId: string): void {
  liveBindings?.cancelFlow(tabId);
}

export async function runActiveFlow(): Promise<void> {
  const bindings = await getLiveBindings();
  await bindings.runActiveFlow();
}
