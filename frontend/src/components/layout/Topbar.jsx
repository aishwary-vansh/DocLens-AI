import { useState } from "react";
import { useApp, PAGES } from "../../contexts/AppContext";
import Icon from "../research/Icons";

const Topbar = () => {
  const { activePage, navigateTo, routeMeta } = useApp();
  const [query, setQuery] = useState("");
  const meta = routeMeta[activePage] || routeMeta[PAGES.DASHBOARD];

  const submitSearch = (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    localStorage.setItem("doclens_last_query", query.trim());
    localStorage.setItem("doclens_query_count", String(Number(localStorage.getItem("doclens_query_count") || 0) + 1));
    navigateTo(PAGES.CHAT);
  };

  return (
    <header className="research-topbar">
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
