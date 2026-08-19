import { useState } from "react";
import { useApp, PAGES } from "../../contexts/AppContext";
import Icon from "../research/Icons";

const Topbar = () => {
  const { activePage, navigateTo, routeMeta, sidebarCollapsed, toggleSidebar } = useApp();
  const [query, setQuery] = useState("");
  const meta = routeMeta[activePage] || routeMeta[PAGES.DASHBOARD];

  const submitSearch = (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    localStorage.setItem("doclens_last_query", query.trim());
    localStorage.setItem(
      "doclens_query_count",
      String(Number(localStorage.getItem("doclens_query_count") || 0) + 1)
    );
    navigateTo(PAGES.CHAT);
  };

  return (
    <header className="research-topbar">
      {/* Sidebar collapse toggle */}
      <button
        type="button"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: 8,
          border: "1px solid var(--rp-border)",
          background: sidebarCollapsed ? "rgba(129,140,248,0.08)" : "transparent",
          color: sidebarCollapsed ? "var(--rp-indigo)" : "var(--rp-text-muted)",
          cursor: "pointer",
          flexShrink: 0,
          transition: "all 0.18s",
          marginRight: 4,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "rgba(129,140,248,0.12)";
          e.currentTarget.style.color = "var(--rp-indigo)";
          e.currentTarget.style.borderColor = "rgba(129,140,248,0.3)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = sidebarCollapsed ? "rgba(129,140,248,0.08)" : "transparent";
          e.currentTarget.style.color = sidebarCollapsed ? "var(--rp-indigo)" : "var(--rp-text-muted)";
          e.currentTarget.style.borderColor = "var(--rp-border)";
        }}
      >
        {/* Hamburger / close icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {sidebarCollapsed ? (
            // Chevron right (expand)
            <path d="M9 18l6-6-6-6" />
          ) : (
            // Hamburger lines (collapse)
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      <div className="topbar-title">
        <strong>{meta.title}</strong>
        <span>{meta.subtitle}</span>
      </div>

      <form className="topbar-search" onSubmit={submitSearch}>
        <Icon name="search" size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search papers, concepts, citations..."
          aria-label="Semantic research search"
        />
      </form>

      <div className="topbar-status">
        <i />
        Research corpus ready
      </div>
    </header>
  );
};

export default Topbar;
