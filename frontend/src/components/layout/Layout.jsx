import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

const Layout = ({ children, onShowLanding }) => (
  <div className="research-app-shell">
    <Sidebar onShowLanding={onShowLanding} />
    <div className="research-main-shell">
      <Topbar />
      <main className="research-main">
        <div className="research-content">{children}</div>
      </main>
    </div>
  </div>
);

export default Layout;
