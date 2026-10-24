import { useState } from "react";
import { ActionButton, Panel } from "./ResearchComponents";

const GAP_TYPE_COLORS = {
  stated: "var(--rp-cyan)",
  recurring: "var(--rp-blue)",
  coverage: "#f5b86b",
  dataset: "#f5b86b",
  evaluation: "#f5b86b",
  methodological: "#c4a1ff",
  contradiction: "#ff8a8a",
};

const muted = { color: "var(--rp-text-muted)", fontSize: "0.78rem" };
const soft = { color: "var(--rp-text-soft)", fontSize: "0.85rem", lineHeight: 1.6 };

function GapCard({ gap, index }) {
  const [open, setOpen] = useState(index < 2);
  const color = GAP_TYPE_COLORS[gap.gapType] || "var(--rp-text-soft)";
  return (
    <article
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        padding: "14px 16px",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <span style={{ ...muted, textTransform: "uppercase", letterSpacing: 0.6, color }}>{gap.gapType}</span>
          <h3 style={{ margin: "4px 0 0", fontSize: "0.98rem", color: "var(--rp-text)" }}>
            {index + 1}. {gap.title}
          </h3>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <strong style={{ color: "var(--rp-text)" }}>{Math.round((gap.confidence || 0) * 100)}%</strong>
          <div style={muted}>{gap.grounded ? `${gap.citations?.length || 0} sources` : "inferred"}</div>
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ ...soft, margin: 0 }}>{gap.description}</p>
          {gap.rationale && (
            <p style={{ ...soft, margin: 0 }}>
              <strong style={{ color: "var(--rp-text)" }}>Why: </strong>
              {gap.rationale}
            </p>
          )}
          {gap.suggestedResearchQuestions?.length > 0 && (
            <div>
              <strong style={{ color: "var(--rp-text)", fontSize: "0.85rem" }}>Research questions</strong>
              <ul style={{ ...soft, margin: "4px 0 0", paddingLeft: 18 }}>
                {gap.suggestedResearchQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {gap.suggestedApproach && (
            <p style={{ ...soft, margin: 0 }}>
              <strong style={{ color: "var(--rp-text)" }}>Suggested study: </strong>
              {gap.suggestedApproach}
            </p>
          )}
          {gap.citations?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {gap.citations.map((c) => (
                <blockquote
                  key={c.chunkId}
                  style={{ margin: 0, padding: "8px 10px", background: "rgba(110,231,249,0.05)", borderRadius: 6, ...muted }}
                >
                  <strong style={{ color: "var(--rp-cyan)" }}>
                    {c.documentTitle}
                    {c.pageNumber ? `, p. ${c.pageNumber}` : ""}
                  </strong>
                  <div style={{ marginTop: 4 }}>“{(c.chunk || "").slice(0, 320)}{(c.chunk || "").length > 320 ? "…" : ""}”</div>
                </blockquote>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function ResearchGapReport({ analysis, onClose }) {
  const gaps = analysis.gaps || [];
  return (
    <div className="report-detail-layout">
      <Panel
        title={analysis.topic ? `Research gaps: ${analysis.topic}` : "Research gap analysis"}
        eyebrow={`${analysis.documentIds?.length || 0} papers · ${analysis.method === "llm" ? "AI synthesis" : "extractive"}`}
        action={<ActionButton variant="ghost" onClick={onClose}>Close</ActionButton>}
      >
        <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          {analysis.summary && <p style={{ ...soft, margin: 0, color: "var(--rp-text)" }}>{analysis.summary}</p>}
          {gaps.length ? (
            gaps.map((gap, index) => <GapCard key={`${gap.title}-${index}`} gap={gap} index={index} />)
          ) : (
            <p style={soft}>No evidence-backed gaps were found for the selected papers.</p>
          )}
        </div>
      </Panel>

      <div className="report-detail-side">
        {analysis.consensus?.length > 0 && (
          <Panel title="Consensus">
            <ul style={{ ...soft, margin: 0, padding: "12px 16px 12px 32px" }}>
              {analysis.consensus.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Panel>
        )}
        {analysis.contradictions?.length > 0 && (
          <Panel title="Contradictions">
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              {analysis.contradictions.map((item) => (
                <div key={item.topic}>
                  <strong style={{ color: "var(--rp-text)", fontSize: "0.85rem" }}>{item.topic}</strong>
                  <ul style={{ ...soft, margin: "4px 0 0", paddingLeft: 18 }}>
                    {item.positions.map((pos, i) => (
                      <li key={i}>
                        <em>{pos.paperTitle}</em>: {pos.stance}
                      </li>
                    ))}
                  </ul>
                  {item.possibleExplanation && <p style={{ ...muted, margin: "4px 0 0" }}>{item.possibleExplanation}</p>}
                </div>
              ))}
            </div>
          </Panel>
        )}
        {analysis.coverage && (
          <Panel title="Coverage">
            <pre style={{ ...muted, margin: 0, padding: "12px 16px", whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
              {analysis.coverage}
            </pre>
          </Panel>
        )}
      </div>
    </div>
  );
}
