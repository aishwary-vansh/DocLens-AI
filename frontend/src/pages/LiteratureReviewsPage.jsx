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
import { formatDate } from "../utils/researchData";
import { useToast } from "../contexts/ToastContext";
import ResearchGapReport from "../components/research/ResearchGapReport";
import CitedReport from "../components/research/CitedReport";
import Icon from "../components/research/Icons";
import Modal from "../components/ui/Modal";

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

  // Id of the review whose download is in flight, so its buttons show progress.
  const [exportingId, setExportingId] = useState(null);

  const exportMarkdown = async (review) => {
    if (exportingId) return;
    setExportingId(review.id);
    try {
      const filename = await queryApi.exportLiteratureReview(review.id, 'markdown', review.title);
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      console.error("Export failed:", err);
      toast.error(err.message || "Download failed. Please try again.");
    } finally {
      setExportingId(null);
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
        <Panel
          className="report-detail"
          title={activeReview.title}
          eyebrow="Literature review"
          action={
            <div className="report-toolbar">
              <button type="button" className="report-tool" onClick={() => exportMarkdown(activeReview)} disabled={exportingId === activeReview.id} title="Download as Markdown (.md)">
                <Icon name="download" size={15} /> {exportingId === activeReview.id ? "Preparing…" : "Download"}
              </button>
              <button type="button" className="report-tool" onClick={() => setActiveReview(null)}>
                <Icon name="close" size={15} /> Close
              </button>
            </div>
          }
        >
          <p className="report-meta-line">
            <span>{activeReview.documentIds?.length || activeReview.paperCount || 0} papers</span>
            <span>Generated {formatDate(activeReview.createdAt || activeReview.date)}</span>
          </p>
          <div className="report-reader">
            <CitedReport
              markdown={activeReview.markdown || reviewMarkdownFromSections(activeReview) || activeReview.content || ""}
              citations={activeReview.citations || []}
              verification={activeReview.verification}
            />
          </div>
        </Panel>
      ) : (
        <Panel>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--rp-text-muted)" }}>
              Loading literature reviews...
            </div>
          ) : reviews.length ? (
            <div className="research-table-wrap">
              <table className="research-table research-table-stack">
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
                        <div className="row-actions">
                          <ActionButton variant="ghost" icon="book" onClick={() => setActiveReview(r)}>Read</ActionButton>
                          <ActionButton variant="ghost" icon="download" onClick={() => exportMarkdown(r)} disabled={exportingId === r.id}>
                            {exportingId === r.id ? "Preparing…" : "Download"}
                          </ActionButton>
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

      <Modal
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        busy={generating}
        width={600}
        title={mode === "gaps" ? "Find research gaps" : "Generate literature review"}
        description={mode === "gaps"
          ? "DocLens cross-checks limitations, future work, datasets and results across the papers you pick."
          : `Choose a collection, then ${minPapers} or more indexed papers to synthesize.`}
        footer={
          <>
            <ActionButton icon={null} variant="ghost" onClick={() => setShowGenerate(false)} disabled={generating}>Cancel</ActionButton>
            <ActionButton icon="spark" onClick={handleGenerate} disabled={generating || selectedPapers.length < minPapers}>
              {generating
                ? mode === "gaps" ? "Analysing gaps…" : "Writing review…"
                : mode === "gaps" ? "Find gaps" : "Generate review"}
            </ActionButton>
          </>
        }
      >
        <div className="form-row">
          <label htmlFor="review-collection">Collection</label>
          <select
            id="review-collection"
            className="field-control"
            value={selectedCollection}
            onChange={(e) => {
              setSelectedCollection(e.target.value);
              setSelectedPapers([]);
            }}
          >
            <option value="">Choose a collection…</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {selectedCollection && (
          <div className="form-row">
            <label>Papers <span className="field-optional">choose at least {minPapers}</span></label>
            {!collectionPapers.length ? (
              <div className="picker-empty">No fully indexed papers in this collection yet.</div>
            ) : (
              <div className="picker-list">
                {collectionPapers.map((p) => (
                  <label key={p.id} className={`picker-item ${selectedPapers.includes(p.id) ? "is-selected" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selectedPapers.includes(p.id)}
                      onChange={() => togglePaperSelection(p.id)}
                    />
                    <div className="picker-text">
                      <strong>{p.title}</strong>
                      <span>{p.authors || "Unknown author"}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedPapers.length >= minPapers && (
          <div className="form-row">
            <label htmlFor="review-topic">{mode === "gaps" ? "Focus topic" : "Review topic"} <span className="field-optional">optional</span></label>
            <input
              id="review-topic"
              type="text"
              className="field-control"
              placeholder="e.g. Performance of transformer architectures"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <p className="field-hint">A topic or theme to focus the synthesis on.</p>
          </div>
        )}
        {generating && <p className="field-hint">This usually takes 30–90 seconds. You can keep this window open.</p>}
      </Modal>
    </>
  );
};

export default LiteratureReviewsPage;
