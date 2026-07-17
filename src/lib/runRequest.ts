import { api } from "./api";
import { useApp } from "../store";

export async function runActiveRequest() {
  const s = useApp.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab || tab.kind !== "request") return;
  const rt = s.requestTabs[tab.id];
  if (!rt || rt.running) return;

  const env = s.activeEnv;

  if (rt.request.protocol === "ws") {
    s.showToast("WebSocket", "Use the connect / send controls in the request editor.", "warn");
    return;
  }

  s.updateRequestTab(tab.id, { running: true, error: null });
  try {
    if (rt.request.protocol === "grpc") {
      if (!rt.request.grpc) throw new Error("missing gRPC part");
      const response = await api.grpcUnary(env, rt.request.grpc);
      s.updateRequestTab(tab.id, { running: false, response });
      s.addHistory({ collectionId: rt.collectionId, request: structuredClone(rt.request), status: response.statusCode, timeMs: response.timeMs, error: null });
    } else {
      const response = await api.httpRequest(env, rt.request);
      s.updateRequestTab(tab.id, { running: false, response });
      s.addHistory({ collectionId: rt.collectionId, request: structuredClone(rt.request), status: String(response.status), timeMs: response.timeMs, error: null });
    }
  } catch (err) {
    const error = String(err);
    s.updateRequestTab(tab.id, { running: false, error });
    s.addHistory({ collectionId: rt.collectionId, request: structuredClone(rt.request), status: "failed", timeMs: null, error });
    s.showToast("Request failed", error, "err");
  }
}

export async function saveActiveRequest() {
  const s = useApp.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab || tab.kind !== "request") return;
  const rt = s.requestTabs[tab.id];
  if (!rt) return;

  const NEW = "\0new"; // sentinel: user picked "create a new collection"
  let collectionId = rt.collectionId;
  if (!collectionId) {
    let choice: string | null = NEW;
    if (s.collections.length) {
      choice = await s.openSelect({
        title: "Save to which collection?",
        options: [...s.collections.map((c) => ({ label: c.name, value: c.id })), { label: "＋ New collection…", value: NEW }],
        confirmLabel: "Save",
      });
      if (choice === null) return; // cancelled
    }
    if (choice === NEW) {
      const name = await s.openDialog({ title: "New collection", message: "Enter a name — it will be created." });
      if (!name?.trim()) return;
      collectionId = (await api.colCreate(name.trim())).id;
      await s.reloadCollections();
    } else {
      collectionId = choice;
    }
    s.setActiveCollection(collectionId);
  }

  let relPath = rt.relPath;
  if (!relPath) {
    const safe = rt.request.name.trim().replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").toLowerCase() || "request";
    // don't clobber an existing request of the same default name — suffix until unique
    const taken = new Set((await api.reqList(collectionId)).map((e) => e.relPath));
    relPath = `${safe}.json`;
    for (let n = 2; taken.has(relPath); n++) relPath = `${safe}-${n}.json`;
  }

  await api.reqWrite(collectionId, relPath, rt.request);
  s.updateRequestTab(tab.id, { collectionId, relPath, original: JSON.stringify(rt.request) });
  s.bumpReqList(collectionId);
  s.showToast("Saved", `${rt.request.name} written to disk.`);
}
