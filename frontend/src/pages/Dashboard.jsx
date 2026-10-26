import { useEffect, useMemo, useState } from "react";
import { useApp, PAGES } from "../contexts/AppContext";
import { useAuth } from "../contexts/AuthContext";
import { queryApi } from "../services/api";
import useResearchCorpus from "../hooks/useResearchCorpus";
import {
  ActionButton,
  ActivityTimeline,
  EmptyState,
  ErrorNotice,
  LoadingSkeleton,
  PageHeader,
  Panel,
  PaperSummaryLine,
  ResearchStatCard,
} from "../components/research/ResearchComponents";
import Icon from "../components/research/Icons";
import { ColumnChart, CollectionBars, StatusMeter, buildActivitySeries, viewerTimeZone } from "../components/research/DashboardCharts";
import { buildActivityFeed, buildResearchStats } from "../utils/researchData";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];
const RANGE_KEY = "doclens_dashboard_range";

function readRange() {
  try {
    const value = Number(localStorage.getItem(RANGE_KEY));
    return RANGES.some((r) => r.days === value) ? value : 30;
  } catch {
    return 30;
  }
}

// Getting Started removed to save vertical space

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const QUICK_ACTIONS = [
  { page: PAGES.CHAT, icon: "chat", title: "Ask a question", text: "Cited answers from your papers", tone: "blue" },
  { page: PAGES.PAPERS, icon: "upload", title: "Upload papers", text: "PDFs are parsed and indexed", tone: "green" },
  { page: PAGES.COMPARE_PAPERS, icon: "spark", title: "Compare papers", text: "Methods, data and results side by side", tone: "amber" },
  { page: PAGES.LITERATURE_REVIEWS, icon: "book", title: "Literature review", text: "Synthesis and research gaps", tone: "rose" },
];

