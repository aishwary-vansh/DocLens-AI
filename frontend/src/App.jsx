import { useCallback, useEffect, useRef } from "react";
import logoUrl from "@/assets/logo.png";
import { useAuth } from "./contexts/AuthContext";
import { AppProvider, useApp, PAGES, PUBLIC_PAGES } from "./contexts/AppContext";
import { ToastProvider } from "./contexts/ToastContext";
import { SocketProvider } from "./contexts/SocketContext";
import Layout from "./components/layout/Layout";
import ErrorBoundary from "./components/common/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import CollectionsPage from "./pages/CollectionsPage";
import CollectionPage from "./pages/CollectionPage";
import PapersPage from "./pages/PapersPage";
import ChatPage from "./pages/ChatPage";
import LiteratureReviewsPage from "./pages/LiteratureReviewsPage";
import ComparePapersPage from "./pages/ComparePapersPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
import "./styles/research-platform.css";
import "./styles/polish.css";
import "./styles/theme-light.css";
import "./styles/design-system.css";

function LoadingSplash() {
  return (
    <div style={{
      width: "100%",
      height: "100dvh",
      display: "grid",
      placeItems: "center",
      background: "#080b0d",
      color: "#ecf4f1",
      fontFamily: "Inter, sans-serif",
    }}>
      <div style={{ display: "grid", justifyItems: "center", gap: 12 }}>
        <div style={{
          width: 80,
          height: 80,
          animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        }}>
          <img src={logoUrl} alt="DocLens Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </div>
        <span style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(236,244,241,0.55)" }}>
          Loading DocLens
        </span>
      </div>
    </div>
  );
}

function ActivePage() {
  const { activePage } = useApp();

  if (activePage === PAGES.DASHBOARD) return <Dashboard />;
  if (activePage === PAGES.COLLECTIONS) return <CollectionsPage />;
  if (activePage === PAGES.COLLECTION) return <CollectionPage />;
  if (activePage === PAGES.PAPERS) return <PapersPage />;
  if (activePage === PAGES.CHAT) return <ChatPage />;
  if (activePage === PAGES.LITERATURE_REVIEWS) return <LiteratureReviewsPage />;
  if (activePage === PAGES.COMPARE_PAPERS) return <ComparePapersPage />;
  if (activePage === PAGES.SETTINGS) return <SettingsPage />;
  return <NotFoundPage />;
}

const AFTER_LOGIN_KEY = "doclens_after_login";

function AppInner() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const { activePage, activeCollectionId, navigateTo } = useApp();
  const isPublic = PUBLIC_PAGES.has(activePage);
  const isAuthPage = activePage === PAGES.LOGIN || activePage === PAGES.REGISTER;
  const wasAuthenticated = useRef(false);

  // Route guards. Hash routes are public (landing, login, register) or
  // protected (everything in the app shell, and unknown routes).
  useEffect(() => {
    if (isLoading) return;
    const signedOut = wasAuthenticated.current && !isAuthenticated;
    wasAuthenticated.current = isAuthenticated;
    if (signedOut) {
      // Signing out (from any menu) returns to the home page, with no stale return target.
      try { sessionStorage.removeItem(AFTER_LOGIN_KEY); } catch { /* ignore */ }
      if (!isPublic) navigateTo(PAGES.LANDING, null, null, { replace: true });
      return;
    }
    if (!isAuthenticated && !isPublic) {
      // Remember where the user was going, then ask them to sign in.
      try { sessionStorage.setItem(AFTER_LOGIN_KEY, window.location.hash); } catch { /* storage unavailable */ }
      navigateTo(PAGES.LOGIN, null, null, { replace: true });
    } else if (isAuthenticated && isAuthPage) {
      let next = "";
      try { next = sessionStorage.getItem(AFTER_LOGIN_KEY) || ""; sessionStorage.removeItem(AFTER_LOGIN_KEY); } catch { /* ignore */ }
      if (next && next.startsWith("#/") && !/^#\/(login|register|signup)?$/.test(next)) {
        window.history.replaceState(null, "", next);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else {
        navigateTo(PAGES.DASHBOARD, null, null, { replace: true });
      }
    }
  }, [isAuthenticated, isLoading, isPublic, isAuthPage, navigateTo]);

  const signOut = useCallback(() => {
    logout();
    navigateTo(PAGES.LANDING);
  }, [logout, navigateTo]);

  if (isLoading) return <LoadingSplash />;

  if (activePage === PAGES.LANDING) {
    return (
      <>
        {isAuthenticated && (
          // Signed-in visitors on the landing page get a way back into the app.
          <div className="landing-session-bar">
            <button type="button" className="landing-session-primary" onClick={() => navigateTo(PAGES.DASHBOARD)}>
              Open workspace →
            </button>
            <button type="button" className="landing-session-ghost" onClick={signOut}>Sign out</button>
          </div>
        )}
        <Landing onGetStarted={() => navigateTo(isAuthenticated ? PAGES.DASHBOARD : PAGES.REGISTER)} />
      </>
    );
  }

  if (isAuthPage) {
    if (isAuthenticated) return <LoadingSplash />; // redirecting to the app
    return (
      <Login
        mode={activePage === PAGES.REGISTER ? "register" : "login"}
        onModeChange={(mode) => navigateTo(mode === "register" ? PAGES.REGISTER : PAGES.LOGIN, null, null, { replace: true })}
        onBack={() => navigateTo(PAGES.LANDING)}
      />
    );
  }

  if (!isAuthenticated) return <LoadingSplash />; // redirecting to sign in

  return (
    <Layout onShowLanding={() => navigateTo(PAGES.LANDING)} onSignOut={signOut}>
      <ErrorBoundary resetKey={`${activePage}-${activeCollectionId || ""}`}>
        <ActivePage />
      </ErrorBoundary>
    </Layout>
  );
}

function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <SocketProvider>
          <AppInner />
        </SocketProvider>
      </ToastProvider>
    </AppProvider>
  );
}

export default App;
