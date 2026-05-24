import { useState, useEffect, useMemo } from "react";
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

const ComparePapersPage = () => {
  const { collections, papers } = useResearchCorpus();
  const { showToast } = useToast();
  
  const [comparisons, setComparisons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [selectedPapers, setSelectedPapers] = useState([]);
  const [question, setQuestion] = useState("");
  const [generating, setGenerating] = useState(false);
  const [activeComparison, setActiveComparison] = useState(null);

  useEffect(() => {
    loadComparisons();
  }, []);

  const loadComparisons = async () => {
    try {
      setLoading(true);
      const data = await queryApi.comparisons();
      setComparisons(data);
      setError(null);
    } catch (err) {
      console.error("Failed to load comparisons:", err);
      setError("Failed to load comparisons. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const collectionPapers = useMemo(() => {
    return papers.filter(
      (p) =>
        p.collectionId === selectedCollection &&
        ["READY", "COMPLETED"].includes(p.status)
    );
  }, [papers, selectedCollection]);

  const togglePaperSelection = (id) => {
    setSelectedPapers((prev) =>
      prev.includes(id) ? prev.filter((pId) => pId !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (!selectedCollection || selectedPapers.length < 2) return;
    try {
      setGenerating(true);
      const result = await queryApi.compare(selectedPapers, {
        collectionId: selectedCollection,
        question: question.trim() || undefined,
        topK: 12,
      });
      
      setComparisons((prev) => [result, ...prev]);
      setActiveComparison(result);
      setShowGenerate(false);
      setSelectedCollection("");
      setSelectedPapers([]);
      setQuestion("");
      showToast("Comparison generated successfully", "success");
    } catch (err) {
      console.error("Comparison generation failed:", err);
      showToast(err.message || "Failed to generate comparison", "error");
    } finally {
      setGenerating(false);
    }
  };

  const exportMarkdown = (comp) => {
    const content = comp.markdown || `# ${comp.title}\n\n${comp.result?.narrative || comp.narrative || ""}`;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${comp.title.replace(/\s+/g, "_").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Compare Papers"
        description="Select multiple papers to synthesize differences in methodology, findings, datasets, and limitations side-by-side."
        actions={
          <ActionButton
            icon="plus"
            onClick={() => {
              setActiveComparison(null);
              setShowGenerate(true);
            }}
          >
            New Comparison
          </ActionButton>
        }
      />

      {error && <ErrorNotice message={error} />}

      {activeComparison ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20 }}>
          <Panel
            title={activeComparison.title}
            eyebrow={formatDate(activeComparison.createdAt)}
            action={
              <ActionButton variant="ghost" onClick={() => setActiveComparison(null)}>
                Close
              </ActionButton>
            }
          >
            <div style={{ padding: "20px 30px", fontSize: "0.9rem", lineHeight: 1.7, color: "var(--rp-text)", whiteSpace: "pre-wrap" }}>
              {activeComparison.markdown || activeComparison.result?.markdown || `# ${activeComparison.title}\n\n${activeComparison.narrative || activeComparison.result?.narrative || "No narrative generated."}`}
            </div>
          </Panel>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Panel title="Comparison Details">
              <div style={{ padding: "15px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--rp-text-soft)", fontSize: "0.8rem" }}>Papers analyzed</span>
                  <strong style={{ color: "var(--rp-cyan)" }}>{activeComparison.documentIds?.length || 0}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--rp-text-soft)", fontSize: "0.8rem" }}>Date generated</span>
                  <strong style={{ color: "var(--rp-text)" }}>{new Date(activeComparison.createdAt).toLocaleDateString()}</strong>
                </div>
                {activeComparison.question && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
                    <span style={{ color: "var(--rp-text-soft)", fontSize: "0.8rem" }}>Research Question</span>
                    <strong style={{ color: "var(--rp-text)", fontSize: "0.85rem" }}>{activeComparison.question}</strong>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => exportMarkdown(activeComparison)}
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
              Loading comparison history...
            </div>
          ) : comparisons.length ? (
            <div className="research-table-wrap">
              <table className="research-table">
                <thead>
                  <tr>
                    <th>Comparison Title</th>
                    <th>Focus Question</th>
                    <th>Date Generated</th>
                    <th>Papers</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong style={{ color: "var(--rp-text)", display: "block", marginBottom: 4 }}>
                          {c.title}
                        </strong>
                      </td>
                      <td>
                        <span style={{ color: "var(--rp-text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                          {c.question || "General Synthesis"}
                        </span>
                      </td>
                      <td>{formatDate(c.createdAt)}</td>
                      <td>{c.documentIds?.length || 0} papers</td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => setActiveComparison(c)}
                            style={{ padding: "4px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "var(--rp-text)", cursor: "pointer", fontSize: "0.75rem" }}
                          >
                            Read
                          </button>
                          <button
                            type="button"
                            onClick={() => exportMarkdown(c)}
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
              icon="spark"
              title="No paper comparisons yet"
              description="Select multiple papers to synthesize their findings, methodologies, and limitations side-by-side."
              action={
                <ActionButton icon="plus" onClick={() => setShowGenerate(true)}>
                  Start New Comparison
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
              <h2>Compare Papers</h2>
              <p>Select a collection and choose 2 or more papers to compare.</p>
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
                  <label>3. Focus Question (Optional)</label>
                  <input
                    type="text"
                    className="field-control"
                    placeholder="e.g. Compare the evaluation metrics used"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                  <p style={{ fontSize: "0.75rem", color: "var(--rp-text-muted)", marginTop: 4 }}>
                    Leave blank for a general comparison of methods, datasets, strengths, and findings.
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
                {generating ? "Synthesizing..." : "Compare Papers"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ComparePapersPage;
