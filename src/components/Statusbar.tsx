import { useApp } from "../store";
import { version } from "../../package.json";

export function Statusbar() {
  const { tabs, activeTabId, requestTabs, collections, activeCollectionId, activeEnvByCollection } = useApp();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const rt = activeTab?.kind === "request" ? requestTabs[activeTabId] : null;
  const collection = collections.find((c) => c.id === activeCollectionId);
  const env = activeCollectionId ? activeEnvByCollection[activeCollectionId] : null;

  return (
    <footer className="statusbar">
      <div>
        <span>{collection ? collection.name : "no collection"}</span>
        <span style={{ color: env ? "var(--green)" : "var(--text-3)" }}>{env ?? "no environment"}</span>
      </div>
      <div>
        <span>{rt ? `${rt.request.protocol.toUpperCase()} ${rt.request.http?.url ?? rt.request.grpc?.endpoint ?? rt.request.ws?.url ?? ""}` : "—"}</span>
        <span>{rt?.running ? "sending…" : rt?.response ? "done" : "idle"}</span>
      </div>
      <div className="right-status">
        <span>UTF-8</span>
        <span>{activeTab?.title ?? ""}</span>
        <span>v{version}</span>
        <a className="credit" href="https://www.linkedin.com/in/ngthminh-dev/" target="_blank" rel="noreferrer">by @ngthminhdev</a>
      </div>
    </footer>
  );
}
