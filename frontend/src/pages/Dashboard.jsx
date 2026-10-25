import { useEffect, useMemo, useState } from "react";
import { useApp, PAGES } from "../contexts/AppContext";
import { useAuth } from "../contexts/AuthContext";
import { queryApi } from "../services/api";
import useResearchCorpus from "../hooks/useResearchCorpus";
import {
  ActionButton,
  ActivityTimeline,
  CollectionCard,
  EmptyState,
  ErrorNotice,
  LoadingSkeleton,
  PageHeader,
  Panel,
  PaperSummaryLine,
  ResearchStatCard,
} from "../components/research/ResearchComponents";
import Icon from "../components/research/Icons";
import {
  buildActivityFeed,
  buildResearchStats,
  getCollectionMetrics,
  sampleQueries,
  suggestedCollections,
} from "../utils/researchData";

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
  const [semanticQuery, setSemanticQuery] = useState(localStorage.getItem("doclens_last_query") || "");
  // Server-side counts (queries, reviews); the local corpus covers the rest.
  const [serverStats, setServerStats] = useState(null);

  // Refetch whenever the corpus reloads (upload, delete, status change) so the counts never lag.
  useEffect(() => {
    let cancelled = false;
    queryApi.analytics().then((value) => { if (!cancelled) setServerStats(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [papers, collections]);

  const stats = useMemo(
    () => buildResearchStats({ workspaces, collections, papers, serverStats }),
    [collections, papers, workspaces, serverStats],
  );
  const firstName = (user?.name || "").trim().split(/\s+/)[0];
  const activity = useMemo(() => buildActivityFeed({ collections, papers }), [collections, papers]);
  const visibleCollections = collections.length ? collections.slice(0, 4) : suggestedCollections;

  const runQuery = () => {
    if (semanticQuery.trim()) {
      localStorage.setItem("doclens_last_query", semanticQuery.trim());
      localStorage.setItem("doclens_query_count", String(Number(localStorage.getItem("doclens_query_count") || 0) + 1));
    }
    navigateTo(PAGES.CHAT);
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


      {/* Command panel */}
      <section style={{ marginTop: 14 }}>
        <div className="research-command-panel">
          <div className="command-search">
            <div>
              <h2>Ask your papers</h2>
              <p>Answers quote and cite the passages they come from, and say so when your papers do not cover the question.</p>
            </div>
            <div className="semantic-input">
              <Icon name="search" size={18} />
              <input
                value={semanticQuery}
                onChange={e => setSemanticQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runQuery()}
                placeholder={sampleQueries[stats.queriesAsked % sampleQueries.length]}
              />
              <button type="button" onClick={runQuery} aria-label="Start research query">
                <Icon name="arrowRight" size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats row */}
      <section className="stat-grid" aria-label="Library totals">
        <ResearchStatCard icon="papers" label="Papers Uploaded" value={stats.papersUploaded} growth={`${stats.completed} ready for analysis`} description="PDFs imported into the research library." tone="blue" onClick={() => navigateTo(PAGES.PAPERS)} />
        <ResearchStatCard icon="collections" label="Collections" value={stats.collectionsCreated} growth={`${stats.workspaces} workspace${stats.workspaces !== 1 ? "s" : ""}`} description="Research domains used to organize papers." tone="green" onClick={() => navigateTo(PAGES.COLLECTIONS)} />
        <ResearchStatCard icon="book" label="Literature Reviews" value={stats.literatureReviews} growth="multi-paper reports" description="Generated reviews synthesizing multiple sources." tone="cyan" onClick={() => navigateTo(PAGES.LITERATURE_REVIEWS)} />
        <ResearchStatCard icon="citation" label="Citations" value={stats.citationsGenerated} growth="source-aware answers" description="Citation anchors available for paper Q&A." tone="amber" />
        <ResearchStatCard icon="chat" label="Queries Asked" value={stats.queriesAsked} growth="research chat history" description="Semantic questions asked across the corpus." tone="violet" onClick={() => navigateTo(PAGES.CHAT)} />

      </section>

      {/* Research Collections (Full Width) */}
      <section className="full-width-section">
        <Panel title="Research Collections" eyebrow="Domains">
          <div className="panel-padding">
            <div className="collection-card-grid">
              {visibleCollections.map(collection => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  metrics={getCollectionMetrics(collection, papers)}
                  suggested={!collections.length}
                  onOpen={() => navigateTo(PAGES.COLLECTION, collection.workspaceId, collection.id)}
                />
              ))}
            </div>
          </div>
        </Panel>
      </section>

      {/* Recent Papers + Activity Feed (Side-by-side, perfectly even heights) */}
      <section className="dashboard-section-grid">
        <Panel title="Recent Papers" eyebrow="Research library">
          <div style={{ height: "420px", overflowY: "auto", overflowX: "hidden" }}>
            {loading ? (
              <LoadingSkeleton rows={4} />
            ) : papers.length ? (
              papers.slice(0, 6).map(p => <PaperSummaryLine key={p.id} paper={p} />)
            ) : (
              <EmptyState compact icon="papers"
                title="No papers uploaded yet"
                description="Upload your first research paper to start building your library."
                action={<ActionButton icon="upload" onClick={() => navigateTo(PAGES.PAPERS)}>Upload Paper</ActionButton>}
              />
            )}
          </div>
        </Panel>

        <Panel title="Research Activity Feed" eyebrow="Timeline">
          <div style={{ height: "420px", overflowY: "auto", overflowX: "hidden", padding: "10px 18px" }}>
            <ActivityTimeline items={activity} />
          </div>
        </Panel>
      </section>

      {/* Processing Queue (Full width, slim fallback) */}
      <section className="full-width-section">
        <Panel title="Processing Queue" eyebrow={processingQueue.length > 0 ? `${processingQueue.length} in pipeline` : "Pipeline"}>
          {processingQueue.length > 0 ? (
            <div style={{ padding: "10px 20px" }}>
              {processingQueue.map(p => (
                <div key={p.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--rp-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
                    <strong style={{ fontSize: "0.84rem", color: "var(--rp-text)" }}>{p.title}</strong>
                    <span style={{ fontFamily: "var(--rp-mono)", fontSize: "0.65rem", color: "var(--rp-amber)" }}>{p.status}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                    {["UPLOADED", "PROCESSING", "READY"].map((s, i) => {
                      const isProcessing = ["EXTRACTING", "CHUNKING", "EMBEDDING", "INDEXING"].includes(p.status);
                      const isReady = ["READY", "COMPLETED"].includes(p.status);
                      const stageIdx = isReady ? 2 : isProcessing ? 1 : 0;
                      return (
                        <div key={s} style={{
                          flex: 1, height: 3, borderRadius: 2,
                          background: i < stageIdx ? "var(--rp-green)" : i === stageIdx ? "var(--rp-cyan)" : "rgba(255,255,255,0.08)",
                        }} />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--rp-text-muted)", fontSize: "0.8rem" }}>
              Queue is empty.
            </div>
          )}
        </Panel>
      </section>
    </>
  );
};

export default Dashboard;
