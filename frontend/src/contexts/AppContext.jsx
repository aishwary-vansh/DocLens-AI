/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const PAGES = {
  LANDING: "landing",
  LOGIN: "login",
  REGISTER: "register",
  DASHBOARD: "dashboard",
  COLLECTIONS: "collections",
  PAPERS: "papers",
  CHAT: "chat",
  LITERATURE_REVIEWS: "literature-reviews",
  COMPARE_PAPERS: "compare-papers",
  SETTINGS: "settings",
  COLLECTION: "collection",
  NOT_FOUND: "not-found",
};

// Pages reachable without signing in. Everything else requires a session.
export const PUBLIC_PAGES = new Set(["landing", "login", "register"]);

const SIDEBAR_ROUTES = {
  [PAGES.LANDING]: "/",
  [PAGES.LOGIN]: "/login",
  [PAGES.REGISTER]: "/register",
  [PAGES.DASHBOARD]: "/dashboard",
  [PAGES.COLLECTIONS]: "/collections",
  [PAGES.PAPERS]: "/papers",
  [PAGES.CHAT]: "/research-chat",
  [PAGES.LITERATURE_REVIEWS]: "/literature-reviews",
  [PAGES.COMPARE_PAPERS]: "/compare-papers",
  [PAGES.SETTINGS]: "/settings",
};

const routeMeta = {
  [PAGES.DASHBOARD]: {
    title: "Dashboard",
    subtitle: "Your papers, collections and recent research",
  },
  [PAGES.COLLECTIONS]: {
    title: "Collections",
    subtitle: "Organize research domains, papers, notes, and literature reviews",
  },
  [PAGES.PAPERS]: {
    title: "Papers",
    subtitle: "Manage papers, processing status, citations, and collection context",
  },
  [PAGES.CHAT]: {
    title: "Research Chat",
    subtitle: "Ask grounded questions across papers with source references",
  },
  [PAGES.LITERATURE_REVIEWS]: {
    title: "Literature Reviews",
    subtitle: "Synthesize multi-paper insights and generate comprehensive reviews",
  },
  [PAGES.COMPARE_PAPERS]: {
    title: "Compare Papers",
    subtitle: "Analyze and synthesize differences across multiple documents side-by-side",
  },
  [PAGES.SETTINGS]: {
    title: "Settings",
    subtitle: "Research workspace preferences and account configuration",
  },
  [PAGES.COLLECTION]: {
    title: "Collection",
    subtitle: "Domain overview, papers, and analytics",
  },
  [PAGES.LANDING]: { title: "DocLens", subtitle: "" },
  [PAGES.LOGIN]: { title: "Sign in", subtitle: "" },
  [PAGES.REGISTER]: { title: "Create account", subtitle: "" },
  [PAGES.NOT_FOUND]: {
    title: "Page not found",
    subtitle: "This address does not exist",
  },
};

function parseHash() {
  const raw = window.location.hash.replace(/^#/, "");
  // In-page anchors on the landing page ("#features", "#pipeline") are not routes.
  if (raw && !raw.startsWith("/")) return { page: PAGES.LANDING, anchor: raw };
  const hash = raw.replace(/^\//, "").split("?")[0];
  const [route, id] = hash.split("/");

  if (!route) return { page: PAGES.LANDING };
  if (route === "login") return { page: PAGES.LOGIN };
  if (route === "register" || route === "signup") return { page: PAGES.REGISTER };
  if (route === "dashboard") return { page: PAGES.DASHBOARD };
  if (route === "collections" && id) return { page: PAGES.COLLECTION, collectionId: id };
  if (route === "collections") return { page: PAGES.COLLECTIONS };
  if (route === "papers") return { page: PAGES.PAPERS };
  if (route === "research-chat") return { page: PAGES.CHAT, collectionId: id || null };
  if (route === "literature-reviews") return { page: PAGES.LITERATURE_REVIEWS };
  if (route === "compare-papers") return { page: PAGES.COMPARE_PAPERS };
  if (route === "settings") return { page: PAGES.SETTINGS };

  return { page: PAGES.NOT_FOUND };
}

export function buildHash(page, collectionId) {
  if (page === PAGES.COLLECTION) return `/collections/${collectionId || ""}`;
  if (page === PAGES.CHAT && collectionId) return `/research-chat/${collectionId}`;
  return SIDEBAR_ROUTES[page] || "/dashboard";
}

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const initial = parseHash();
  const [activePage, setActivePageState] = useState(initial.page);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [activeCollectionId, setActiveCollectionId] = useState(initial.collectionId || null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("doclens_sidebar_collapsed") === "1"; } catch { return false; }
  });
  // Off-canvas navigation on narrow screens (< 900px).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setMobileNavOpen(v => !v);
      return;
    }
    setSidebarCollapsed(v => {
      try { localStorage.setItem("doclens_sidebar_collapsed", v ? "0" : "1"); } catch { /* storage unavailable */ }
      return !v;
    });
  }, []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHash();
      setActivePageState(next.page);
      setActiveCollectionId(next.collectionId || null);
      setMobileNavOpen(false);
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  /** `replace` swaps the history entry (used for redirects, so Back does not loop). */
  const navigateTo = useCallback((page, workspaceId = null, collectionId = null, { replace = false } = {}) => {
    setActivePageState(page);
    setActiveWorkspaceId(workspaceId);
    setActiveCollectionId(collectionId);
    setMobileNavOpen(false);

    const nextHash = `#${buildHash(page, collectionId)}`;
    if (window.location.hash !== nextHash) {
      if (replace) window.history.replaceState(null, "", nextHash);
      else window.location.hash = nextHash;
    }
  }, []);

  const setActivePage = useCallback((page) => {
    navigateTo(page);
  }, [navigateTo]);

  const value = useMemo(
    () => ({
      activePage,
      activeWorkspaceId,
      activeCollectionId,
      setActivePage,
      navigateTo,
      routeMeta,
      PAGES,
      sidebarCollapsed,
      toggleSidebar,
      mobileNavOpen,
      closeMobileNav,
    }),
    [activeCollectionId, activePage, activeWorkspaceId, navigateTo, setActivePage, sidebarCollapsed, toggleSidebar, mobileNavOpen, closeMobileNav],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
};
