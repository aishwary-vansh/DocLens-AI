import { useMemo, useRef, useState, useCallback } from "react";
import { documentsApi } from "../services/api";
import useResearchCorpus from "../hooks/useResearchCorpus";
import {
  ActionButton,
  EmptyState,
  ErrorNotice,
  LoadingSkeleton,
  PageHeader,
  PaperCard,
  ProcessingStatusBadge,
  ResearchTable,
  SegmentedControl,
} from "../components/research/ResearchComponents";
import Icon from "../components/research/Icons";
import { formatDate } from "../utils/researchData";

const PIPELINE_STAGES = ["UPLOADED", "PROCESSING", "READY"];

function MiniPipeline({ status }) {
  const isProcessing = ["EXTRACTING", "CHUNKING", "EMBEDDING", "INDEXING"].includes(status);
  const isReady = ["READY", "COMPLETED"].includes(status);
  const idx = isReady ? 2 : isProcessing ? 1 : 0;
  return (
    <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
      {PIPELINE_STAGES.map((s, i) => (
        <div key={s} style={{
          flex: 1, height: 3, borderRadius: 2,
          background: i < idx ? "var(--rp-green)" : i === idx ? "var(--rp-cyan)" : "rgba(255,255,255,0.08)",
          transition: "background 0.3s",
        }} />
      ))}
    </div>
  );
}

