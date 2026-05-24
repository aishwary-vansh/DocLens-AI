import { useApp, PAGES } from "../contexts/AppContext";
import { ActionButton, EmptyState } from "../components/research/ResearchComponents";

const NotFoundPage = () => {
  const { navigateTo } = useApp();

  return (
    <div className="not-found-shell">
      <EmptyState
        icon="search"
        title="Research route not found"
        description="This sidebar destination or deep link does not exist. Use the Research Command Center to continue without losing the app shell."
        action={<ActionButton icon="dashboard" onClick={() => navigateTo(PAGES.DASHBOARD)}>Open Dashboard</ActionButton>}
      />
    </div>
  );
};

export default NotFoundPage;
