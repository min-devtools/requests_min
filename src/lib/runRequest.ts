import { api } from "./api";
import { useApp } from "../store";

export async function runActiveRequest() {
  const s = useApp.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab || tab.kind !== "request") return;
  const rt = s.requestTabs[tab.id];
  if (!rt || rt.running) return;

  const collectionId = rt.collectionId ?? "";
  const env = rt.collectionId ? s.activeEnvByCollection[rt.collectionId] ?? null : null;

  if (rt.request.protocol === "ws") {
    s.showToast("WebSocket", "Use the connect / send controls in the request editor.", "warn");
    return;
  }

  s.updateRequestTab(tab.id, { running: true, error: null });
  try {
    if (rt.request.protocol === "grpc") {
      if (!rt.request.grpc) throw new Error("missing gRPC part");
      const response = await api.grpcUnary(collectionId, env, rt.request.grpc);
      s.updateRequestTab(tab.id, { running: false, response });
      s.addHistory({ collectionId: rt.collectionId, request: structuredClone(rt.request), status: response.statusCode, timeMs: response.timeMs, error: null });
    } else {
      const response = await api.httpRequest(collectionId, env, rt.request);
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

  let collectionId = rt.collectionId;
  if (!collectionId) {
    const name = await s.openDialog({ title: "Save to which collection?", message: "Enter a new collection name — it will be created." });
    if (!name?.trim()) return;
    const meta = await api.colCreate(name.trim());
    collectionId = meta.id;
    await s.reloadCollections();
    s.setActiveCollection(collectionId);
  }

  let relPath = rt.relPath;
  if (!relPath) {
    const safe = rt.request.name.trim().replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").toLowerCase() || "request";
    relPath = `${safe}.json`;
  }

  await api.reqWrite(collectionId, relPath, rt.request);
  s.updateRequestTab(tab.id, { collectionId, relPath, original: JSON.stringify(rt.request) });
  s.bumpReqList();
  s.showToast("Saved", `${rt.request.name} written to disk.`);
}
