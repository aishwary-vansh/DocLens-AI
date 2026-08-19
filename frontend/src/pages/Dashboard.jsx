import { useMemo, useState } from "react";
import { useApp, PAGES } from "../contexts/AppContext";
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

const Dashboard = () => {
  const { navigateTo } = useApp();
  const { workspaces, collections, papers, loading, error } = useResearchCorpus();
  const [semanticQuery, setSemanticQuery] = useState(localStorage.getItem("doclens_last_query") || "");

  const stats = useMemo(() => buildResearchStats({ workspaces, collections, papers }), [collections, papers, workspaces]);
  const activity = useMemo(() => buildActivityFeed({ collections, papers }), [collections, papers]);
  const visibleCollections = collections.length ? collections.slice(0, 4) : suggestedCollections;
  const hasQuery = Number(localStorage.getItem("doclens_query_count") || 0) > 0;

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
        eyebrow="Research Command Center"
        title="Paper intelligence, not another dashboard."
        description="DocLens turns uploaded papers into searchable collections and citation-aware answers."
        actions={(
          <>
            <ActionButton icon="upload" onClick={() => navigateTo(PAGES.PAPERS)}>Upload Paper</ActionButton>
          </>
        )}
      />

      <ErrorNotice message={error && "Live corpus data unavailable. The research workspace shell is still ready."} />



      {/* Command panel */}
      <section style={{ marginTop: 14 }}>
        <div className="research-command-panel">
          <div>
            <div className="eyebrow">Research Overview</div>
            <div className="overview-metrics">
              <div className="overview-metric">
                <strong>{papers.length > 0 ? stats.papersUploaded : "—"}</strong>
                <span>Total papers</span>
              </div>
              <div className="overview-metric">
                <strong>{collections.length > 0 ? stats.collectionsCreated : "—"}</strong>
                <span>Active collections</span>
              </div>
              <div className="overview-metric">
                <strong>{stats.queriesAsked > 0 ? stats.queriesAsked : "—"}</strong>
                <span>Recent queries</span>
              </div>
              <div className="overview-metric">
                <strong>{stats.conceptsExtracted > 0 ? stats.conceptsExtracted : "—"}</strong>
                <span>Concepts Extracted</span>
              </div>
            </div>
          </div>

          <div className="command-search">
            <div>
              <h2>Ask your research corpus</h2>
              <p>Start a grounded research session across papers, extracted concepts, and source-backed citations.</p>
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
      <section className="stat-grid" aria-label="Research intelligence metrics">
        <ResearchStatCard icon="papers" label="Papers Uploaded" value={stats.papersUploaded} trend="+ live" growth={`${stats.completed} ready for analysis`} description="PDFs imported into the research library." tone="blue" />
        <ResearchStatCard icon="collections" label="Collections" value={stats.collectionsCreated} trend="+ domains" growth={`${stats.workspaces} workspace${stats.workspaces !== 1 ? "s" : ""}`} description="Research domains used to organize papers." tone="green" />
        <ResearchStatCard icon="book" label="Literature Reviews" value={stats.literatureReviews} trend="+ synthesis" growth="multi-paper reports" description="Generated reviews synthesizing multiple sources." tone="cyan" />
        <ResearchStatCard icon="citation" label="Citations" value={stats.citationsGenerated} trend="+ grounded" growth="source-aware answers" description="Citation anchors available for paper Q&A." tone="amber" />
        <ResearchStatCard icon="chat" label="Queries Asked" value={stats.queriesAsked} trend="+ sessions" growth="research chat history" description="Semantic questions asked across the corpus." tone="violet" />

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