const Dashboard = () => {
  const { navigateTo } = useApp();
  const { user } = useAuth();
  const { workspaces, collections, papers, loading, error } = useResearchCorpus();
  const [rangeDays, setRangeDays] = useState(readRange);
  // Server-side counts (queries, reviews); the local corpus covers the rest.
  const [serverStats, setServerStats] = useState(null);

  // Refetch whenever the corpus reloads (upload, delete, status change) so the counts never lag.
  useEffect(() => {
    let cancelled = false;
    queryApi.analytics(viewerTimeZone()).then((value) => { if (!cancelled) setServerStats(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [papers, collections]);

  const stats = useMemo(
    () => buildResearchStats({ workspaces, collections, papers, serverStats }),
    [collections, papers, workspaces, serverStats],
  );
  const firstName = (user?.name || "").trim().split(/\s+/)[0];
  const activity = useMemo(() => buildActivityFeed({ collections, papers }), [collections, papers]);
  const series = useMemo(
    () => buildActivitySeries({ papers, queriesByDay: serverStats?.queriesByDay || [], rangeDays }),
    [papers, serverStats, rangeDays],
  );
  const chooseRange = (days) => {
    setRangeDays(days);
    try { localStorage.setItem(RANGE_KEY, String(days)); } catch { /* storage unavailable */ }
  };

  const processingQueue = papers.filter(p => !["READY", "COMPLETED", "FAILED"].includes(p.status));

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}.`}
        description={
          stats.processing
            ? `${stats.processing} paper${stats.processing === 1 ? " is" : "s are"} being indexed. Everything else is ready to question.`
            : "Your papers are indexed and ready. Ask a question, compare studies or draft a review."
        }
        actions={(
          <>
            <ActionButton icon="upload" onClick={() => navigateTo(PAGES.PAPERS)}>Upload Paper</ActionButton>
          </>
        )}
      />

      <ErrorNotice message={error && "Live corpus data unavailable. The research workspace shell is still ready."} />

      <nav className="dash-quick-actions" aria-label="Quick actions">
        {QUICK_ACTIONS.map((action) => (
          <button key={action.page} type="button" className={`dash-quick-action tone-${action.tone}`} onClick={() => navigateTo(action.page)}>
            <span className="qa-icon"><Icon name={action.icon} size={18} /></span>
            <span className="qa-text">
              <strong>{action.title}</strong>
              <small>{action.text}</small>
            </span>
          </button>
        ))}
      </nav>


      {/* Stats row */}
      <section className="stat-grid" aria-label="Library totals">
        <ResearchStatCard icon="papers" label="Papers Uploaded" value={stats.papersUploaded} growth={`${stats.completed} ready for analysis`} description="PDFs imported into the research library." tone="blue" onClick={() => navigateTo(PAGES.PAPERS)} />
        <ResearchStatCard icon="collections" label="Collections" value={stats.collectionsCreated} growth={`${stats.workspaces} workspace${stats.workspaces !== 1 ? "s" : ""}`} description="Research domains used to organize papers." tone="green" onClick={() => navigateTo(PAGES.COLLECTIONS)} />
        <ResearchStatCard icon="book" label="Literature Reviews" value={stats.literatureReviews} growth="multi-paper reports" description="Generated reviews synthesizing multiple sources." tone="cyan" onClick={() => navigateTo(PAGES.LITERATURE_REVIEWS)} />
        <ResearchStatCard icon="citation" label="Citations" value={stats.citationsGenerated} growth="source-aware answers" description="Citation anchors available for paper Q&A." tone="amber" />
        <ResearchStatCard icon="chat" label="Queries Asked" value={stats.queriesAsked} growth="research chat history" description="Semantic questions asked across the corpus." tone="violet" onClick={() => navigateTo(PAGES.CHAT)} />

      </section>

      {/* Activity over time + index status */}
      <section className="dash-viz-grid">
        <Panel
          className="dash-viz-wide"
          title="Library activity"
          eyebrow={`Last ${rangeDays} days`}
          action={(
            <div className="viz-range" role="group" aria-label="Time range">
              {RANGES.map((range) => (
                <button
                  key={range.days}
                  type="button"
                  className={range.days === rangeDays ? "is-active" : ""}
                  aria-pressed={range.days === rangeDays}
                  onClick={() => chooseRange(range.days)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          )}
        >
          <div className={`dash-viz-pair ${serverStats ? "" : "is-refreshing"}`}>
            <ColumnChart title={rangeDays > 30 ? "Papers added per week" : "Papers added per day"} data={series} field="papers" unit="papers" />
            <ColumnChart title={rangeDays > 30 ? "Questions asked per week" : "Questions asked per day"} data={series} field="questions" unit="questions" />
          </div>
        </Panel>

        <Panel title="Index status" eyebrow={`${papers.length} paper${papers.length === 1 ? "" : "s"}`}>
          <div className="panel-padding">
            {loading ? <LoadingSkeleton rows={3} /> : <StatusMeter papers={papers} onSelect={() => navigateTo(PAGES.PAPERS)} />}
            {processingQueue.length > 0 && (
              <ul className="dash-queue" aria-label="Papers being indexed">
                {processingQueue.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <span className="dash-queue-title">{p.title}</span>
                    <span className="dash-queue-status">{p.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </section>

      {/* Collections, recent papers, activity */}
      <section className="dash-viz-grid dash-viz-thirds">
        <Panel title="Papers by collection" eyebrow="Library">
          <div className="panel-padding dash-scroll">
            {collections.length ? (
              <CollectionBars
                collections={collections}
                papers={papers}
                onOpen={(row) => navigateTo(PAGES.COLLECTION, row.workspaceId, row.id)}
              />
            ) : (
              <EmptyState compact icon="collections"
                title="No collections yet"
                description="Collections group papers by topic."
                action={<ActionButton icon="plus" onClick={() => navigateTo(PAGES.COLLECTIONS)}>Create collection</ActionButton>}
              />
            )}
          </div>
        </Panel>

        <Panel title="Recent papers" eyebrow="Library">
          <div className="dash-scroll">
            {loading ? (
              <LoadingSkeleton rows={4} />
            ) : papers.length ? (
              papers.slice(0, 6).map(p => <PaperSummaryLine key={p.id} paper={p} />)
            ) : (
              <EmptyState compact icon="papers"
                title="No papers uploaded yet"
                description="Upload your first research paper to start building your library."
                action={<ActionButton icon="upload" onClick={() => navigateTo(PAGES.PAPERS)}>Upload paper</ActionButton>}
              />
            )}
          </div>
        </Panel>

        <Panel title="Recent activity" eyebrow="Timeline">
          <div className="dash-scroll" style={{ padding: "10px 18px" }}>
            <ActivityTimeline items={activity} />
          </div>
        </Panel>
      </section>
    </>
  );
};

export default Dashboard;
