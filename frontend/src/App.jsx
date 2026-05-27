import { useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import { AppProvider, useApp, PAGES } from "./contexts/AppContext";
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
import NotesPage from "./pages/NotesPage";
import ReadingListPage from "./pages/ReadingListPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
import CustomCursor from "./components/common/CustomCursor";
import "./styles/research-platform.css";

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
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "2px solid rgba(236,244,241,0.12)",
          borderTopColor: "#6ee7f9",
          animation: "spin 0.8s linear infinite",
        }} />
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
  if (activePage === PAGES.NOTES) return <NotesPage />;
  if (activePage === PAGES.READING_LIST) return <ReadingListPage />;
  if (activePage === PAGES.ANALYTICS) return <AnalyticsPage />;
  if (activePage === PAGES.SETTINGS) return <SettingsPage />;
  return <NotFoundPage />;
}

function AppInner() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const { activePage, activeCollectionId } = useApp();
  const [showLogin, setShowLogin] = useState(false);
  const [showLanding, setShowLanding] = useState(false);

  if (isLoading) return <LoadingSplash />;

  // Authenticated user explicitly asked to see the landing page
  if (isAuthenticated && showLanding) {
    return (
      <>
        <CustomCursor />
        {/* Floating banner so the user can get back into the app */}
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <button
            onClick={() => setShowLanding(false)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(110,231,249,0.35)',
              background: 'rgba(110,231,249,0.12)', color: '#6ee7f9',
              fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer',
            }}
          >
            ← Back to App
          </button>
          <button
            onClick={logout}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(242,139,130,0.35)',
              background: 'rgba(242,139,130,0.1)', color: '#f28b82',
              fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
        <Landing onGetStarted={() => setShowLanding(false)} />
      </>
    );
  }

  if (!isAuthenticated) {
    if (showLogin) {
      return (
        <>
          <CustomCursor />
          <Login />
        </>
      );
    }
    return <Landing onGetStarted={() => setShowLogin(true)} />;
  }

  return (
    <>
      <CustomCursor />
      <Layout onShowLanding={() => setShowLanding(true)}>
        <ErrorBoundary resetKey={`${activePage}-${activeCollectionId || ""}`}>
          <ActivePage />
        </ErrorBoundary>
      </Layout>
    </>
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
