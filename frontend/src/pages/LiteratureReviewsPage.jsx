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

const LiteratureReviewsPage = () => {
  const { collections, papers } = useResearchCorpus();
  const { showToast } = useToast();
  
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [selectedPapers, setSelectedPapers] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [activeReview, setActiveReview] = useState(null);
  const [topic, setTopic] = useState("");

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

  const handleGenerate = async () => {
    if (!selectedCollection || selectedPapers.length < 2) return;
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
      showToast("Literature review generated successfully", "success");
    } catch (err) {
      console.error("Failed to generate review:", err);
      showToast(err.message || "Failed to generate literature review", "error");
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
      showToast("Exporting Markdown...", "success");
    } catch (err) {
      console.error("Export failed:", err);
      showToast("Failed to export markdown", "error");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Literature Reviews"
        title="Synthesize multi-paper insights."
        description="Select multiple papers to generate a comprehensive literature review. DocLens reads the source documents and aggregates findings, methodologies, and limitations."
        actions={
          <ActionButton
            icon="plus"
            onClick={() => {
              setActiveReview(null);
              setShowGenerate(true);
            }}
          >
            Generate Review
          </ActionButton>
        }
      />

      {error && <ErrorNotice message={error} />}

      {activeReview ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20 }}>
          <Panel title={activeReview.title} eyebrow={formatDate(activeReview.createdAt || activeReview.date)} action={<ActionButton variant="ghost" onClick={() => setActiveReview(null)}>Close</ActionButton>}>
            <div style={{ padding: "20px 30px", fontSize: "0.9rem", lineHeight: 1.7, color: "var(--rp-text)", whiteSpace: "pre-wrap" }}>
              {activeReview.markdown || activeReview.content}
            </div>
          </Panel>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
              <h2>Generate Literature Review</h2>
              <p>Select a collection and choose 2 or more papers to synthesize.</p>
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
                  <label>2. Select Papers (Minimum 2)</label>
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

              {selectedPapers.length >= 2 && (
                <div className="form-row">
                  <label>3. Review Topic (Optional)</label>
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
                disabled={generating || selectedPapers.length < 2}
              >
                {generating ? "Synthesizing..." : "Generate Review"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LiteratureReviewsPage;
