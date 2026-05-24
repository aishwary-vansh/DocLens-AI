import { useEffect, useMemo, useRef, useState } from "react";
import { documentsApi, queryApi } from "../services/api";
import { useApp, PAGES } from "../contexts/AppContext";
import useResearchCorpus from "../hooks/useResearchCorpus";
import {
  ActionButton,
  EmptyState,
  ErrorNotice,
  LoadingSkeleton,
  PageHeader,
  Panel,
  PaperCard,
  ProcessingStatusBadge,
  ResearchStatCard,
  ResearchTable,
  SegmentedControl,
} from "../components/research/ResearchComponents";
import { formatDate, getCollectionMetrics, sampleConcepts } from "../utils/researchData";

const CollectionPage = () => {
  const { activeCollectionId, navigateTo } = useApp();
  const { collections, papers, loading, error, refresh } = useResearchCorpus();
  const [tab, setTab] = useState("overview");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [selectedReviewPapers, setSelectedReviewPapers] = useState([]);
  const [reviewTopic, setReviewTopic] = useState("");
  const [reviews, setReviews] = useState([]);
  const [activeReview, setActiveReview] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [notes, setNotes] = useState([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteError, setNoteError] = useState("");
  const fileRef = useRef(null);

  const collection = collections.find((item) => item.id === activeCollectionId);
  const collectionPapers = papers.filter((paper) => paper.collectionId === activeCollectionId);
  const metrics = useMemo(() => getCollectionMetrics(collection, papers), [collection, papers]);

  useEffect(() => {
    if (!activeCollectionId) return;
    let cancelled = false;
    queryApi.literatureReviews(activeCollectionId)
      .then(items => {
        if (cancelled) return;
        setReviews(items);
        setActiveReview(current => current || items[0] || null);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });
    return () => { cancelled = true; };
  }, [activeCollectionId]);

  useEffect(() => {
    if (!activeCollectionId) return;
    let cancelled = false;
    queryApi.notes({ collectionId: activeCollectionId })
      .then(items => { if (!cancelled) setNotes(items); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [activeCollectionId]);

  const upload = async (event) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setUploadError("Choose a PDF to upload.");
    if (file.type !== "application/pdf") return setUploadError("DocLens currently accepts PDF papers.");

    setUploading(true);
    setUploadError("");
    try {
      await documentsApi.upload(file, activeCollectionId);
      await refresh();
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setUploadError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const readyCollectionPapers = collectionPapers.filter((paper) => ["READY", "COMPLETED"].includes(paper.status));

  const toggleReviewPaper = (id) => {
    setSelectedReviewPapers((prev) => (
      prev.includes(id) ? prev.filter((paperId) => paperId !== id) : [...prev, id]
    ));
  };

  const generateReview = async () => {
    const documentIds = selectedReviewPapers.length
      ? selectedReviewPapers
      : readyCollectionPapers.slice(0, 6).map((paper) => paper.id);
    if (!documentIds.length) return setReviewError("Select indexed papers before generating a literature review.");

    setReviewLoading(true);
    setReviewError("");
    try {
      const review = await queryApi.generateLiteratureReview({
        collectionId: activeCollectionId,
        documentIds,
        topic: reviewTopic || collection.name,
        title: `${reviewTopic || collection.name} Literature Review`,
      });
      setActiveReview(review);
      setReviews((prev) => [review, ...prev.filter((item) => item.id !== review.id)]);
    } catch (err) {
      setReviewError(err?.message || "Unable to generate a citation-backed literature review.");
    } finally {
      setReviewLoading(false);
    }
  };

  const saveNote = async () => {
    if (!noteTitle.trim() || !noteContent.trim()) return setNoteError("Add a note title and content.");
    setNoteError("");
    try {
      const note = await queryApi.createNote({
        title: noteTitle.trim(),
        content: noteContent.trim(),
        collectionId: activeCollectionId,
      });
      setNotes((prev) => [note, ...prev]);
      setNoteTitle("");
      setNoteContent("");
    } catch (err) {
      setNoteError(err?.message || "Unable to save note.");
    }
  };

  if (loading) {
    return <LoadingSkeleton rows={5} />;
  }

  if (!collection) {
    return (
      <div className="not-found-shell">
        <EmptyState
          icon="collections"
          title="Collection not found"
          description="This collection may have been removed or the route is incomplete. Return to Research Collections to choose another domain."
          action={<ActionButton icon="collections" onClick={() => navigateTo(PAGES.COLLECTIONS)}>Open Collections</ActionButton>}
        />
      </div>
    );
  }

  const columns = [
    {
      key: "title",
      label: "Paper",
      render: (paper) => (
        <div className="table-title">
          {paper.title}
          <span>{paper.authors || "Author metadata pending"}</span>
        </div>
      ),
    },
    { key: "createdAt", label: "Uploaded", render: (paper) => formatDate(paper.createdAt) },
    { key: "pages", label: "Pages" },
    { key: "status", label: "Status", render: (paper) => <ProcessingStatusBadge status={paper.status} /> },
    { key: "conceptsExtracted", label: "Concepts" },
    { key: "citations", label: "Citations" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Collection Intelligence"
        title={collection.name}
        description={collection.description || "A research domain containing papers, concepts, citations, and analytics."}
        meta={`${collection.workspaceName || "Research Workspace"} / ${metrics.papers} papers / ${metrics.concepts} concepts`}
        actions={(
          <>
            <ActionButton icon="chat" variant="secondary" onClick={() => navigateTo(PAGES.CHAT, collection.workspaceId, collection.id)}>Ask Collection</ActionButton>
            <ActionButton icon="upload" onClick={() => fileRef.current?.click()}>Upload Paper</ActionButton>
          </>
        )}
      />

      <ErrorNotice message={error || uploadError} />

      <form onSubmit={upload} style={{ display: "none" }}>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" onChange={upload} />
      </form>

      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview", icon: "dashboard" },
          { value: "papers", label: "Papers", icon: "papers" },
          { value: "reviews", label: "Literature Review", icon: "citation" },
          { value: "notes", label: "Notes", icon: "book" },
          { value: "analytics", label: "Analytics", icon: "analytics" },
        ]}
      />

      {uploading && <ErrorNotice message="Uploading paper and starting document processing..." />}

      {tab === "overview" && (
        <>
          <section className="analytics-grid" style={{ marginTop: 14 }}>
            <ResearchStatCard icon="papers" label="Papers" value={metrics.papers} trend="domain" growth={`${metrics.ready} ready`} description="Papers attached to this research collection." tone="blue" />
            <ResearchStatCard icon="spark" label="Concepts" value={metrics.concepts} trend="extracted" growth="methods and datasets" description="Concepts available for exploration." tone="cyan" />
            <ResearchStatCard icon="citation" label="Citations" value={metrics.citations} trend="grounded" growth="source references" description="Citation anchors for answers and summaries." tone="amber" />
          </section>
          <section className="dashboard-section-grid">
            <Panel title="Collection Papers" eyebrow="Recent">
              <div className="panel-padding">
                {collectionPapers.length ? (
                  <div className="paper-card-grid">
                    {collectionPapers.slice(0, 4).map((paper) => <PaperCard key={paper.id} paper={paper} />)}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    icon="papers"
                    title="No papers in this collection"
                    description="Upload your first paper to start extracting concepts and citations."
                    action={<ActionButton icon="upload" onClick={() => fileRef.current?.click()}>Upload Paper</ActionButton>}
                  />
                )}
              </div>
            </Panel>
          </section>
        </>
      )}

      {tab === "papers" && (
        <div style={{ marginTop: 14 }}>
          <Panel title="Papers" eyebrow="Research Library">
            <ResearchTable
              columns={columns}
              rows={collectionPapers}
              emptyTitle="No papers in this collection"
              emptyDescription="Upload PDFs to make this research domain useful."
            />
          </Panel>
        </div>
      )}

      {tab === "reviews" && (
        <section className="dashboard-section-grid" style={{ marginTop: 14 }}>
          <Panel title="Generate Literature Review" eyebrow="Flagship workflow">
            <div className="panel-padding" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                className="field-control"
                value={reviewTopic}
                onChange={(event) => setReviewTopic(event.target.value)}
                placeholder={`Topic, e.g. ${collection.name}`}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {readyCollectionPapers.length ? readyCollectionPapers.map((paper) => (
                  <button
                    key={paper.id}
                    type="button"
                    onClick={() => toggleReviewPaper(paper.id)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: selectedReviewPapers.includes(paper.id) ? "1px solid rgba(110,231,249,0.38)" : "1px solid var(--rp-border)",
                      background: selectedReviewPapers.includes(paper.id) ? "rgba(110,231,249,0.08)" : "rgba(255,255,255,0.03)",
                      color: selectedReviewPapers.includes(paper.id) ? "var(--rp-cyan)" : "var(--rp-text-soft)",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    {selectedReviewPapers.includes(paper.id) ? "Selected: " : ""}{paper.title}
                  </button>
                )) : (
                  <EmptyState compact icon="papers" title="No indexed papers" description="Literature reviews need completed paper chunks and citations." />
                )}
              </div>
              <ErrorNotice message={reviewError} />
              <ActionButton icon="citation" onClick={generateReview} disabled={reviewLoading || !readyCollectionPapers.length}>
                {reviewLoading ? "Generating..." : "Generate Literature Review"}
              </ActionButton>
            </div>
          </Panel>

          <Panel title="Generated Reviews" eyebrow={`${reviews.length} stored`}>
            <div className="panel-padding" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {activeReview ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--rp-text)", fontSize: "1rem" }}>{activeReview.title}</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--rp-text-muted)", fontSize: "0.78rem" }}>
                        {activeReview.documentIds?.length || 0} papers / citation-backed sections
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <ActionButton icon="download" variant="ghost" onClick={() => queryApi.exportLiteratureReview(activeReview.id, "markdown", activeReview.title)}>Markdown</ActionButton>
                      <ActionButton icon="download" variant="secondary" onClick={() => queryApi.exportLiteratureReview(activeReview.id, "pdf", activeReview.title)}>PDF</ActionButton>
                    </div>
                  </div>
                  {Object.values(activeReview.sections || {}).map((section) => (
                    <div key={section.heading} style={{ borderTop: "1px solid var(--rp-border)", paddingTop: 10 }}>
                      <strong style={{ color: "var(--rp-cyan)", fontSize: "0.82rem" }}>{section.heading}</strong>
                      <p style={{ color: "var(--rp-text-soft)", lineHeight: 1.65, fontSize: "0.84rem" }}>{section.content}</p>
                      <div className="citation-strip">
                        {section.citations?.slice(0, 3).map((citation, index) => (
                          <span className="citation-chip" key={`${citation.chunkId}-${index}`}>
                            <span className="citation-chip-num">{index + 1}</span>
                            {citation.documentTitle} {citation.pageNumber ? `/ p.${citation.pageNumber}` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <EmptyState compact icon="citation" title="No literature reviews yet" description="Generate a review from selected indexed papers and export it as Markdown or PDF." />
              )}
              {!!reviews.length && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {reviews.slice(0, 5).map((review) => (
                    <button
                      key={review.id}
                      type="button"
                      className="query-history-item"
                      onClick={() => setActiveReview(review)}
                    >
                      <strong>{review.title}</strong>
                      <span>{new Date(review.createdAt).toLocaleDateString()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </section>
      )}

      {tab === "notes" && (
        <section className="dashboard-section-grid" style={{ marginTop: 14 }}>
          <Panel title="Collection Notes" eyebrow="Research workspace">
            <div className="panel-padding" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                className="field-control"
                value={noteTitle}
                onChange={(event) => setNoteTitle(event.target.value)}
                placeholder="Note title"
              />
              <textarea
                className="field-control"
                value={noteContent}
                onChange={(event) => setNoteContent(event.target.value)}
                rows={5}
                placeholder="Capture synthesis notes, open questions, or reading observations..."
              />
              <ErrorNotice message={noteError} />
              <ActionButton icon="book" onClick={saveNote}>Save Note</ActionButton>
            </div>
          </Panel>

          <Panel title="Saved Notes" eyebrow={`${notes.length} notes`}>
            <div className="panel-padding" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {notes.length ? notes.map((note) => (
                <div key={note.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--rp-border)" }}>
                  <strong style={{ color: "var(--rp-text)", fontSize: "0.9rem" }}>{note.title}</strong>
                  <p style={{ color: "var(--rp-text-soft)", lineHeight: 1.65, fontSize: "0.84rem", margin: "6px 0" }}>{note.content}</p>
                  <span style={{ color: "var(--rp-text-muted)", fontSize: "0.72rem" }}>{formatDate(note.updatedAt)}</span>
                </div>
              )) : (
                <EmptyState compact icon="book" title="No notes yet" description="Use notes to keep collection-level synthesis alongside papers, chats, and reviews." />
              )}
            </div>
          </Panel>
        </section>
      )}

      {tab === "analytics" && (
        <section className="dashboard-section-grid" style={{ marginTop: 14 }}>
          <Panel title="Processing Pipeline" eyebrow="Status">
            <div className="bar-list">
              {[
                ["Ready", metrics.ready, metrics.papers || 1],
                ["Processing", collectionPapers.filter((paper) => ["UPLOADED", "EXTRACTING", "CHUNKING", "EMBEDDING", "INDEXING"].includes(paper.status)).length, metrics.papers || 1],
                ["Queued", collectionPapers.filter((paper) => paper.status === "PENDING").length, metrics.papers || 1],
                ["Failed", collectionPapers.filter((paper) => paper.status === "FAILED").length, metrics.papers || 1],
              ].map(([label, value, total]) => (
                <div className="bar-row" key={label}>
                  <span>{label}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round((value / total) * 100)}%` }} /></div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Intelligence Coverage" eyebrow="Metadata">
            <div className="bar-list">
              {[
                ["Concept extraction", metrics.concepts, Math.max(metrics.concepts, 1)],
                ["Citation anchors", metrics.citations, Math.max(metrics.concepts, 1)],
              ].map(([label, value, total]) => (
                <div className="bar-row" key={label}>
                  <span>{label}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, Math.round((value / total) * 100))}%` }} /></div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      )}
    </>
  );
};

export default CollectionPage;
