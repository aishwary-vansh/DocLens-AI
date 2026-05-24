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

const NotesPage = () => {
  const { collections, papers } = useResearchCorpus();
  const { showToast } = useToast();

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeNote, setActiveNote] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("");
  const [selectedDocument, setSelectedDocument] = useState("");

  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    try {
      setLoading(true);
      const data = await queryApi.notes();
      setNotes(data);
      setError(null);
    } catch (err) {
      console.error("Failed to load notes:", err);
      setError("Failed to load research notes. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const collectionPapers = useMemo(() => {
    if (!selectedCollection) return papers;
    return papers.filter((p) => p.collectionId === selectedCollection);
  }, [papers, selectedCollection]);

  const handleSave = async () => {
    if (!editTitle.trim() || !editContent.trim()) {
      showToast("Title and content are required", "error");
      return;
    }

    try {
      if (activeNote && isEditing) {
        // Update existing note
        const updated = await queryApi.updateNote(activeNote.id, {
          title: editTitle,
          content: editContent,
        });
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        setActiveNote(updated);
        showToast("Note updated", "success");
      } else {
        // Create new note
        const scopeType = selectedDocument ? "document" : selectedCollection ? "collection" : "workspace";
        const scopeId = selectedDocument || selectedCollection || "workspace-global";
        
        if (!selectedCollection && !selectedDocument) {
             showToast("Please select a collection or document context for this note", "error");
             return;
        }

        const created = await queryApi.createNote({
          title: editTitle,
          content: editContent,
          collectionId: selectedCollection || undefined,
          documentId: selectedDocument || undefined,
          scopeType,
          scopeId,
        });
        setNotes((prev) => [created, ...prev]);
        setActiveNote(created);
        showToast("Note created", "success");
      }
      setIsEditing(false);
      setShowCreate(false);
    } catch (err) {
      console.error("Failed to save note:", err);
      showToast(err.message || "Failed to save note", "error");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this note?")) return;
    try {
      await queryApi.deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (activeNote?.id === id) {
        setActiveNote(null);
        setIsEditing(false);
      }
      showToast("Note deleted", "success");
    } catch (err) {
      console.error("Failed to delete note:", err);
      showToast("Failed to delete note", "error");
    }
  };

  const startEdit = (note) => {
    setActiveNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setIsEditing(true);
    setShowCreate(false);
  };

  const startCreate = () => {
    setActiveNote(null);
    setEditTitle("");
    setEditContent("");
    setSelectedCollection("");
    setSelectedDocument("");
    setIsEditing(true);
    setShowCreate(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setShowCreate(false);
    if (!activeNote) setEditTitle("");
  };

  const getContextLabel = (note) => {
    if (note.documentId) {
      const doc = papers.find((p) => p.id === note.documentId);
      return doc ? `Paper: ${doc.title}` : "Paper";
    }
    if (note.collectionId) {
      const col = collections.find((c) => c.id === note.collectionId);
      return col ? `Collection: ${col.name}` : "Collection";
    }
    return "Workspace";
  };

  return (
    <>
      <PageHeader
        eyebrow="Knowledge Base"
        title="Research Notes"
        description="Capture insights, trace methodology notes, and build a connected research corpus."
        actions={
          <ActionButton
            icon="plus"
            onClick={startCreate}
          >
            New Note
          </ActionButton>
        }
      />

      {error && <ErrorNotice message={error} />}

      <div style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: 20, alignItems: "start" }}>
        {/* Sidebar List */}
        <Panel title="All Notes" style={{ maxHeight: "calc(100vh - 180px)", overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--rp-text-muted)" }}>
              Loading notes...
            </div>
          ) : notes.length ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {notes.map((n) => (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!isEditing || showCreate) {
                      setActiveNote(n);
                      setIsEditing(false);
                      setShowCreate(false);
                    }
                  }}
                  style={{
                    padding: "16px",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    background: activeNote?.id === n.id ? "rgba(110,231,249,0.05)" : "transparent",
                    borderLeft: activeNote?.id === n.id ? "3px solid var(--rp-cyan)" : "3px solid transparent",
                    transition: "background 0.2s"
                  }}
                >
                  <strong style={{ display: "block", color: "var(--rp-text)", fontSize: "0.9rem", marginBottom: 4 }}>
                    {n.title}
                  </strong>
                  <span style={{ display: "block", color: "var(--rp-text-muted)", fontSize: "0.75rem", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {n.content.substring(0, 80)}...
                  </span>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--rp-cyan)", background: "rgba(110,231,249,0.1)", padding: "2px 6px", borderRadius: 4 }}>
                      {getContextLabel(n)}
                    </span>
                    <span style={{ fontSize: "0.7rem", color: "var(--rp-text-soft)" }}>
                      {formatDate(n.updatedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
             <div style={{ padding: 40, textAlign: "center", color: "var(--rp-text-muted)" }}>
              No notes captured yet.
            </div>
          )}
        </Panel>

        {/* Editor / Viewer */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {isEditing || showCreate ? (
            <Panel title={showCreate ? "Create New Note" : "Edit Note"}>
              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="form-row">
                  <label>Title</label>
                  <input
                    className="field-control"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="E.g. Insights on attention mechanisms"
                    autoFocus
                  />
                </div>
                
                {showCreate && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div className="form-row">
                      <label>Context: Collection</label>
                      <select
                        className="field-control"
                        value={selectedCollection}
                        onChange={(e) => {
                          setSelectedCollection(e.target.value);
                          setSelectedDocument("");
                        }}
                      >
                        <option value="">Select a collection...</option>
                        {collections.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-row">
                      <label>Context: Paper (Optional)</label>
                      <select
                        className="field-control"
                        value={selectedDocument}
                        onChange={(e) => setSelectedDocument(e.target.value)}
                        disabled={!selectedCollection && papers.length === 0}
                      >
                        <option value="">Select a specific paper...</option>
                        {collectionPapers.map((p) => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="form-row" style={{ flexGrow: 1 }}>
                  <label>Content (Markdown supported)</label>
                  <textarea
                    className="field-control"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    style={{ minHeight: "300px", fontFamily: "monospace", resize: "vertical" }}
                    placeholder="Jot down your methodology notes, equations, or synthesis ideas here..."
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                  <ActionButton variant="ghost" onClick={cancelEdit}>Cancel</ActionButton>
                  <ActionButton onClick={handleSave}>Save Note</ActionButton>
                </div>
              </div>
            </Panel>
          ) : activeNote ? (
            <Panel 
              title={activeNote.title} 
              eyebrow={getContextLabel(activeNote)}
              action={
                <div style={{ display: "flex", gap: 8 }}>
                  <ActionButton variant="ghost" onClick={() => startEdit(activeNote)}>
                    Edit
                  </ActionButton>
                  <button 
                    type="button" 
                    onClick={() => handleDelete(activeNote.id)}
                    style={{ background: "transparent", border: "none", color: "var(--rp-red)", cursor: "pointer", padding: "0 8px" }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              }
            >
              <div style={{ padding: "30px", fontSize: "1rem", lineHeight: 1.7, color: "var(--rp-text)", whiteSpace: "pre-wrap" }}>
                {activeNote.content}
              </div>
            </Panel>
          ) : (
            <EmptyState
              icon="papers"
              title="Select a note to view"
              description="Or create a new note to start capturing your research insights."
              action={
                <ActionButton icon="plus" onClick={startCreate}>
                  Create Note
                </ActionButton>
              }
            />
          )}
        </div>
      </div>
    </>
  );
};

export default NotesPage;
