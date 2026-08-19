import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { PAGES, useApp } from "../../contexts/AppContext";

const Layout = ({ children, onShowLanding }) => {
  const { activePage } = useApp();
  const isImmersive = activePage === PAGES.CHAT;

  return (
    <div className="research-app-shell">
      <Sidebar onShowLanding={onShowLanding} />
      <div className="research-main-shell">
        <Topbar />
        <main className={`research-main ${isImmersive ? "research-main--immersive" : ""}`}>
          <div className={`research-content ${isImmersive ? "research-content--full" : ""}`}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
