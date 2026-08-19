import { useApp, PAGES } from "../../contexts/AppContext";
import { useAuth } from "../../contexts/AuthContext";
import { useSocket } from "../../contexts/SocketContext";
import useServiceHealth from "../../hooks/useServiceHealth";
import Icon from "../research/Icons";

const NAV_ITEMS = [
  { id: PAGES.DASHBOARD, label: "Dashboard", icon: "dashboard" },
  { id: PAGES.COLLECTIONS, label: "Collections", icon: "collections" },
  { id: PAGES.PAPERS, label: "Papers", icon: "papers" },
  { id: PAGES.CHAT, label: "Research Chat", icon: "chat" },
  { id: PAGES.COMPARE_PAPERS, label: "Compare Papers", icon: "spark" },
  { id: PAGES.LITERATURE_REVIEWS, label: "Literature Reviews", icon: "book" },
  { id: PAGES.SETTINGS, label: "Settings", icon: "settings" },
];

const Sidebar = ({ onShowLanding }) => {
  const { activePage, navigateTo, sidebarCollapsed } = useApp();
  const { logout, user } = useAuth();
  const socket = useSocket();
  const { apiOk, pipelineOk } = useServiceHealth();
  const initials = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "D";
  const activeNavPage = activePage === PAGES.COLLECTION ? PAGES.COLLECTIONS : activePage;
  const collapsed = sidebarCollapsed;

  // Dot colour helper: null=checking (dim pulse), true=green, false=red
  const dot = (status) => ({
    background: status === null ? "var(--rp-text-muted)" : status ? "var(--rp-green)" : "var(--rp-rose)",
    opacity:    status === null ? 0.4 : 1,
    animation:  status === null ? "pulse 1.5s ease-in-out infinite" : "none",
  });

  return (
    <aside
      className={`research-sidebar ${collapsed ? "is-collapsed" : ""}`}
      aria-label="Research workspace navigation"
    >
      {/* Brand */}
      <button
        className="brand-lockup brand-lockup-btn"
        onClick={onShowLanding}
        title="View DocLens landing page"
        type="button"
        style={{
          background: "none", border: "none",
          cursor: onShowLanding ? "pointer" : "default",
          padding: collapsed ? "8px 6px 10px" : "8px 10px 10px",
          width: "100%", textAlign: "left",
          display: "flex", alignItems: "center",
          gap: collapsed ? 0 : 10,
          flexShrink: 0,
        }}
      >
        <img 
          src="/logo.png" 
          alt="DocLens Logo" 
          style={{ 
            width: collapsed ? 32 : 44, 
            height: "auto", 
            maxHeight: collapsed ? 32 : 44,
            flexShrink: 0, 
            objectFit: "contain",
            borderRadius: 6,
            display: "block",
          }} 
        />
        {!collapsed && (
          <div style={{ overflow: "hidden" }}>
            <strong style={{ fontSize: "0.9rem" }}>DocLens</strong>
            <span style={{ fontSize: "0.68rem" }}>Research Intelligence</span>
          </div>
        )}
      </button>

      {/* Section label */}
      {!collapsed && (
        <div className="sidebar-section-label">Workspace</div>
      )}

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            className={`sidebar-nav-button ${activeNavPage === item.id ? "active" : ""}`}
            key={item.id}
            onClick={() => navigateTo(item.id)}
            type="button"
            title={collapsed ? item.label : undefined}
            style={{
              justifyContent: collapsed ? "center" : "flex-start",
              padding: collapsed ? "7px 8px" : "7px 10px",
              gap: collapsed ? 0 : 9,
              minHeight: 36,
            }}
          >
            <Icon name={item.icon} size={16} style={{ flexShrink: 0 }} />
            {!collapsed && <span style={{ fontSize: "0.84rem" }}>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Status panel — hidden when collapsed */}
      {!collapsed && (
        <section className="sidebar-signal-panel" aria-label="Research platform status" style={{ padding: "10px 12px", gap: 8 }}>
          <strong style={{ fontSize: "0.76rem" }}>Corpus Intelligence</strong>
          <div className="signal-row">
            <span>API</span>
            <i style={dot(apiOk)} />
          </div>
          <div className="signal-row">
            <span>Realtime indexing</span>
            <i style={dot(socket?.connected ?? null)} />
          </div>
          <div className="signal-row">
            <span>Analysis pipeline</span>
            <i style={dot(pipelineOk)} />
          </div>
        </section>
      )}

      {/* User row */}
      <div
        className="sidebar-user"
        style={{
          gap: collapsed ? 0 : undefined,
          justifyContent: collapsed ? "center" : undefined,
          padding: collapsed ? "8px 4px" : undefined,
        }}
      >
        <div
          className="sidebar-avatar"
          title={collapsed ? (user?.name || user?.email || "User") : undefined}
          style={{ flexShrink: 0 }}
        >
          {initials}
        </div>
        {!collapsed && (
          <>
            <div>
              <strong>{user?.name || "Researcher"}</strong>
              <span>{user?.email || "doclens user"}</span>
            </div>
            <button
              className="sidebar-logout"
              onClick={logout}
              title="Sign out of DocLens"
              aria-label="Sign out"
              type="button"
            >
              <Icon name="arrowRight" size={14} />
              <span className="sidebar-logout-label">Sign out</span>
            </button>
          </>
        )}
        {collapsed && (
          <button
            onClick={logout}
            title="Sign out"
            type="button"
            style={{
              display: "none", /* hidden in rail mode — user can expand to sign out */
            }}
          />
        )}
      </div>

      {!collapsed && (
        <div style={{ textAlign: "center", fontSize: "0.6rem", color: "var(--rp-text-muted)", opacity: 0.4, paddingBottom: 4 }}>
          © Aishwary Vansh 2026
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
