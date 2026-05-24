import { useEffect, useMemo, useState } from "react";
import useResearchCorpus from "../hooks/useResearchCorpus";
import {
  ActivityTimeline,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Panel,
  ResearchStatCard,
} from "../components/research/ResearchComponents";
import { buildActivityFeed, buildResearchStats } from "../utils/researchData";
import { queryApi } from "../services/api";

// ── Animated bar row ──────────────────────────────────────────────────────────
function BarRow({ label, value, total, color }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{ width: `${pct}%`, background: color || undefined, transition: "width 0.7s ease" }}
        />
      </div>
      <strong>{typeof value === "number" && label.endsWith("%") ? `${value}%` : value}</strong>
    </div>
  );
}

// ── Concept chip ──────────────────────────────────────────────────────────────
function ConceptChip({ name, count, color }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "7px 10px", borderRadius: 6,
      background: "rgba(255,255,255,0.035)",
      border: "1px solid var(--rp-border)",
    }}>
      <span style={{ fontSize: "0.82rem", color: color || "var(--rp-text-soft)" }}>{name}</span>
      {count !== undefined && (
        <span style={{ fontSize: "0.72rem", color: "var(--rp-text-muted)", fontFamily: "var(--rp-mono)" }}>
          ×{count}
        </span>
      )}
    </div>
  );
}

const AnalyticsPage = () => {
  const { workspaces, collections, papers, error } = useResearchCorpus();
  const [serverStats, setServerStats] = useState(null);

  useEffect(() => {
    queryApi.analytics().then(setServerStats).catch(console.error);
  }, []);

  const stats    = useMemo(() => buildResearchStats({ workspaces, collections, papers, serverStats }), [collections, papers, workspaces, serverStats]);
  const activity = useMemo(() => buildActivityFeed({ collections, papers }), [collections, papers]);


  const topicRows = collections.length
    ? collections.slice(0, 6).map((c) => ({
        label: c.name,
        value: papers.filter((p) => p.collectionId === c.id).length,
        total: Math.max(papers.length, 1),
      }))
    : [
        { label: "NLP Research",       value: 0, total: 1 },
        { label: "Transformers",        value: 0, total: 1 },
        { label: "Time-Series",         value: 0, total: 1 },
        { label: "Anomaly Detection",   value: 0, total: 1 },
      ];

  return (
    <>
      <PageHeader
        eyebrow="Research Analytics"
        title="Measure discovery velocity and corpus intelligence."
        description="Track papers, processing health, and citation coverage. AI analytics update automatically as papers are indexed."
      />

      <ErrorNotice message={error && "Analytics could not load live API data."} />

      {/* Top stats */}
      <section className="analytics-grid">
        <ResearchStatCard icon="papers"     label="Papers Uploaded"     value={stats.papersUploaded}           trend="library"         growth={`${stats.completed} indexed`}          description="Corpus size available for discovery."             tone="blue"   />
        <ResearchStatCard icon="collections" label="Collections"         value={stats.collectionsCreated}       trend="domains"         growth={`${stats.workspaces} workspaces`}      description="Research domains under management."               tone="green"  />
        <ResearchStatCard icon="chat"       label="Questions Asked"      value={stats.queriesAsked}             trend="sessions"        growth="chat queries"                          description="Semantic questions asked across the corpus."      tone="violet" />
        <ResearchStatCard icon="book"       label="Literature Reviews"   value={stats.literatureReviews}        trend="synthesis"       growth="reports generated"                     description="Multi-paper synthesis and reviews generated."     tone="cyan"   />
      </section>

      {/* Processing health + topic coverage */}
      <section className="dashboard-section-grid">
        <Panel title="Processing Health" eyebrow="Pipeline">
          <div className="bar-list">
            <BarRow label="Ready"      value={stats.completed}   total={stats.papersUploaded || 1} color="var(--rp-green)"  />
            <BarRow label="Processing" value={stats.processing}  total={stats.papersUploaded || 1} color="var(--rp-amber)"  />
            <BarRow label="Failed"     value={stats.failed}      total={stats.papersUploaded || 1} color="var(--rp-rose)"   />
            <BarRow label="Ready rate%" value={stats.readyRate}  total={100}                        color="var(--rp-cyan)"   />
          </div>
        </Panel>

        <Panel title="Topic Coverage" eyebrow="Collections">
          <div className="bar-list">
            {topicRows.map((row) => (
              <BarRow key={row.label} label={row.label} value={row.value} total={row.total} />
            ))}
          </div>
        </Panel>
      </section>


      {/* Activity + interpretation */}
      <section className="dashboard-section-grid">
        <Panel title="Recent Research Activity" eyebrow="Timeline">
          <ActivityTimeline items={activity} />
        </Panel>

        <Panel title="Corpus Intelligence" eyebrow="Research interpretation">
          {papers.length ? (
            <div className="panel-padding">
              <p style={{ color: "var(--rp-text-soft)", lineHeight: 1.8, margin: 0, fontSize: "0.88rem" }}>
                Your corpus has <strong style={{ color: "var(--rp-cyan)" }}>{stats.papersUploaded}</strong> papers
                across <strong style={{ color: "var(--rp-green)" }}>{stats.collectionsCreated}</strong> research collections.
                {stats.completed > 0 && (
                  <> <strong style={{ color: "var(--rp-green)" }}>{stats.completed}</strong> papers are fully indexed and ready for semantic search and citation Q&amp;A.</>
                )}
              </p>
              {stats.processing > 0 && (
                <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)", fontSize: "0.78rem", color: "var(--rp-amber)" }}>
                  ⚡ {stats.processing} paper{stats.processing !== 1 ? "s" : ""} currently processing through the AI pipeline…
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              compact icon="analytics"
              title="Analytics activate after upload"
              description="Upload papers to see discovery velocity, research coverage, and synthesis progress."
            />
          )}
        </Panel>
      </section>
    </>
  );
};

export default AnalyticsPage;
