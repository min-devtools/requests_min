import { create } from "zustand";
import { api, emptyRequest, type CollectionMeta, type GrpcResponse, type HttpResponse, type ProtoSource, type Request } from "./lib/api";
import { isFlow, type Flow, type FlowRun } from "./lib/flow/types";
import type { IconName } from "./ui/Icon";
import { changeFontSize, clampFontSize, DEFAULT_FONT_SIZE } from "./lib/fontScale";
import { isThemeId } from "./lib/themes";

export type TabKind = "welcome" | "request" | "flow" | "flows" | "collections" | "environments" | "history" | "import-export" | "github-sync" | "settings";

export interface TabDef { id: string; kind: TabKind; title: string; icon: IconName }

const TAB_META: Record<Exclude<TabKind, "request" | "flow">, { title: string; icon: IconName }> = {
  welcome: { title: "Welcome", icon: "sparkles" },
  collections: { title: "Collections", icon: "database" },
  flows: { title: "Flows", icon: "flow" },
  environments: { title: "Environments", icon: "key" },
  history: { title: "Request History", icon: "history" },
  "import-export": { title: "Import / Export", icon: "copy" },
  "github-sync": { title: "GitHub Sync", icon: "github" },
  settings: { title: "Settings", icon: "settings" },
};

export interface RequestTabState {
  collectionId: string | null;
  relPath: string | null;
  request: Request;
  original: string;
  dirty: boolean; // request differs from `original` — computed once per mutation, not per render
  response: HttpResponse | GrpcResponse | null;
  running: boolean;
  error: string | null;
}

const computeDirty = (rt: Pick<RequestTabState, "request" | "original">) => JSON.stringify(rt.request) !== rt.original;

export interface FlowTabState {
  flowId: string;
  flow: Flow;
  original: string;
  dirty: boolean;
  run: FlowRun | null;
  running: boolean;
  selectedNodeId: string | null;
  /** node whose detail drawer is open; selection alone never opens the drawer */
  panelNodeId: string | null;
  /** which dock tab shows for the open step — canvas click → "step" editor, report row → "result" (session-only) */
  dockTab?: "step" | "result";
  /** graph-edit history for ⌘Z / ⌘⇧Z — snapshots of `flow` before each mutation (not persisted) */
  undoStack: Flow[];
  redoStack: Flow[];
}

const UNDO_CAP = 50;

const computeFlowDirty = (ft: Pick<FlowTabState, "flow" | "original">) => JSON.stringify(ft.flow) !== ft.original;

export interface ToastState { title: string; body?: string; kind?: "ok" | "warn" | "err" }
export interface HistoryEntry {
  id: string;
  timestamp: number;
  collectionId: string | null;
  request: Request;
  response: HttpResponse | GrpcResponse | null;
  status: string;
  timeMs: number | null;
  error: string | null;
}

export type DialogRequest =
  | { kind: "prompt"; title: string; message?: string; defaultValue?: string; confirmLabel?: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; message?: string; confirmLabel?: string; danger?: boolean; resolve: (v: string | null) => void }
  | { kind: "select"; title: string; message?: string; options: { label: string; value: string }[]; confirmLabel?: string; resolve: (v: string | null) => void };

let tabCounter = 0;
let activationSequence = 0;
const pendingFlowReads = new Map<string, Promise<Flow>>();
const nextId = (prefix: string) => `${prefix}-${++tabCounter}-${Date.now().toString(36)}`;

const readFlowOnce = (flowId: string): Promise<Flow> => {
  const existing = pendingFlowReads.get(flowId);
  if (existing) return existing;
  // flow files are hand-editable JSON; reject malformed shapes before they reach the UI
  const pending = api.flowRead(flowId).then((flow) => {
    if (!isFlow(flow)) throw new Error(`Flow "${flowId}" file is malformed`);
    return flow;
  });
  pendingFlowReads.set(flowId, pending);
  const clear = () => { if (pendingFlowReads.get(flowId) === pending) pendingFlowReads.delete(flowId); };
  void pending.then(clear, clear);
  return pending;
};

const requestIcon = (r: Request): IconName => (r.protocol === "grpc" ? "grpc" : r.protocol === "ws" ? "ws" : "request");

