import { api, setOnMutate, type GhStatus } from "./api";
import { useApp } from "../store";

export const DEFAULT_REPO = "requests_min_collections";
const PUSH_DEBOUNCE_MS = 5 * 60 * 1000; // 5 min — avoid hammering GitHub on every edit

// Pure: pick sync direction. Never pull over never-synced local data — gh_pull
// deletes local files missing from remote, and that loss is unrecoverable.
export function syncPlan(status: GhStatus, hasLocal: boolean): "push" | "pull" | "none" {
  if (!status.connected) return "none";
  if (!status.lastSha) return hasLocal ? "push" : "pull";
  return "pull";
}

let timer: number | undefined;
let pushing = false;

export function schedulePush() {
  useApp.getState().setSyncDirty(true);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void pushNow(), PUSH_DEBOUNCE_MS);
}

async function pushNow() {
  if (pushing) { schedulePush(); return; }
  pushing = true;
  try {
    const status = await api.ghStatus();
    if (status.connected && status.repo) await api.ghPush(null);
    useApp.getState().setSyncDirty(false);
  } catch (err) {
    useApp.getState().showToast("Auto sync failed", String(err), "err");
  } finally {
    pushing = false;
  }
}

/** Manual "sync now" — flush the pending debounce immediately. */
export async function syncNow() {
  window.clearTimeout(timer);
  await pushNow();
}

export async function startAutoSync() {
  setOnMutate(schedulePush);
  try {
    let status = await api.ghStatus();
    if (!status.connected) return;
    if (!status.repo) {
      await api.ghConfigure(DEFAULT_REPO);
      status = await api.ghStatus();
    }
    const hasLocal = (await api.colList()).length > 0;
    const plan = syncPlan(status, hasLocal);
    if (plan === "push") {
      await api.ghPush("Baseline sync");
      useApp.getState().showToast("GitHub sync", `Pushed local collections to ${status.repo}.`);
    } else if (plan === "pull") {
      const result = await api.ghPull(false);
      if (result.conflict) {
        useApp.getState().showToast("Sync conflict", "Remote and local collections differ — resolve in GitHub Sync view.", "warn");
        return;
      }
      if (result.updated) {
        await useApp.getState().reloadCollections();
        useApp.getState().bumpReqList();
      }
    }
  } catch (err) {
    useApp.getState().showToast("Auto sync failed", String(err), "err");
  }
}
