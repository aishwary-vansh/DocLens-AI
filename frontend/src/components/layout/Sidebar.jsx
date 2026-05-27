import { useApp, PAGES } from "../../contexts/AppContext";
import { useAuth } from "../../contexts/AuthContext";
import { useSocket } from "../../contexts/SocketContext";
import Icon from "../research/Icons";

const NAV_ITEMS = [
  { id: PAGES.DASHBOARD, label: "Dashboard", icon: "dashboard" },
  { id: PAGES.COLLECTIONS, label: "Collections", icon: "collections" },
  { id: PAGES.PAPERS, label: "Papers", icon: "papers" },
  { id: PAGES.CHAT, label: "Research Chat", icon: "chat" },
  { id: PAGES.COMPARE_PAPERS, label: "Compare Papers", icon: "spark" },
  { id: PAGES.LITERATURE_REVIEWS, label: "Literature Reviews", icon: "book" },
  { id: PAGES.NOTES, label: "Research Notes", icon: "papers" },
  { id: PAGES.READING_LIST, label: "Reading List", icon: "dashboard" },
  { id: PAGES.ANALYTICS, label: "Analytics", icon: "analytics" },
  { id: PAGES.SETTINGS, label: "Settings", icon: "settings" },
];

const Sidebar = ({ onShowLanding }) => {
  const { activePage, navigateTo } = useApp();
  const { logout, user } = useAuth();
  const socket = useSocket();
  const initials = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "D";
  const activeNavPage = activePage === PAGES.COLLECTION ? PAGES.COLLECTIONS : activePage;

  return (
    <aside className="research-sidebar" aria-label="Research workspace navigation">
      <button
        className="brand-lockup brand-lockup-btn"
        onClick={onShowLanding}
        title="View DocLens landing page"
        type="button"
        style={{ background: 'none', border: 'none', cursor: onShowLanding ? 'pointer' : 'default', padding: 0, width: '100%', textAlign: 'left' }}
      >
        <div className="brand-mark"><Icon name="spark" size={20} /></div>
        <div>
          <strong>DocLens</strong>
          <span>Research Intelligence</span>
        </div>
      </button>

      <div className="sidebar-section-label">Workspace</div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            className={`sidebar-nav-button ${activeNavPage === item.id ? "active" : ""}`}
            key={item.id}
            onClick={() => navigateTo(item.id)}
            type="button"
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <section className="sidebar-signal-panel" aria-label="Research platform status">
        <strong>Corpus Intelligence</strong>
        <p>Semantic search, citation grounding, and text summarization.</p>
        <div className="signal-row"><span>API</span><i /></div>
        <div className="signal-row"><span>Realtime indexing</span><i style={{ opacity: socket?.connected ? 1 : 0.35 }} /></div>
        <div className="signal-row"><span>Analysis pipeline</span><i style={{ background: "var(--rp-amber)", opacity: 0.8 }} /></div>
      </section>

      <div className="sidebar-user">
        <div className="sidebar-avatar">{initials}</div>
        <div>
          <strong>{user?.name || "Researcher"}</strong>
          <span>{user?.email || "doclens user"}</span>
        </div>
        <button className="sidebar-logout" onClick={logout} title="Sign out of DocLens" aria-label="Sign out" type="button">
          <Icon name="arrowRight" size={14} />
          <span className="sidebar-logout-label">Sign out</span>
        </button>
      </div>
      <div style={{ textAlign: 'center', fontSize: '0.65rem', color: 'var(--rp-text-muted)', opacity: 0.5, marginTop: 10 }}>
        © Aishwary Vansh 2026
      </div>
    </aside>
  );
};

export default Sidebar;
