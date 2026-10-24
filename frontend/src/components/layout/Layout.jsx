import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { PAGES, useApp } from "../../contexts/AppContext";

const Layout = ({ children, onShowLanding }) => {
  const { activePage, activeCollectionId, mobileNavOpen, closeMobileNav } = useApp();
  const isImmersive = activePage === PAGES.CHAT;

  return (
    <div className={`research-app-shell ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
      <Sidebar onShowLanding={onShowLanding} />
      {/* Tap-to-close backdrop for the off-canvas sidebar on small screens */}
      <button
        type="button"
        className="mobile-nav-backdrop"
        aria-label="Close navigation"
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={closeMobileNav}
      />
      <div className="research-main-shell">
        <Topbar onShowLanding={onShowLanding} />
        <main className={`research-main ${isImmersive ? "research-main--immersive" : ""}`}>
          {/* Keyed so each page change replays the enter transition */}
          <div
            key={`${activePage}-${activeCollectionId || ""}`}
            className={`research-content page-enter ${isImmersive ? "research-content--full" : ""}`}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