interface AppState {
  theme: string;
  setTheme: (theme: string) => void;
  toggleTheme: () => void;
  compact: boolean;
  toggleCompact: () => void;
  uiFontSize: number;
  changeUiFontSize: (direction: -1 | 1) => void;
  resetUiFontSize: () => void;
  uiFont: string;
  editorFont: string;
  setUiFont: (font: string) => void;
  setEditorFont: (font: string) => void;
  aiEndpoint: string;
  aiModel: string;
  aiApiKey: string;
  setAiSettings: (settings: { endpoint: string; model: string; apiKey: string }) => void;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
  workspaceNavCollapsed: boolean;
  toggleWorkspaceNav: () => void;
  requestHorizontal: boolean; // response beside the editor (Postman-style) vs below it
  toggleRequestLayout: () => void;
  vimMode: boolean; // vim keybindings in the Monaco editors
  toggleVimMode: () => void;
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;

  toast: ToastState | null;
  showToast: (title: string, body?: string, kind?: ToastState["kind"]) => void;

  dialog: DialogRequest | null;
  openDialog: (req: Omit<Extract<DialogRequest, { kind: "prompt" }>, "resolve" | "kind">) => Promise<string | null>;
  openConfirm: (req: Omit<Extract<DialogRequest, { kind: "confirm" }>, "resolve" | "kind">) => Promise<boolean>;
  openSelect: (req: Omit<Extract<DialogRequest, { kind: "select" }>, "resolve" | "kind">) => Promise<string | null>;
  closeDialog: (value: string | null) => void;

  collections: CollectionMeta[];
  reloadCollections: () => Promise<void>;
  protoSources: ProtoSource[];
  reloadProtoSources: () => Promise<void>;
  activeCollectionId: string | null;
  setActiveCollection: (id: string | null) => void;
  activeEnv: string | null;
  setActiveEnv: (env: string | null) => void;
  reqListVersion: number;
  reqListDirty: string | null; // collection whose request list changed; null = refetch all
  bumpReqList: (collectionId?: string | null) => void;
  envVersion: number;
  bumpEnv: () => void;
  syncDirty: boolean; // local collection edits not yet pushed to GitHub
  setSyncDirty: (v: boolean) => void;

  tabs: TabDef[];
  activeTabId: string;
  requestTabs: Record<string, RequestTabState>;
  flowTabs: Record<string, FlowTabState>;
  openTab: (kind: Exclude<TabKind, "request" | "flow">) => void;
  openRequestTab: (collectionId: string, relPath: string) => Promise<void>;
  openFlowTab: (flowId: string) => Promise<void>;
  newRequestTab: (protocol?: Request["protocol"], collectionId?: string | null) => void;
  ensureFlowNodeEditor: (editorId: string, request: Request, seed?: { response?: HttpResponse | GrpcResponse | null; error?: string | null }) => void;
  updateRequestTab: (tabId: string, patch: Partial<RequestTabState>) => void;
  updateFlowTab: (tabId: string, patch: Partial<FlowTabState>) => void;
  undoFlow: (tabId: string) => void;
  redoFlow: (tabId: string) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  confirmCloseTab: (id: string) => Promise<void>;
  deleteRequest: (collectionId: string, relPath: string) => Promise<void>;
  renameRequest: (collectionId: string, relPath: string, name: string) => Promise<void>;
  duplicateRequest: (collectionId: string, relPath: string, name: string) => Promise<void>;
  moveRequest: (fromCollectionId: string, relPath: string, toCollectionId: string) => Promise<void>;
  renameTab: (id: string, title: string) => void;
  reorderTab: (id: string, beforeId: string | null) => void;
  history: HistoryEntry[];
  addHistory: (entry: Omit<HistoryEntry, "id" | "timestamp">) => void;
  clearHistory: () => void;
}

const WELCOME_ID = "welcome";
const AI_SECRET_ENV = "_ai"; // secrets/_ai.json — outside env_list (environments/) and never pushed by GitHub sync

// {{var}} references are safe to keep; literal credential values are not.
const isVarRef = (v: string) => /\{\{.*\}\}/.test(v);
const stripSecret = (v?: string) => (v && !isVarRef(v) ? "" : v);
const MAX_STORED_BODY = 50_000;
const SECRET_HEADER = /authorization|api[-_]?key|token|secret/i;

