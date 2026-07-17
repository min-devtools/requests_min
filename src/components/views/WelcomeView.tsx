import { useShallow } from "zustand/react/shallow";
import { ToolButton } from "../../ui/ToolButton";
import { Icon, type IconName } from "../../ui/Icon";
import { useApp } from "../../store";

export function WelcomeView({ active }: { active: boolean }) {
  const { newRequestTab, openTab, collections } = useApp(useShallow((s) => ({
    newRequestTab: s.newRequestTab, openTab: s.openTab, collections: s.collections,
  })));

  const actions: { icon: IconName; label: string; desc: string; onClick: () => void }[] = [
    { icon: "plus", label: "New REST request", desc: "Compose a REST call with headers, auth, and body.", onClick: () => newRequestTab("http") },
    { icon: "grpc", label: "New gRPC request", desc: "Describe a service via reflection or local .proto files.", onClick: () => newRequestTab("grpc") },
    { icon: "ws", label: "New WebSocket", desc: "Connect and exchange messages over a socket.", onClick: () => newRequestTab("ws") },
    { icon: "database", label: "Collections", desc: "Browse saved requests and sync with GitHub.", onClick: () => openTab("collections") },
    { icon: "key", label: "Environments", desc: "Manage variables and secrets per environment.", onClick: () => openTab("environments") },
    { icon: "wand", label: "AI import", desc: "Generate a collection draft from a source folder.", onClick: () => openTab("import-export") },
  ];

  return (
    <section className={`content welcome-view ${active ? "active" : ""}`}>
      <div className="welcome-shell">
        <div className="welcome-hero">
          <div className="welcome-copy">
            <div className="welcome-kicker">{collections.length ? `${collections.length} collections` : "no collections yet"}</div>
            <h1 className="welcome-title">RequestsMin</h1>
            <p className="welcome-text">
              A native API workspace for REST, gRPC, and WebSocket — with GitHub-backed collections,
              environments, import/export, and AI request generation from local source.
            </p>
            <div className="welcome-actions">
              <ToolButton variant="primary" onClick={() => newRequestTab("http")}>
                <Icon name="send" /> New request
              </ToolButton>
              <ToolButton onClick={() => openTab("collections")}>
                <Icon name="database" /> Browse collections
              </ToolButton>
            </div>
          </div>
        </div>

        <div className="welcome-launch">
          {actions.map((a) => (
            <button type="button" className="welcome-card" key={a.label} onClick={a.onClick}>
              <span className="welcome-card-icon"><Icon name={a.icon} size={18} /></span>
              <strong>{a.label}</strong>
              <span className="welcome-card-desc">{a.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
