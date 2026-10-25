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
import { formatDate } from "../utils/researchData";
import { useToast } from "../contexts/ToastContext";
import CitedReport from "../components/research/CitedReport";
import Icon from "../components/research/Icons";

const COMPARISON_SECTIONS = [
  ["methods", "Methods"],
  ["datasets", "Datasets"],
  ["findings", "Key findings"],
  ["strengths", "Strengths"],
  ["weaknesses", "Weaknesses"],
  ["agreements", "Where the papers agree"],
  ["disagreements", "Where the papers disagree"],
  ["futureWork", "Future work"],
];

const cell = (value) => String(value || "—").replace(/\|/g, "/").replace(/\n/g, " ");

/** Markdown for the comparison reader: narrative, the paper matrix, then the
 *  per-aspect lists, all from the stored structured result (not just the narrative). */
function comparisonMarkdown(comparison) {
  const r = comparison.result || comparison;
  const parts = [r.narrative || comparison.markdown || "No narrative generated."];
  if (r.paperMatrix?.length) {
    parts.push(
      "## Paper matrix",
      ["| Paper | Method | Datasets | Key result | Limitation |", "| --- | --- | --- | --- | --- |",
        ...r.paperMatrix.map((row) => `| ${cell(row.title)} | ${cell(row.method)} | ${cell(row.datasets)} | ${cell(row.key_result)} | ${cell(row.limitation)} |`)].join("\n"),
    );
  }
  for (const [key, heading] of COMPARISON_SECTIONS) {
    const items = (r[key] || []).filter(Boolean);
    if (items.length) parts.push(`## ${heading}`, items.map((item) => `- ${item}`).join("\n"));
  }
  return parts.join("\n\n");
}

const ComparePapersPage = () => {
  const { collections, papers } = useResearchCorpus();
  const toast = useToast();
  
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
      toast.success("Comparison generated successfully");
    } catch (err) {
      console.error("Comparison generation failed:", err);
      toast.error(err.message || "Failed to generate comparison");
    } finally {
      setGenerating(false);
    }
  };

  // Download the same report the reader shows: narrative, aspect lists and paper matrix.
  const exportMarkdown = (comp) => {
    const content = `# ${comp.title}

${comparisonMarkdown(comp)}
`;
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
        eyebrow="Synthesis"
        title="Compare papers"
        description="Methods, datasets, findings and limitations side by side, each backed by a cited passage."
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
        <Panel
          className="report-detail"
          title={activeComparison.title}
          eyebrow="Comparison"
          action={
            <div className="report-toolbar">
              <button type="button" className="report-tool" onClick={() => exportMarkdown(activeComparison)} title="Download as Markdown (.md)">
                <Icon name="download" size={15} /> Download
              </button>
              <button type="button" className="report-tool" onClick={() => setActiveComparison(null)}>
                <Icon name="close" size={15} /> Close
              </button>
            </div>
          }
        >
          <p className="report-meta-line">
            <span>{activeComparison.documentIds?.length || 0} papers</span>
            <span>Generated {formatDate(activeComparison.createdAt)}</span>
            {activeComparison.question && <span>Question: {activeComparison.question}</span>}
          </p>
          <div className="report-reader">
            <CitedReport
              markdown={comparisonMarkdown(activeComparison)}
              citations={(activeComparison.result || activeComparison).citations || []}
              verification={(activeComparison.result || activeComparison).verification}
            />
          </div>
        </Panel>
      ) : (
        <Panel>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--rp-text-muted)" }}>
              Loading comparison history...
            </div>
          ) : comparisons.length ? (
            <div className="research-table-wrap">
              <table className="research-table research-table-stack">
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
                        <div className="row-actions">
                          <ActionButton variant="secondary" icon="arrowRight" onClick={() => setActiveComparison(c)}>Read</ActionButton>
                          <ActionButton variant="ghost" icon="download" onClick={() => exportMarkdown(c)}>Export</ActionButton>
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