/** Copy of a request safe to write to localStorage: literal secrets blanked, bodies capped. */
const sanitizeForStorage = (r: Request): Request => {
  const c = structuredClone(r);
  if (c.http) {
    c.http.auth = { ...c.http.auth, token: stripSecret(c.http.auth.token), password: stripSecret(c.http.auth.password), value: stripSecret(c.http.auth.value) };
    c.http.headers = c.http.headers.map((h) => SECRET_HEADER.test(h.key) && !isVarRef(h.value) ? { ...h, value: "" } : h);
    if (c.http.body.content && c.http.body.content.length > MAX_STORED_BODY) c.http.body.content = c.http.body.content.slice(0, MAX_STORED_BODY);
  }
  if (c.grpc && c.grpc.message.length > MAX_STORED_BODY) c.grpc.message = c.grpc.message.slice(0, MAX_STORED_BODY);
  return c;
};

// ponytail: keep stored responses small so history doesn't blow localStorage quotas
const sanitizeHistoryResponse = (response: HttpResponse | GrpcResponse | null): HttpResponse | GrpcResponse | null => {
  if (!response) return null;
  const c = structuredClone(response);
  if ("body" in c && c.body && c.body.length > MAX_STORED_BODY) c.body = c.body.slice(0, MAX_STORED_BODY) + "\n\n…truncated for history storage";
  if ("bodyJson" in c && c.bodyJson && c.bodyJson.length > MAX_STORED_BODY) c.bodyJson = c.bodyJson.slice(0, MAX_STORED_BODY) + "\n\n…truncated for history storage";
  return c;
};

const storedHistory = (): HistoryEntry[] => {
  try { return JSON.parse(localStorage.getItem("requestsmin:history") ?? "[]") as HistoryEntry[]; }
  catch { return []; }
};

const SESSION_KEY = "requestsmin:session";

/** Restore last session's open tabs from localStorage (responses are not persisted). */
const loadSession = (): { tabs: TabDef[]; activeTabId: string; requestTabs: Record<string, RequestTabState>; flowTabs: Record<string, FlowTabState> } | null => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    if (!s || !Array.isArray(s.tabs) || s.tabs.length === 0) return null;
    const requestTabs: Record<string, RequestTabState> = {};
    for (const [id, rt] of Object.entries<any>(s.requestTabs ?? {})) {
      if (!rt?.request) continue;
      const original = rt.original ?? "";
      requestTabs[id] = {
        collectionId: rt.collectionId ?? null,
        relPath: rt.relPath ?? null,
        request: rt.request,
        original,
        dirty: computeDirty({ request: rt.request, original }),
        response: null, running: false, error: null,
      };
    }
    const flowTabs: Record<string, FlowTabState> = {};
    for (const [id, ft] of Object.entries<any>(s.flowTabs ?? {})) {
      if (typeof ft?.flowId !== "string" || !ft.flowId || !isFlow(ft.flow)) continue;
      const original = ft.original ?? "";
      flowTabs[id] = {
        flowId: ft.flowId,
        flow: ft.flow,
        original,
        dirty: computeFlowDirty({ flow: ft.flow, original }),
        run: null,
        running: false,
        selectedNodeId: null,
        panelNodeId: null,
        undoStack: [],
        redoStack: [],
      };
    }
    const tabs: TabDef[] = s.tabs
      .filter((tab: TabDef) => (tab.kind !== "request" || requestTabs[tab.id]) && (tab.kind !== "flow" || flowTabs[tab.id]))
      .map((tab: TabDef) => {
        if ((tab.kind as string) !== "ai-import") return tab;
        return { ...tab, kind: "import-export", ...TAB_META["import-export"] };
      })
      // keep every request/flow tab (each is unique); dedup only singleton kinds
      .filter((tab: TabDef, index: number, all: TabDef[]) => tab.kind === "request" || tab.kind === "flow" || all.findIndex((other) => other.kind === tab.kind) === index);
    if (!tabs.length) return null;
    return { tabs, activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0].id, requestTabs, flowTabs };
  } catch { return null; }
};

const session = loadSession();

