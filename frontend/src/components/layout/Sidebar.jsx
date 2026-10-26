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
  const { activePage, navigateTo, sidebarCollapsed, mobileNavOpen } = useApp();
  const { logout, user } = useAuth();
  const socket = useSocket();
  const { apiOk, pipelineOk } = useServiceHealth();
  const initials = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "D";
  const activeNavPage = activePage === PAGES.COLLECTION ? PAGES.COLLECTIONS : activePage;
  // The off-canvas drawer (narrow screens) always shows labels.
  const collapsed = sidebarCollapsed && !mobileNavOpen;

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
        <span className="brand-glyph" aria-hidden="true" style={{ width: collapsed ? 30 : 32, height: collapsed ? 30 : 32 }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
            <path d="M14 3l5 5v3" />
            <circle cx="16.5" cy="16.5" r="3.5" />
            <path d="M19 19l2 2" />
          </svg>
        </span>
        {!collapsed && (
          <div style={{ overflow: "hidden" }}>
            <strong style={{ fontSize: "0.9rem" }}>DocLens</strong>
            <span style={{ fontSize: "0.68rem" }}>Research assistant</span>
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

      {/* Status — one calm line when healthy, an explanation when something is down */}
      {!collapsed && (() => {
        const checks = [
          { label: "API", ok: apiOk },
          { label: "Live updates", ok: socket?.connected ?? null },
          { label: "AI service", ok: pipelineOk },
        ];
        const down = checks.filter((c) => c.ok === false);
        const checking = checks.some((c) => c.ok === null);
        return (
          <section
            className={`sidebar-status ${down.length ? "is-down" : ""}`}
            aria-label="Service status"
            aria-live="polite"
          >
            <div className="sidebar-status-line">
              <i style={dot(down.length ? false : checking ? null : true)} />
              <span>{down.length ? `${down.map((c) => c.label).join(", ")} unavailable` : checking ? "Checking services…" : "All systems normal"}</span>
            </div>
            {down.length > 0 && (
              <p>Uploads and answers may fail until {down.length > 1 ? "they reconnect" : "it reconnects"}. DocLens keeps retrying.</p>
            )}
          </section>
        );
      })()}

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

    </aside>
  );
};

export default Sidebar;
