/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const PAGES = {
  DASHBOARD: "dashboard",
  COLLECTIONS: "collections",
  PAPERS: "papers",
  CHAT: "chat",
  LITERATURE_REVIEWS: "literature-reviews",
  COMPARE_PAPERS: "compare-papers",
  NOTES: "notes",
  READING_LIST: "reading-list",
  ANALYTICS: "analytics",
  SETTINGS: "settings",
  COLLECTION: "collection",
  NOT_FOUND: "not-found",
};

const SIDEBAR_ROUTES = {
  [PAGES.DASHBOARD]: "/dashboard",
  [PAGES.COLLECTIONS]: "/collections",
  [PAGES.PAPERS]: "/papers",
  [PAGES.CHAT]: "/research-chat",
  [PAGES.LITERATURE_REVIEWS]: "/literature-reviews",
  [PAGES.COMPARE_PAPERS]: "/compare-papers",
  [PAGES.NOTES]: "/notes",
  [PAGES.READING_LIST]: "/reading-list",
  [PAGES.ANALYTICS]: "/analytics",
  [PAGES.SETTINGS]: "/settings",
};

const routeMeta = {
  [PAGES.DASHBOARD]: {
    title: "Research Command Center",
    subtitle: "Corpus health and research discovery velocity",
  },
  [PAGES.COLLECTIONS]: {
    title: "Research Collections",
    subtitle: "Organize research domains, papers, notes, and literature reviews",
  },
  [PAGES.PAPERS]: {
    title: "Research Library",
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
  [PAGES.NOTES]: {
    title: "Research Notes",
    subtitle: "Capture and organize domain knowledge, insights, and summaries",
  },
  [PAGES.READING_LIST]: {
    title: "Reading List",
    subtitle: "Track your reading progress across all research documents",
  },
  [PAGES.ANALYTICS]: {
    title: "Research Analytics",
    subtitle: "Track library growth and research velocity",
  },
  [PAGES.SETTINGS]: {
    title: "Settings",
    subtitle: "Research workspace preferences and account configuration",
  },
  [PAGES.COLLECTION]: {
    title: "Collection Intelligence",
    subtitle: "Domain overview, papers, and analytics",
  },
  [PAGES.NOT_FOUND]: {
    title: "Route Not Found",
    subtitle: "This research route is not available",
  },
};

function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [route, id] = hash.split("/");

  if (!route || route === "dashboard") return { page: PAGES.DASHBOARD };
  if (route === "collections" && id) return { page: PAGES.COLLECTION, collectionId: id };
  if (route === "collections") return { page: PAGES.COLLECTIONS };
  if (route === "papers") return { page: PAGES.PAPERS };
  if (route === "research-chat") return { page: PAGES.CHAT, collectionId: id || null };
  if (route === "literature-reviews") return { page: PAGES.LITERATURE_REVIEWS };
  if (route === "compare-papers") return { page: PAGES.COMPARE_PAPERS };
  if (route === "notes") return { page: PAGES.NOTES };
  if (route === "reading-list") return { page: PAGES.READING_LIST };
  if (route === "analytics") return { page: PAGES.ANALYTICS };
  if (route === "settings") return { page: PAGES.SETTINGS };

  return { page: PAGES.NOT_FOUND };
}

function buildHash(page, collectionId) {
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

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHash();
      setActivePageState(next.page);
      setActiveCollectionId(next.collectionId || null);
    };

    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) window.history.replaceState(null, "", "#/dashboard");
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigateTo = useCallback((page, workspaceId = null, collectionId = null) => {
    setActivePageState(page);
    setActiveWorkspaceId(workspaceId);
    setActiveCollectionId(collectionId);

    const nextHash = `#${buildHash(page, collectionId)}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
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
    }),
    [activeCollectionId, activePage, activeWorkspaceId, navigateTo, setActivePage],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
};