export const useApp = create<AppState>((set, get) => ({
  theme: (() => {
    const stored = localStorage.getItem("requestsmin:theme");
    return stored && isThemeId(stored) ? stored : "dark";
  })(),
  setTheme: (theme) => {
    localStorage.setItem("requestsmin:theme", theme);
    set({ theme });
  },
  toggleTheme: () => set((s) => {
    const theme = s.theme === "light" ? "dark" : "light";
    localStorage.setItem("requestsmin:theme", theme);
    return { theme };
  }),
  compact: localStorage.getItem("requestsmin:compact") === "1",
  toggleCompact: () => set((s) => {
    localStorage.setItem("requestsmin:compact", s.compact ? "0" : "1");
    return { compact: !s.compact };
  }),
  vimMode: localStorage.getItem("requestsmin:vim") === "1",
  toggleVimMode: () => set((s) => {
    localStorage.setItem("requestsmin:vim", s.vimMode ? "0" : "1");
    return { vimMode: !s.vimMode };
  }),
  uiFontSize: clampFontSize(Number(localStorage.getItem("requestsmin:font-size")) || DEFAULT_FONT_SIZE),
  changeUiFontSize: (direction) => set((s) => {
    const uiFontSize = changeFontSize(s.uiFontSize, direction);
    localStorage.setItem("requestsmin:font-size", String(uiFontSize));
    return { uiFontSize };
  }),
  resetUiFontSize: () => {
    localStorage.setItem("requestsmin:font-size", String(DEFAULT_FONT_SIZE));
    set({ uiFontSize: DEFAULT_FONT_SIZE });
  },
  uiFont: localStorage.getItem("requestsmin:ui-font") ?? "",
  editorFont: localStorage.getItem("requestsmin:editor-font") ?? "",
  setUiFont: (uiFont) => {
    localStorage.setItem("requestsmin:ui-font", uiFont);
    set({ uiFont });
  },
  setEditorFont: (editorFont) => {
    localStorage.setItem("requestsmin:editor-font", editorFont);
    set({ editorFont });
  },
  aiEndpoint: localStorage.getItem("requestsmin:ai-endpoint") ?? "https://api.openai.com/v1",
  aiModel: localStorage.getItem("requestsmin:ai-model") ?? "gpt-4.1",
  aiApiKey: "", // hydrated async from the on-disk secret store, never localStorage
  setAiSettings: ({ endpoint, model, apiKey }) => {
    localStorage.setItem("requestsmin:ai-endpoint", endpoint);
    localStorage.setItem("requestsmin:ai-model", model);
    void api.secretWrite(AI_SECRET_ENV, { apiKey }).catch(() => {});
    set({ aiEndpoint: endpoint, aiModel: model, aiApiKey: apiKey });
  },
  leftCollapsed: false,
  rightCollapsed: false,
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  workspaceNavCollapsed: localStorage.getItem("requestsmin:workspace-nav-collapsed") === "1",
  toggleWorkspaceNav: () => set((s) => {
    const workspaceNavCollapsed = !s.workspaceNavCollapsed;
    localStorage.setItem("requestsmin:workspace-nav-collapsed", workspaceNavCollapsed ? "1" : "0");
    return { workspaceNavCollapsed };
  }),
  requestHorizontal: localStorage.getItem("requestsmin:request-horizontal") === "1",
  toggleRequestLayout: () => set((s) => {
    const requestHorizontal = !s.requestHorizontal;
    localStorage.setItem("requestsmin:request-horizontal", requestHorizontal ? "1" : "0");
    return { requestHorizontal };
  }),
  commandOpen: false,
  setCommandOpen: (v) => set({ commandOpen: v }),

  toast: null,
  showToast: (title, body, kind = "ok") => {
    set({ toast: { title, body, kind } });
    window.clearTimeout((window as any).__toastTimer);
    (window as any).__toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
  },

  dialog: null,
  openDialog: (req) =>
    new Promise((resolve) => {
      set({ dialog: { ...req, kind: "prompt", resolve } });
    }),
  openConfirm: (req) =>
    new Promise((resolve) => {
      set({ dialog: { ...req, kind: "confirm", resolve: (v: string | null) => resolve(v === "1") } });
    }),
  openSelect: (req) =>
    new Promise((resolve) => {
      set({ dialog: { ...req, kind: "select", resolve } });
    }),
  closeDialog: (value) => {
    const d = get().dialog;
    set({ dialog: null });
    d?.resolve(value);
  },

  collections: [],
  reloadCollections: async () => {
    const collections = await api.colList();
    // the collection set changed — any pending single-collection dirty mark no longer covers it
    set({ collections, reqListDirty: null });
  },
  protoSources: [],
  reloadProtoSources: async () => set({ protoSources: await api.protoSourceList() }),
  activeCollectionId: null,
  setActiveCollection: (id) => set({ activeCollectionId: id }),
  activeEnv: localStorage.getItem("requestsmin:active-env"),
  setActiveEnv: (env) => {
    if (env) localStorage.setItem("requestsmin:active-env", env);
    else localStorage.removeItem("requestsmin:active-env");
    set({ activeEnv: env });
  },
  reqListVersion: 0,
  reqListDirty: null,
  bumpReqList: (collectionId = null) => set((s) => ({ reqListVersion: s.reqListVersion + 1, reqListDirty: collectionId })),
  envVersion: 0,
  bumpEnv: () => set((s) => ({ envVersion: s.envVersion + 1 })),
  syncDirty: false,
  setSyncDirty: (v) => set({ syncDirty: v }),

  tabs: session?.tabs ?? [{ id: WELCOME_ID, kind: "welcome", title: "Welcome", icon: "sparkles" }],
  activeTabId: session?.activeTabId ?? WELCOME_ID,
  requestTabs: session?.requestTabs ?? {},
  flowTabs: session?.flowTabs ?? {},

  openTab: (kind) => {
    activationSequence++;
    const existing = get().tabs.find((t) => t.kind === kind);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const meta = TAB_META[kind];
    const tab: TabDef = { id: nextId(kind), kind, title: meta.title, icon: meta.icon };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  openRequestTab: async (collectionId, relPath) => {
    const activation = ++activationSequence;
    const existing = get().tabs.find(
      (t) => t.kind === "request" && get().requestTabs[t.id]?.collectionId === collectionId && get().requestTabs[t.id]?.relPath === relPath,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const request = await api.reqRead(collectionId, relPath);
    const id = nextId("req");
    const state: RequestTabState = {
      collectionId, relPath, request, original: JSON.stringify(request), dirty: false,
      response: null, running: false, error: null,
    };
    const tab: TabDef = { id, kind: "request", title: request.name, icon: requestIcon(request) };
    set((s) => ({
      tabs: [...s.tabs, tab],
      requestTabs: { ...s.requestTabs, [id]: state },
      activeTabId: activation === activationSequence ? id : s.activeTabId,
    }));
  },

  openFlowTab: async (flowId) => {
    const activation = ++activationSequence;
    const existing = get().tabs.find((t) => t.kind === "flow" && get().flowTabs[t.id]?.flowId === flowId);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const flow = await readFlowOnce(flowId);
    const opened = get().tabs.find((t) => t.kind === "flow" && get().flowTabs[t.id]?.flowId === flowId);
    if (opened) {
      if (activation === activationSequence) set({ activeTabId: opened.id });
      return;
    }
    const id = nextId("flow");
    const state: FlowTabState = {
      flowId,
      flow,
      original: JSON.stringify(flow),
      dirty: false,
      run: null,
      running: false,
      selectedNodeId: null,
      panelNodeId: null,
      undoStack: [],
      redoStack: [],
    };
    const tab: TabDef = { id, kind: "flow", title: flow.name, icon: "flow" };
    set((s) => ({
      tabs: [...s.tabs, tab],
      flowTabs: { ...s.flowTabs, [id]: state },
      activeTabId: activation === activationSequence ? id : s.activeTabId,
    }));
  },

  newRequestTab: (protocol = "http", collectionId = null) => {
    activationSequence++;
    const request = emptyRequest(protocol);
    const id = nextId("req");
    const state: RequestTabState = {
      // unattached by default — the collection is chosen at save time, not inherited from whatever is active
      // original = current shape so a fresh untouched tab is clean and closes without a confirm
      collectionId, relPath: null, request, original: JSON.stringify(request), dirty: false,
      response: null, running: false, error: null,
    };
    const tab: TabDef = { id, kind: "request", title: request.name, icon: requestIcon(request) };
    set((s) => ({ tabs: [...s.tabs, tab], requestTabs: { ...s.requestTabs, [id]: state }, activeTabId: id }));
  },

  ensureFlowNodeEditor: (editorId, request, seed) => set((s) => {
    const existing = s.requestTabs[editorId];
    if (existing && JSON.stringify(existing.request) === JSON.stringify(request)) return {};
    const seeded = structuredClone(request);
    return {
      requestTabs: {
        ...s.requestTabs,
        [editorId]: {
          collectionId: null,
          relPath: null,
          request: seeded,
          original: JSON.stringify(request),
          dirty: false,
          response: existing?.response ?? seed?.response ?? null,
          running: false,
          error: existing?.error ?? seed?.error ?? null,
        },
      },
    };
  }),

  updateRequestTab: (tabId, patch) => {
    set((s) => {
      const cur = s.requestTabs[tabId];
      if (!cur) return {};
      const next = { ...cur, ...patch };
      if (patch.request !== undefined || patch.original !== undefined) next.dirty = computeDirty(next);
      const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, title: next.request.name, icon: requestIcon(next.request) } : t));
      const requestTabs = { ...s.requestTabs, [tabId]: next };
      if (!tabId.startsWith("flowreq:") || patch.request === undefined) return { requestTabs, tabs };

      const owner = Object.keys(s.flowTabs).find((flowTabId) => tabId.startsWith(`flowreq:${flowTabId}:`));
      if (!owner) return { requestTabs, tabs };
      const nodeId = tabId.slice(`flowreq:${owner}:`.length);
      const flowTab = s.flowTabs[owner];
      const node = flowTab.flow.nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== "request") return { requestTabs, tabs };
      const flow = {
        ...flowTab.flow,
        nodes: flowTab.flow.nodes.map((item) => item.id === nodeId && item.type === "request"
          ? { ...item, config: { ...item.config, request: structuredClone(next.request) } }
          : item),
      };
      const updatedFlowTab = { ...flowTab, flow };
      updatedFlowTab.dirty = computeFlowDirty(updatedFlowTab);
      return { requestTabs, tabs, flowTabs: { ...s.flowTabs, [owner]: updatedFlowTab } };
    });
  },

  updateFlowTab: (tabId, patch) => {
    set((s) => {
      const cur = s.flowTabs[tabId];
      if (!cur) return {};
      const next = { ...cur, ...patch };
      if (patch.flow !== undefined || patch.original !== undefined) next.dirty = computeFlowDirty(next);
      // a real graph edit snapshots the previous flow for undo and invalidates the redo branch
      if (patch.flow !== undefined && patch.flow !== cur.flow && patch.undoStack === undefined) {
        next.undoStack = [...(cur.undoStack ?? []), cur.flow].slice(-UNDO_CAP);
        next.redoStack = [];
      }
      const tab = s.tabs.find((item) => item.id === tabId);
      const tabs = tab && tab.title !== next.flow.name
        ? s.tabs.map((item) => item.id === tabId ? { ...item, title: next.flow.name } : item)
        : s.tabs;
      let requestTabs = s.requestTabs;
      if (patch.flow !== undefined) {
        const remainingNodeIds = new Set(next.flow.nodes.map((node) => node.id));
        const prefix = `flowreq:${tabId}:`;
        for (const editorId of Object.keys(s.requestTabs)) {
          if (!editorId.startsWith(prefix) || remainingNodeIds.has(editorId.slice(prefix.length))) continue;
          if (requestTabs === s.requestTabs) requestTabs = { ...s.requestTabs };
          delete requestTabs[editorId];
        }
        if (next.selectedNodeId && !remainingNodeIds.has(next.selectedNodeId)) next.selectedNodeId = null;
        if (next.panelNodeId && !remainingNodeIds.has(next.panelNodeId)) next.panelNodeId = null;
      }
      return { flowTabs: { ...s.flowTabs, [tabId]: next }, requestTabs, tabs };
    });
  },

  undoFlow: (tabId) => {
    const ft = get().flowTabs[tabId];
    if (!ft || ft.running || ft.undoStack.length === 0) return;
    // explicit stacks make updateFlowTab skip its own push while reusing its node/editor cleanup
    get().updateFlowTab(tabId, {
      flow: ft.undoStack[ft.undoStack.length - 1],
      undoStack: ft.undoStack.slice(0, -1),
      redoStack: [...ft.redoStack, ft.flow].slice(-UNDO_CAP),
    });
  },

  redoFlow: (tabId) => {
    const ft = get().flowTabs[tabId];
    if (!ft || ft.running || ft.redoStack.length === 0) return;
    get().updateFlowTab(tabId, {
      flow: ft.redoStack[ft.redoStack.length - 1],
      redoStack: ft.redoStack.slice(0, -1),
      undoStack: [...ft.undoStack, ft.flow].slice(-UNDO_CAP),
    });
  },

  activateTab: (id) => {
    activationSequence++;
    // follow the tab's collection so the sidebar highlight tracks ⌘-number / tab clicks,
    // matching what clicking a request in the sidebar already does
    set((s) => {
      const colId = s.requestTabs[id]?.collectionId;
      return colId ? { activeTabId: id, activeCollectionId: colId } : { activeTabId: id };
    });
  },
  confirmCloseTab: async (id) => {
    const rt = get().requestTabs[id];
    const ft = get().flowTabs[id];
    const dirtyName = rt?.dirty ? rt.request.name : ft?.dirty ? ft.flow.name : null;
    if (dirtyName && !(await get().openConfirm({
      title: "Close without saving?",
      message: `"${dirtyName}" has unsaved changes.`,
      danger: true,
      confirmLabel: "Close",
    }))) return;
    get().closeTab(id);
  },
  closeTab: (id) => {
    activationSequence++;
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      if (index < 0) return {};
      const tabs = s.tabs.filter((t) => t.id !== id);
      const requestTabs = { ...s.requestTabs };
      delete requestTabs[id];
      const flowTabs = { ...s.flowTabs };
      delete flowTabs[id];
      for (const key of Object.keys(requestTabs)) if (key.startsWith(`flowreq:${id}:`)) delete requestTabs[key];
      const activeTabId = s.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? WELCOME_ID : s.activeTabId;
      return { tabs: tabs.length ? tabs : [{ id: WELCOME_ID, kind: "welcome", title: "Welcome", icon: "sparkles" }], requestTabs, flowTabs, activeTabId };
    });
  },
  deleteRequest: async (collectionId, relPath) => {
    await api.reqDelete(collectionId, relPath);
    for (const tab of get().tabs) {
      const requestTab = get().requestTabs[tab.id];
      if (requestTab?.collectionId === collectionId && requestTab.relPath === relPath) get().closeTab(tab.id);
    }
    get().bumpReqList(collectionId);
  },
  renameRequest: async (collectionId, relPath, name) => {
    const request = await api.reqRead(collectionId, relPath);
    const next = { ...request, name };
    await api.reqWrite(collectionId, relPath, next);
    set((state) => {
      const requestTabs = { ...state.requestTabs };
      const tabs = state.tabs.map((tab) => {
        const current = requestTabs[tab.id];
        if (current?.collectionId !== collectionId || current.relPath !== relPath) return tab;
        requestTabs[tab.id] = { ...current, request: next, original: JSON.stringify(next), dirty: false };
        return { ...tab, title: name };
      });
      return { tabs, requestTabs };
    });
    get().bumpReqList(collectionId);
  },
  duplicateRequest: async (collectionId, relPath, name) => {
    const request = await api.reqRead(collectionId, relPath);
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "request";
    const slash = relPath.lastIndexOf("/");
    const folder = slash >= 0 ? `${relPath.slice(0, slash + 1)}` : "";
    const existing = new Set((await api.reqList(collectionId)).map((entry) => entry.relPath));
    let target = `${folder}${safeName}.json`;
    let suffix = 2;
    while (existing.has(target)) target = `${folder}${safeName}-${suffix++}.json`;
    await api.reqWrite(collectionId, target, { ...request, name });
    get().bumpReqList(collectionId);
  },
  moveRequest: async (fromCollectionId, relPath, toCollectionId) => {
    if (fromCollectionId === toCollectionId) return;
    const request = await api.reqRead(fromCollectionId, relPath);
    const base = relPath.slice(relPath.lastIndexOf("/") + 1).replace(/\.json$/, "");
    const existing = new Set((await api.reqList(toCollectionId)).map((entry) => entry.relPath));
    let target = `${base}.json`;
    let suffix = 2;
    while (existing.has(target)) target = `${base}-${suffix++}.json`;
    await api.reqWrite(toCollectionId, target, request);
    await api.reqDelete(fromCollectionId, relPath);
    set((state) => ({
      requestTabs: Object.fromEntries(Object.entries(state.requestTabs).map(([id, tab]) =>
        tab.collectionId === fromCollectionId && tab.relPath === relPath
          ? [id, { ...tab, collectionId: toCollectionId, relPath: target }]
          : [id, tab])),
    }));
    get().bumpReqList();
  },
  renameTab: (id, title) => set((s) => {
    const clean = title.trim();
    if (!clean) return {};
    let requestTabs = s.requestTabs;
    if (s.requestTabs[id]) {
      const next = { ...s.requestTabs[id], request: { ...s.requestTabs[id].request, name: clean } };
      next.dirty = computeDirty(next);
      requestTabs = { ...s.requestTabs, [id]: next };
    }
    let flowTabs = s.flowTabs;
    if (s.flowTabs[id]) {
      const next = { ...s.flowTabs[id], flow: { ...s.flowTabs[id].flow, name: clean } };
      next.dirty = computeFlowDirty(next);
      flowTabs = { ...s.flowTabs, [id]: next };
    }
    return { tabs: s.tabs.map((t) => t.id === id ? { ...t, title: clean } : t), requestTabs, flowTabs };
  }),
  reorderTab: (id, beforeId) => set((s) => {
    const tab = s.tabs.find((t) => t.id === id);
    if (!tab) return {};
    const tabs = s.tabs.filter((t) => t.id !== id);
    const index = beforeId ? tabs.findIndex((t) => t.id === beforeId) : tabs.length;
    tabs.splice(index < 0 ? tabs.length : index, 0, tab);
    return { tabs };
  }),
  history: storedHistory(),
  addHistory: (entry) => set((s) => {
    const history = [{ ...entry, id: nextId("history"), timestamp: Date.now() }, ...s.history].slice(0, 100);
    // persist with literal secrets stripped and huge bodies truncated; in-memory copy stays full
    try {
      localStorage.setItem("requestsmin:history", JSON.stringify(history.map((h) => ({
        ...h,
        request: sanitizeForStorage(h.request),
        response: sanitizeHistoryResponse(h.response),
      }))));
    } catch { /* quota exceeded — keep in-memory history, drop persistence */ }
    return { history };
  }),
  clearHistory: () => {
    localStorage.removeItem("requestsmin:history");
    set({ history: [] });
  },
}));

