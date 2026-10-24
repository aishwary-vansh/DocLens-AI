import { useApp, PAGES } from "../contexts/AppContext";
import { ActionButton, EmptyState } from "../components/research/ResearchComponents";

const NotFoundPage = () => {
  const { navigateTo } = useApp();

  return (
    <div className="not-found-shell">
      <EmptyState
        icon="search"
        title="Page not found"
        description="This link does not match any page in DocLens. It may be mistyped or out of date."
        action={<ActionButton icon="dashboard" onClick={() => navigateTo(PAGES.DASHBOARD)}>Open Dashboard</ActionButton>}
      />
    </div>
  );
};

export default NotFoundPage;
