import { useMemo, useState, useEffect } from "react";
import useResearchCorpus from "../hooks/useResearchCorpus";
import { queryApi } from "../services/api";

import {
  ActionButton,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Panel,
} from "../components/research/ResearchComponents";
import Icon from "../components/research/Icons";
import { formatDate } from "../utils/researchData";
import { useToast } from "../contexts/ToastContext";
import ResearchGapReport from "../components/research/ResearchGapReport";
import CitedReport from "../components/research/CitedReport";

/** Fallback when a review has no stored Markdown: rebuild it from its sections. */
function reviewMarkdownFromSections(review) {
  const sections = Object.values(review?.sections || {});
  return sections.map((section) => `## ${section.heading}\n\n${section.content}`).join("\n\n");
}

const LiteratureReviewsPage = () => {
  const { collections, papers } = useResearchCorpus();
  const toast = useToast();
  
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [selectedPapers, setSelectedPapers] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [activeReview, setActiveReview] = useState(null);
  const [topic, setTopic] = useState("");
  // "review" generates a stored literature review; "gaps" runs gap analysis.
  const [mode, setMode] = useState("review");
  const [activeGaps, setActiveGaps] = useState(null);

  useEffect(() => {
    loadReviews();
  }, []);

  const loadReviews = async () => {
    try {
      setLoading(true);
      const data = await queryApi.literatureReviews();
      setReviews(data);
      setError(null);
    } catch (err) {
      console.error("Failed to load reviews:", err);
      setError("Failed to load literature reviews. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const collectionPapers = useMemo(() => {
    return papers.filter((p) => p.collectionId === selectedCollection && ["READY", "COMPLETED"].includes(p.status));
  }, [papers, selectedCollection]);

  const minPapers = mode === "gaps" ? 1 : 2;

  const openModal = (nextMode) => {
    setMode(nextMode);
    setActiveReview(null);
    setActiveGaps(null);
    setShowGenerate(true);
  };

  const resetModal = () => {
    setShowGenerate(false);
    setSelectedCollection("");
    setSelectedPapers([]);
    setTopic("");
  };

  const handleFindGaps = async () => {
    try {
      setGenerating(true);
      const result = await queryApi.researchGaps({
        documentIds: selectedPapers,
        collectionId: selectedCollection,
        topic: topic.trim() || undefined,
      });
      setActiveGaps(result);
      resetModal();
      toast.success(`Found ${result.gaps?.length || 0} research gaps`);
    } catch (err) {
      console.error("Gap analysis failed:", err);
      toast.error(err.message || "Failed to analyse research gaps");
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedCollection || selectedPapers.length < minPapers) return;
    if (mode === "gaps") return handleFindGaps();
    try {
      setGenerating(true);
      const result = await queryApi.generateLiteratureReview({
        documentIds: selectedPapers,
        collectionId: selectedCollection,
        topic: topic.trim() || undefined,
      });

      setReviews((prev) => [result, ...prev]);
      setActiveReview(result);
      setShowGenerate(false);
      setSelectedCollection("");
      setSelectedPapers([]);
      setTopic("");
      toast.success("Literature review generated successfully");
    } catch (err) {
      console.error("Failed to generate review:", err);
      toast.error(err.message || "Failed to generate literature review");
    } finally {
      setGenerating(false);
    }
  };

  const togglePaperSelection = (id) => {
    setSelectedPapers((prev) =>
      prev.includes(id) ? prev.filter((pId) => pId !== id) : [...prev, id]
    );
  };

  const exportMarkdown = async (review) => {
    try {
      await queryApi.exportLiteratureReview(review.id, 'markdown', review.title);
      toast.success("Exporting Markdown...");
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Failed to export markdown");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Synthesis"
        title="Literature reviews"
        description="Pick papers and DocLens drafts a review from their text. Every statement cites the passage it came from."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton variant="ghost" icon="search" onClick={() => openModal("gaps")}>
              Find Research Gaps
            </ActionButton>
            <ActionButton icon="plus" onClick={() => openModal("review")}>
              Generate Review
            </ActionButton>
          </div>
        }
      />

      {error && <ErrorNotice message={error} />}

      {activeGaps ? (
        <ResearchGapReport analysis={activeGaps} onClose={() => setActiveGaps(null)} />
      ) : activeReview ? (
        <div className="report-detail-layout">
          <Panel title={activeReview.title} eyebrow={formatDate(activeReview.createdAt || activeReview.date)} action={<ActionButton variant="ghost" onClick={() => setActiveReview(null)}>Close</ActionButton>}>
            <div className="report-reader">
              <CitedReport
                markdown={activeReview.markdown || reviewMarkdownFromSections(activeReview) || activeReview.content || ""}
                citations={activeReview.citations || []}
                verification={activeReview.verification}
              />
            </div>
          </Panel>
          <div className="report-detail-side">
            <Panel title="Review Details">
              <div style={{ padding: "15px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--rp-text-soft)", fontSize: "0.8rem" }}>Papers analyzed</span>
                  <strong style={{ color: "var(--rp-cyan)" }}>{activeReview.documentIds?.length || activeReview.paperCount || 0}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--rp-text-soft)", fontSize: "0.8rem" }}>Date generated</span>
                  <strong style={{ color: "var(--rp-text)" }}>{new Date(activeReview.createdAt || activeReview.date).toLocaleDateString()}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => exportMarkdown(activeReview)}
                  style={{ marginTop: 10, padding: "8px", background: "var(--rp-blue)", color: "#000", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  <Icon name="download" size={16} /> Export Markdown
                </button>
              </div>
            </Panel>
          </div>
        </div>
      ) : (
        <Panel>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--rp-text-muted)" }}>
              Loading literature reviews...
            </div>
          ) : reviews.length ? (
            <div className="research-table-wrap">
              <table className="research-table">
                <thead>
                  <tr>
                    <th>Review Title</th>
                    <th>Date Generated</th>
                    <th>Papers Analyzed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong style={{ color: "var(--rp-text)", display: "block", marginBottom: 4 }}>{r.title}</strong>
                      </td>
                      <td>{formatDate(r.createdAt || r.date)}</td>
                      <td>{r.documentIds?.length || r.paperCount || 0} papers</td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => setActiveReview(r)}
                            style={{ padding: "4px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "var(--rp-text)", cursor: "pointer", fontSize: "0.75rem" }}
                          >
                            Read
                          </button>
                          <button
                            type="button"
                            onClick={() => exportMarkdown(r)}
                            style={{ padding: "4px 10px", background: "rgba(110,231,249,0.1)", border: "1px solid rgba(110,231,249,0.2)", borderRadius: 4, color: "var(--rp-cyan)", cursor: "pointer", fontSize: "0.75rem" }}
                          >
                            Export
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="book"
              title="No literature reviews generated"
              description="Select multiple papers in a collection to synthesise their findings into a cohesive review."
              action={
                <ActionButton icon="plus" onClick={() => setShowGenerate(true)}>
                  Generate First Review
                </ActionButton>
              }
            />
          )}
        </Panel>
      )}

      {showGenerate && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowGenerate(false)}>
          <div className="modal-card" style={{ maxWidth: 600 }}>
            <header>
              <h2>{mode === "gaps" ? "Find Research Gaps" : "Generate Literature Review"}</h2>
              <p>
                {mode === "gaps"
                  ? "Select papers to analyse. DocLens cross-checks their limitations, future work, datasets and results to surface cited research gaps."
                  : "Select a collection and choose 2 or more papers to synthesize."}
              </p>
            </header>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px" }}>
              <div className="form-row">
                <label>1. Select Collection</label>
                <select
                  className="field-control"
                  value={selectedCollection}
                  onChange={(e) => {
                    setSelectedCollection(e.target.value);
                    setSelectedPapers([]);
                  }}
                >
                  <option value="">Choose a collection...</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {selectedCollection && (
                <div className="form-row">
                  <label>2. Select Papers (Minimum {minPapers})</label>
                  {!collectionPapers.length ? (
                    <div style={{ padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: 6, fontSize: "0.85rem", color: "var(--rp-text-muted)" }}>
                      No fully indexed papers found in this collection.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto", paddingRight: 4 }}>
                      {collectionPapers.map((p) => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={selectedPapers.includes(p.id)}
                            onChange={() => togglePaperSelection(p.id)}
                            style={{ accentColor: "var(--rp-cyan)", cursor: "pointer" }}
                          />
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <strong style={{ fontSize: "0.85rem", color: "var(--rp-text)" }}>{p.title}</strong>
                            <span style={{ fontSize: "0.75rem", color: "var(--rp-text-muted)" }}>{p.authors || "Unknown author"}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selectedPapers.length >= minPapers && (
                <div className="form-row">
                  <label>3. {mode === "gaps" ? "Focus Topic" : "Review Topic"} (Optional)</label>
                  <input
                    type="text"
                    className="field-control"
                    placeholder="e.g. Performance of transformer architectures"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                  <p style={{ fontSize: "0.75rem", color: "var(--rp-text-muted)", marginTop: 4 }}>
                    Provide a specific topic or theme to focus the synthesis around.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <ActionButton variant="ghost" onClick={() => setShowGenerate(false)}>Cancel</ActionButton>
              <ActionButton
                onClick={handleGenerate}
                disabled={generating || selectedPapers.length < minPapers}
              >
                {generating
                  ? mode === "gaps" ? "Analysing gaps..." : "Synthesizing..."
                  : mode === "gaps" ? "Find Gaps" : "Generate Review"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LiteratureReviewsPage;
