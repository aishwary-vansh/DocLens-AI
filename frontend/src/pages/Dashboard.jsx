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

// Getting Started checklist
function GettingStarted({ hasWorkspace, hasCollection, hasPapers, hasQuery, navigateTo }) {
  const steps = [
    { done: hasCollection, label: "Create a research collection", action: () => navigateTo(PAGES.COLLECTIONS) },
    { done: hasPapers,     label: "Upload your first paper",      action: () => navigateTo(PAGES.PAPERS) },
    { done: hasQuery,      label: "Ask a research question",      action: () => navigateTo(PAGES.CHAT) },
  ];
  const allDone = steps.every(s => s.done);
  if (allDone) return null;
  return (
    <Panel title="Getting Started" eyebrow="Setup">
      <div className="checklist">
        {steps.map((step, i) => (
          <button
            key={step.label}
            className={`checklist-item ${step.done ? "done" : ""}`}
            onClick={step.done ? undefined : step.action}
            type="button"
            style={{ cursor: step.done ? "default" : "pointer" }}
          >
            <div className={`check-mark ${step.done ? "done" : ""}`}>{step.done ? "✓" : i + 1}</div>
            <span>{step.label}</span>
            {!step.done && <Icon name="arrowRight" size={14} />}
          </button>
        ))}
      </div>
    </Panel>
  );
}

const Dashboard = () => {
  const { navigateTo } = useApp();
  const { workspaces, collections, papers, loading, error } = useResearchCorpus();
  const [semanticQuery, setSemanticQuery] = useState(localStorage.getItem("doclens_last_query") || "");

  const stats    = useMemo(() => buildResearchStats({ workspaces, collections, papers }), [collections, papers, workspaces]);
  const activity = useMemo(() => buildActivityFeed({ collections, papers }),             [collections, papers]);
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

      {/* Getting started checklist (hides once complete) */}
      <GettingStarted
        hasCollection={collections.length > 0}
        hasPapers={papers.length > 0}
        hasQuery={hasQuery}
        navigateTo={navigateTo}
      />

      {/* Command panel + quick actions */}
      <section className="command-center-grid" style={{ marginTop: 14 }}>
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

        <Panel title="Quick Actions" eyebrow="Start here">
          <div className="quick-actions">
            {[
              { icon: "upload",      label: "Upload Paper",           sub: "Add PDFs and begin indexing",          page: PAGES.PAPERS },
              { icon: "collections", label: "Create Collection",       sub: "Group papers into a research domain",  page: PAGES.COLLECTIONS },

              { icon: "chat",        label: "Start Research Session",  sub: "Ask grounded questions with citations", page: PAGES.CHAT },
            ].map(action => (
              <button className="quick-action" key={action.label} onClick={() => navigateTo(action.page)} type="button">
                <Icon name={action.icon} size={18} />
                <div>
                  <strong>{action.label}</strong>
                  <span>{action.sub}</span>
                </div>
                <Icon name="arrowRight" size={15} />
              </button>
            ))}
          </div>
        </Panel>
      </section>

      {/* Stats row */}
      <section className="stat-grid" aria-label="Research intelligence metrics">
        <ResearchStatCard icon="papers"    label="Papers Uploaded"    value={stats.papersUploaded}              trend="+ live"     growth={`${stats.completed} ready for analysis`}   description="PDFs imported into the research library."                   tone="blue"   />
        <ResearchStatCard icon="collections" label="Collections"      value={stats.collectionsCreated}          trend="+ domains"  growth={`${stats.workspaces} workspace${stats.workspaces !== 1 ? "s" : ""}`} description="Research domains used to organize papers." tone="green"  />
        <ResearchStatCard icon="book"      label="Literature Reviews" value={stats.literatureReviews}           trend="+ synthesis" growth="multi-paper reports"                       description="Generated reviews synthesizing multiple sources."           tone="cyan"   />
        <ResearchStatCard icon="citation"  label="Citations"          value={stats.citationsGenerated}          trend="+ grounded" growth="source-aware answers"                       description="Citation anchors available for paper Q&A."                  tone="amber"  />
        <ResearchStatCard icon="chat"      label="Queries Asked"      value={stats.queriesAsked}                trend="+ sessions" growth="research chat history"                      description="Semantic questions asked across the corpus."                tone="violet" />

      </section>

      {/* Processing queue + recent papers */}
      <section className="dashboard-section-grid">
        <Panel title="Recent Papers" eyebrow="Research library">
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
        </Panel>

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

      {/* Activity + processing queue */}
      <section className="dashboard-section-grid">
        <Panel title="Research Activity Feed" eyebrow="Timeline">
          <ActivityTimeline items={activity} />
        </Panel>

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
                    {["UPLOADED","PROCESSING","READY"].map((s, i) => {
                      const isProcessing = ["EXTRACTING","CHUNKING","EMBEDDING","INDEXING"].includes(p.status);
                      const isReady = ["READY","COMPLETED"].includes(p.status);
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
            <div className="quick-actions">
              {sampleQueries.map(query => (
                <button
                  className="quick-action"
                  key={query}
                  onClick={() => { localStorage.setItem("doclens_last_query", query); navigateTo(PAGES.CHAT); }}
                  type="button"
                >
                  <Icon name="search" size={17} />
                  <div>
                    <strong>{query}</strong>
                    <span>Send to Research Chat</span>
                  </div>
                  <Icon name="arrowRight" size={15} />
                </button>
              ))}
            </div>
          )}
        </Panel>
      </section>
    </>
  );
};

export default Dashboard;
