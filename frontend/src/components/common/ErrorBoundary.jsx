import { Component } from "react";
import { ActionButton, EmptyState } from "../research/ResearchComponents";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="not-found-shell">
          <EmptyState
            icon="alert"
            title="This research view could not render"
            description="DocLens caught the error and kept the shell alive so navigation does not collapse into a blank screen."
            action={<ActionButton icon="dashboard" onClick={() => window.location.assign("#/dashboard")}>Return to Dashboard</ActionButton>}
          />
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
