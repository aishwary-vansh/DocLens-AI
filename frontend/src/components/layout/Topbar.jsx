import { useEffect, useRef, useState } from "react";
import { useApp, PAGES } from "../../contexts/AppContext";
import { useAuth } from "../../contexts/AuthContext";
import useTheme from "../../hooks/useTheme";
import Icon from "../research/Icons";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

const Topbar = ({ onShowLanding }) => {
  const { activePage, navigateTo, routeMeta, sidebarCollapsed, toggleSidebar, mobileNavOpen } = useApp();
  const { user, logout } = useAuth();
  const { resolved: theme, toggle: toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const meta = routeMeta[activePage] || routeMeta[PAGES.DASHBOARD];
  const initials = (user?.name || user?.email || "D").trim()[0]?.toUpperCase();

  // ⌘K / Ctrl+K focuses search; "/" too when not typing elsewhere.
  useEffect(() => {
    const onKey = (event) => {
      const typing = /input|textarea|select/i.test(event.target?.tagName) || event.target?.isContentEditable;
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the account menu on outside click.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const submitSearch = (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    localStorage.setItem("doclens_last_query", query.trim());
    localStorage.setItem(
      "doclens_query_count",
      String(Number(localStorage.getItem("doclens_query_count") || 0) + 1)
    );
    searchRef.current?.blur();
    navigateTo(PAGES.CHAT);
  };

  const go = (page) => {
    setMenuOpen(false);
    navigateTo(page);
  };

  return (
    <header className="research-topbar">
      <button
        type="button"
        className="topbar-icon-button topbar-menu-toggle"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label="Toggle navigation"
        aria-expanded={mobileNavOpen}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2={sidebarCollapsed ? "20" : "15"} y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      <div className="topbar-title">
        <strong>{meta.title}</strong>
        <span>{meta.subtitle}</span>
      </div>

      <form className="topbar-search" onSubmit={submitSearch} role="search">
        <Icon name="search" size={16} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask your papers anything…"
          aria-label="Ask a research question"
        />
        <kbd className="topbar-kbd" aria-hidden="true">{isMac ? "⌘" : "Ctrl"} K</kbd>
      </form>

      <button
        type="button"
        className="topbar-icon-button"
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      >
        {theme === "dark" ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>

      <div className="topbar-account" ref={menuRef}>
        <button
          type="button"
          className={`topbar-avatar ${menuOpen ? "is-open" : ""}`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={user?.email || "Account"}
        >
          {initials}
        </button>
        {menuOpen && (
          <div className="topbar-menu" role="menu">
            <div className="topbar-menu-head">
              <strong>{user?.name || "Researcher"}</strong>
              <span>{user?.email}</span>
            </div>
            <button type="button" role="menuitem" onClick={() => go(PAGES.SETTINGS)}>
              <Icon name="settings" size={15} /> Account settings
            </button>
            <button type="button" role="menuitem" onClick={() => go(PAGES.PAPERS)}>
              <Icon name="upload" size={15} /> Upload a paper
            </button>
            {onShowLanding && (
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onShowLanding(); }}>
                <Icon name="spark" size={15} /> About DocLens
              </button>
            )}
            <div className="topbar-menu-sep" />
            <button type="button" role="menuitem" className="danger" onClick={logout}>
              <Icon name="arrowRight" size={15} /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Topbar;
