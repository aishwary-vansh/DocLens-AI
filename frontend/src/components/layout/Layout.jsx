import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

const Layout = ({ children }) => (
  <div className="research-app-shell">
    <Sidebar />
    <div className="research-main-shell">
      <Topbar />
      <main className="research-main">
        <div className="research-content">{children}</div>
      </main>
    </div>
  </div>
);

export default Layout;
