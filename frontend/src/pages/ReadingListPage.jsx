import { useState, useEffect } from "react";
import useResearchCorpus from "../hooks/useResearchCorpus";
import { documentsApi } from "../services/api";
import {
  ActionButton,
  PageHeader,
  Panel,
} from "../components/research/ResearchComponents";
import { useToast } from "../contexts/ToastContext";

const ReadingListPage = () => {
  const { collections, papers } = useResearchCorpus();
  const { showToast } = useToast();

  const [progressData, setProgressData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);

  const [editStatus, setEditStatus] = useState("UNREAD");
  const [editProgress, setEditProgress] = useState(0);
  const [editPage, setEditPage] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    loadProgress();
  }, []);

  const loadProgress = async () => {
    try {
      setLoading(true);
      const overview = await documentsApi.workspaceOverview();
      setProgressData(overview.readingProgress || []);
    } catch (err) {
      console.error("Failed to load reading progress:", err);
    } finally {
      setLoading(false);
    }
  };

  const getProgressForPaper = (paperId) => {
    return progressData.find((p) => p.documentId === paperId) || {
      status: "UNREAD",
      progress: 0,
      lastReadPage: null,
      notes: ""
    };
  };

  const startEdit = (paperId) => {
    const p = getProgressForPaper(paperId);
    setEditStatus(p.status || "UNREAD");
    setEditProgress(p.progress || 0);
    setEditPage(p.lastReadPage || "");
    setEditNotes(p.notes || "");
    setEditingId(paperId);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveProgress = async (paperId) => {
    try {
      const updated = await documentsApi.updateProgress(paperId, {
        status: editStatus,
        progress: parseInt(editProgress, 10),
        lastReadPage: editPage ? parseInt(editPage, 10) : null,
        notes: editNotes
      });
      
      setProgressData((prev) => {
        const exists = prev.find(p => p.documentId === paperId);
        if (exists) return prev.map(p => p.documentId === paperId ? updated : p);
        return [...prev, updated];
      });
      
      showToast("Reading progress updated", "success");
      setEditingId(null);
    } catch (err) {
      console.error("Failed to save progress:", err);
      showToast("Failed to save reading progress", "error");
    }
  };

  // Group papers by status
  const getPapersByStatus = (status) => {
    return papers.filter((paper) => {
      const p = getProgressForPaper(paper.id);
      return p.status === status;
    });
  };

  const readingPapers = getPapersByStatus("READING");
  const completedPapers = getPapersByStatus("COMPLETED");
  const unreadPapers = getPapersByStatus("UNREAD");

  const getCollectionName = (id) => {
    return collections.find(c => c.id === id)?.name || "Unknown Collection";
  };

  const renderPaperRow = (paper, p) => {
    const isEditing = editingId === paper.id;
    return (
      <tr key={paper.id} style={{ background: isEditing ? "rgba(255,255,255,0.03)" : "transparent" }}>
        <td>
          <strong style={{ color: "var(--rp-text)", display: "block", marginBottom: 4 }}>{paper.title}</strong>
          <span style={{ fontSize: "0.75rem", color: "var(--rp-text-soft)" }}>{getCollectionName(paper.collectionId)}</span>
        </td>
        <td>
          {isEditing ? (
            <select className="field-control" value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={{ padding: "4px 8px" }}>
              <option value="UNREAD">Unread</option>
              <option value="READING">Reading</option>
              <option value="COMPLETED">Completed</option>
            </select>
          ) : (
            <span style={{
              fontSize: "0.75rem", fontWeight: 600, padding: "2px 8px", borderRadius: 4,
              background: p.status === "COMPLETED" ? "rgba(16,185,129,0.1)" : p.status === "READING" ? "rgba(110,231,249,0.1)" : "rgba(255,255,255,0.05)",
              color: p.status === "COMPLETED" ? "var(--rp-green)" : p.status === "READING" ? "var(--rp-cyan)" : "var(--rp-text-soft)"
            }}>
              {p.status}
            </span>
          )}
        </td>
        <td>
          {isEditing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="range" min="0" max="100" value={editProgress} onChange={(e) => setEditProgress(e.target.value)} style={{ width: 80 }} />
              <span style={{ fontSize: "0.8rem", color: "var(--rp-text)" }}>{editProgress}%</span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 100, height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${p.progress}%`, height: "100%", background: p.progress === 100 ? "var(--rp-green)" : "var(--rp-cyan)" }} />
              </div>
              <span style={{ fontSize: "0.8rem", color: "var(--rp-text)" }}>{p.progress}%</span>
            </div>
          )}
        </td>
        <td>
          {isEditing ? (
            <input className="field-control" type="number" placeholder="Pg" value={editPage} onChange={(e) => setEditPage(e.target.value)} style={{ width: 60, padding: "4px 8px" }} />
          ) : (
            <span style={{ color: "var(--rp-text-soft)", fontSize: "0.85rem" }}>{p.lastReadPage ? `Pg ${p.lastReadPage}` : "-"}</span>
          )}
        </td>
        <td>
          {isEditing ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => saveProgress(paper.id)} style={{ padding: "4px 10px", background: "var(--rp-cyan)", border: "none", borderRadius: 4, color: "#000", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>Save</button>
              <button onClick={cancelEdit} style={{ padding: "4px 10px", background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 4, color: "var(--rp-text)", cursor: "pointer", fontSize: "0.75rem" }}>Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => startEdit(paper.id)}
              style={{ padding: "4px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "var(--rp-text)", cursor: "pointer", fontSize: "0.75rem" }}
            >
              Update Progress
            </button>
          )}
        </td>
      </tr>
    );
  };

  const renderTable = (paperList) => {
    if (!paperList.length) {
      return (
        <div style={{ padding: "20px", textAlign: "center", color: "var(--rp-text-muted)", fontSize: "0.85rem", background: "rgba(255,255,255,0.02)", borderRadius: 8 }}>
          No papers in this list.
        </div>
      );
    }
    return (
      <div className="research-table-wrap">
        <table className="research-table">
          <thead>
            <tr>
              <th style={{ width: "40%" }}>Paper</th>
              <th style={{ width: "15%" }}>Status</th>
              <th style={{ width: "20%" }}>Progress</th>
              <th style={{ width: "10%" }}>Page</th>
              <th style={{ width: "15%" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paperList.map(paper => renderPaperRow(paper, getProgressForPaper(paper.id)))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="Tracking"
        title="Reading List"
        description="Track your reading progress across all documents in your research library."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--rp-text-muted)" }}>Loading reading progress...</div>
        ) : (
          <>
            <Panel title={`Currently Reading (${readingPapers.length})`} style={{ borderLeft: "3px solid var(--rp-cyan)" }}>
              {renderTable(readingPapers)}
            </Panel>
            
            <Panel title={`Unread (${unreadPapers.length})`}>
              {renderTable(unreadPapers)}
            </Panel>

            <Panel title={`Completed (${completedPapers.length})`} style={{ borderLeft: "3px solid var(--rp-green)", opacity: 0.8 }}>
              {renderTable(completedPapers)}
            </Panel>
          </>
        )}
      </div>
    </>
  );
};

export default ReadingListPage;
