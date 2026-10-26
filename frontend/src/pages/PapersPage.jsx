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
import Modal from "../components/ui/Modal";
import { useToast } from "../contexts/ToastContext";

const PIPELINE_STAGES = ["UPLOADED", "PROCESSING", "READY"];
// Matches the backend limit in documents.controller.ts.
const MAX_UPLOAD_MB = 50;

const isPdf = (file) => file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));

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
  const [uploadProgress, setUploadProgress] = useState(0);
  const toast = useToast();
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

  // Some drag sources give no MIME type, so the .pdf extension also counts.
  const handleFile = (file) => {
    if (!file) return;
    if (!isPdf(file)) return setUploadError("Only PDF files can be uploaded.");
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      return setUploadError(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_MB} MB.`);
    }
    setUploadError("");
    setSelectedFile(file);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (files.length > 1) setUploadError("Drop one PDF at a time.");
    else handleFile(files[0]);
  }, []);

  const uploadPaper = async (event) => {
    event.preventDefault();
    const file = selectedFile || fileRef.current?.files?.[0];
    if (!uploadCollection) return setUploadError("Choose a research collection first.");
    if (!file) return setUploadError("Choose a PDF to upload.");
    if (!isPdf(file)) return setUploadError("Only PDF files can be uploaded.");

    setUploading(true);
    setUploadProgress(0);
    setUploadError("");
    try {
      await documentsApi.upload(file, uploadCollection, setUploadProgress);
      setShowUpload(false);
      setSelectedFile(null);
      toast.success(`"${file.name}" uploaded. Processing has started; it usually takes a few minutes.`);
      await refresh();
    } catch (err) {
      setUploadError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const deletePaper = async () => {
    const paper = confirmDelete;
    if (!paper) return;
    setDeleting(true);
    try {
      await documentsApi.remove(paper.id);
      setConfirmDelete(null);
      toast.success(`Deleted "${paper.title}".`);
      await refresh();
    } catch (err) {
      toast.error(err?.message || "Could not delete the paper.");
    } finally {
      setDeleting(false);
    }
  };

  const retryPaper = async (paper) => {
    try {
      await documentsApi.reprocess(paper.id);
      toast.success(`Processing "${paper.title}" again.`);
      await refresh();
    } catch (err) {
      toast.error(err?.message || "Could not restart processing.");
    }
  };

  const columns = [
    {
      key: "title",
      label: "Paper",
      render: (paper) => (
        <div className="table-title">
          {paper.title}
          {paper.authors && <span>{paper.authors}</span>}
          {paper.status === "FAILED" && <span className="table-error">{paper.errorMessage || "Processing failed."}</span>}
          {!["READY", "COMPLETED", "FAILED"].includes(paper.status) && <MiniPipeline status={paper.status} />}
        </div>
      ),
    },
    { key: "collectionName", label: "Collection" },
    { key: "createdAt",      label: "Uploaded",  render: p => formatDate(p.createdAt) },
    { key: "pages",          label: "Pages" },
    { key: "status",         label: "Status",    render: p => <ProcessingStatusBadge status={p.status} /> },
    { key: "citations",      label: "Citations" },
    {
      key: "actions",
      label: "",
      render: (p) => (
        <div className="row-actions">
          {p.status === "FAILED" && (
            <button type="button" className="icon-button" onClick={(e) => { e.stopPropagation(); retryPaper(p); }} title="Retry processing" aria-label={`Retry processing ${p.title}`}>
              <Icon name="activity" size={15} />
            </button>
          )}
          <button type="button" className="icon-button icon-button-danger" onClick={(e) => { e.stopPropagation(); setConfirmDelete(p); }} title="Delete paper" aria-label={`Delete ${p.title}`}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      )
    }
  ];

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Papers"
        description="Upload PDFs and track them through parsing, chunking and indexing. Only ready papers can be questioned."
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
          {filteredPapers.map(p => <PaperCard key={p.id} paper={p} onDelete={setConfirmDelete} onRetry={retryPaper} />)}
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
      <Modal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        busy={uploading}
        title="Upload research paper"
        description="Add a PDF to a collection. DocLens parses, indexes and profiles it in the background."
        onSubmit={uploadPaper}
        footer={
          <>
            <ActionButton icon={null} variant="ghost" onClick={() => setShowUpload(false)} disabled={uploading}>Cancel</ActionButton>
            <ActionButton icon="upload" type="submit" disabled={uploading || !selectedFile || !uploadCollection}>
              {uploading ? `Uploading… ${uploadProgress}%` : "Upload paper"}
            </ActionButton>
          </>
        }
      >
        <div className="form-row">
          <label htmlFor="upload-collection">Collection</label>
          <select id="upload-collection" className="field-control" value={uploadCollection} onChange={e => setUploadCollection(e.target.value)} disabled={uploading}>
            {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Drag and drop zone */}
        <div
          className={`upload-zone ${dragOver ? "drag-over" : ""} ${selectedFile ? "has-file" : ""}`}
          role="button"
          tabIndex={0}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileRef.current?.click()}
          onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileRef.current?.click())}
        >
          <Icon name={selectedFile ? "papers" : "upload"} size={26} />
          {selectedFile ? (
            <>
              <strong>{selectedFile.name}</strong>
              <span>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB · click to choose another file</span>
            </>
          ) : (
            <>
              <strong>Drop a PDF here or click to browse</strong>
              <span>PDF only, up to {MAX_UPLOAD_MB} MB</span>
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

        {uploading && (
          <div className="upload-progress" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
        {uploadError && <ErrorNotice message={uploadError} />}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        busy={deleting}
        width={440}
        title="Delete paper?"
        description={confirmDelete ? `"${confirmDelete.title}" and its indexed passages will be removed. This cannot be undone.` : ""}
        footer={
          <>
            <ActionButton icon={null} variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</ActionButton>
            <ActionButton icon="trash" variant="danger" onClick={deletePaper} disabled={deleting}>{deleting ? "Deleting…" : "Delete paper"}</ActionButton>
          </>
        }
      />
    </>
  );
};

export default PapersPage;