const PapersPage = () => {
  const { collections, papers, loading, error, refresh } = useResearchCorpus();
  const [view, setView]                   = useState("grid");
  const [query, setQuery]                 = useState("");
  const [status, setStatus]               = useState("ALL");
  const [showUpload, setShowUpload]       = useState(false);
  const [uploadCollection, setUploadCollection] = useState("");
  const [uploading, setUploading]         = useState(false);
  const [uploadError, setUploadError]     = useState("");
  const [dragOver, setDragOver]           = useState(false);
  const [selectedFile, setSelectedFile]   = useState(null);
  const fileRef = useRef(null);

  const filteredPapers = useMemo(() => (
    papers
      .filter(p => {
        if (status === "ALL") return true;
        if (status === "COMPLETED" || status === "READY") return ["READY", "COMPLETED"].includes(p.status);
        if (status === "PROCESSING") return ["EXTRACTING", "CHUNKING", "EMBEDDING", "INDEXING"].includes(p.status);
        return p.status === status;
      })
      .filter(p => {
        const text = `${p.title} ${p.authors} ${p.collectionName}`.toLowerCase();
        return !query || text.includes(query.toLowerCase());
      })
  ), [papers, query, status]);

  const processingCount = papers.filter(p => !["READY", "COMPLETED", "FAILED"].includes(p.status)).length;

  const openUpload = () => {
    setUploadCollection(collections[0]?.id || "");
    setUploadError("");
    setSelectedFile(null);
    setShowUpload(true);
  };

  const handleFile = (file) => {
    if (file && file.type === "application/pdf") setSelectedFile(file);
    else setUploadError("DocLens currently accepts PDF papers only.");
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const uploadPaper = async (event) => {
    event.preventDefault();
    const file = selectedFile || fileRef.current?.files?.[0];
    if (!uploadCollection) return setUploadError("Choose a research collection first.");
    if (!file) return setUploadError("Choose a PDF to upload.");
    if (file.type !== "application/pdf") return setUploadError("DocLens currently accepts PDF papers.");

    setUploading(true);
    setUploadError("");
    try {
      await documentsApi.upload(file, uploadCollection);
      setShowUpload(false);
      setSelectedFile(null);
      await refresh();
    } catch (err) {
      setUploadError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const columns = [
    {
      key: "title",
      label: "Paper",
      render: (paper) => (
        <div className="table-title">
          {paper.title}
          <span>{paper.authors || "Author metadata pending"}</span>
          {!["READY", "COMPLETED", "FAILED"].includes(paper.status) && <MiniPipeline status={paper.status} />}
        </div>
      ),
    },
    { key: "collectionName", label: "Collection" },
    { key: "createdAt",      label: "Uploaded",  render: p => formatDate(p.createdAt) },
    { key: "pages",          label: "Pages" },
    { key: "status",         label: "Status",    render: p => <ProcessingStatusBadge status={p.status} /> },
    { key: "citations",      label: "Citations" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Research Library"
        title="A paper library built for intelligence work."
        description="Upload, organise, and track papers through the research intelligence pipeline."
        actions={(
          <>
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: "grid",  label: "Grid",  icon: "grid" },
                { value: "table", label: "Table", icon: "table" },
              ]}
            />
            <ActionButton icon="upload" onClick={openUpload} disabled={!collections.length}>Upload Paper</ActionButton>
          </>
        )}
      />

      <ErrorNotice message={error && "Unable to reach the document API. Showing stable empty library state."} />

      {processingCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 14,
          border: "1px solid rgba(246,200,95,0.25)", borderRadius: 8, background: "rgba(246,200,95,0.06)",
          color: "var(--rp-amber)", fontSize: "0.84rem",
        }}>
          <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid var(--rp-amber)", borderTopColor: "transparent", borderRadius: "50%", animation: "rp-spin 0.8s linear infinite", flexShrink: 0 }} />
          <strong>{processingCount} paper{processingCount !== 1 ? "s" : ""} processing</strong>
          <span style={{ color: "var(--rp-text-muted)" }}>— status will update when the pipeline completes</span>
        </div>
      )}

      <div className="filter-bar" style={{ flexDirection: "column", gap: 10 }}>
        <input
          className="field-control"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by title, author, or collection…"
          style={{ width: "100%" }}
        />
        <div className="status-pills">
          {[
            { value: "ALL",        label: "All",        color: "var(--rp-text-soft)" },
            { value: "COMPLETED",  label: "Ready",      color: "var(--rp-green)"  },
            { value: "UPLOADED",   label: "Uploaded",   color: "var(--rp-cyan)"   },
            { value: "PROCESSING", label: "Processing", color: "var(--rp-amber)"  },
            { value: "FAILED",     label: "Failed",     color: "var(--rp-rose)"   },
          ].map(pill => (
            <button
              key={pill.value}
              type="button"
              className={`status-pill ${status === pill.value ? "active" : ""}`}
              style={{ "--pill-color": pill.color }}
              onClick={() => setStatus(pill.value)}
            >
              {pill.value !== "ALL" && <i />}
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : !collections.length ? (
        <EmptyState
          icon="collections"
          title="Create a research collection first"
          description="Papers need a collection so DocLens can organise notes and citations by research domain."
        />
      ) : !papers.length ? (
        <EmptyState
          icon="papers"
          title="No papers uploaded yet"
          description="Upload your first research paper to start building your library."
          action={<ActionButton icon="upload" onClick={openUpload}>Upload Paper</ActionButton>}
        />
      ) : view === "grid" ? (
        <div className="paper-card-grid">
          {filteredPapers.map(p => <PaperCard key={p.id} paper={p} />)}
          {!filteredPapers.length && (
            <EmptyState compact icon="filter" title="No papers match this filter" description="Try another search term or status filter." />
          )}
        </div>
      ) : (
        <ResearchTable
          columns={columns}
          rows={filteredPapers}
          emptyTitle="No papers match this filter"
          emptyDescription="Try another search term or processing status."
        />
      )}

      {/* Upload modal */}
      {showUpload && (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setShowUpload(false)}>
          <div className="modal-card">
            <header>
              <h2>Upload research paper</h2>
              <p>Add a PDF to a collection to begin processing and indexing.</p>
            </header>
            <form onSubmit={uploadPaper}>
              <div className="form-row">
                <label>Research Collection</label>
                <select className="field-control" value={uploadCollection} onChange={e => setUploadCollection(e.target.value)}>
                  {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Drag and drop zone */}
              <div
                className={`upload-zone ${dragOver ? "drag-over" : ""}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="upload" size={28} />
                {selectedFile ? (
                  <>
                    <strong style={{ color: "var(--rp-green)" }}>{selectedFile.name}</strong>
                    <span>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB — PDF ready to upload</span>
                  </>
                ) : (
                  <>
                    <strong>Drag a PDF here or click to browse</strong>
                    <span>Accepts PDF papers only</span>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  style={{ display: "none" }}
                  onChange={e => handleFile(e.target.files?.[0])}
                />
              </div>

              {uploadError && <ErrorNotice message={uploadError} />}
              <div className="modal-actions">
                <ActionButton icon="arrowRight" variant="ghost" onClick={() => setShowUpload(false)}>Cancel</ActionButton>
                <ActionButton icon="upload" type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload Paper"}</ActionButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default PapersPage;