// Persist open tabs across restarts (responses/running/error are dropped — transient).
// Debounced: every keystroke in a body editor touches requestTabs, and serializing all
// open bodies per keystroke is wasted work. Flushed on hide/unload so nothing is lost.
const saveSession = () => {
  const s = useApp.getState();
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    requestTabs: Object.fromEntries(Object.entries(s.requestTabs)
      .filter(([id]) => !id.startsWith("flowreq:"))
      .map(([id, rt]) => [id, {
        collectionId: rt.collectionId, relPath: rt.relPath, request: rt.request, original: rt.original,
      }])),
    flowTabs: Object.fromEntries(Object.entries(s.flowTabs).map(([id, ft]) => [id, {
      flowId: ft.flowId, flow: ft.flow, original: ft.original,
    }])),
  }));
};
let sessionTimer: number | undefined;
let prevSession = useApp.getState();
useApp.subscribe((s) => {
  if (s.tabs !== prevSession.tabs || s.activeTabId !== prevSession.activeTabId || s.requestTabs !== prevSession.requestTabs || s.flowTabs !== prevSession.flowTabs) {
    window.clearTimeout(sessionTimer);
    sessionTimer = window.setTimeout(saveSession, 400);
  }
  prevSession = s;
});
window.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveSession(); });
window.addEventListener("beforeunload", saveSession);

// AI api key lives in the secret store on disk; migrate any legacy localStorage copy once.
void (async () => {
  try {
    const legacy = localStorage.getItem("requestsmin:ai-api-key");
    if (legacy) {
      await api.secretWrite(AI_SECRET_ENV, { apiKey: legacy });
      localStorage.removeItem("requestsmin:ai-api-key");
    }
    const { apiKey } = await api.secretRead(AI_SECRET_ENV);
    if (apiKey) useApp.setState({ aiApiKey: apiKey });
  } catch { /* backend unavailable (plain-browser dev) — key stays empty */ }
})();
