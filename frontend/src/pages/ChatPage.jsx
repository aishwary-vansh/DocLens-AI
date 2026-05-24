import { useEffect, useMemo, useRef, useState } from "react";
import { documentsApi, queryApi } from "../services/api";
import { useApp, PAGES } from "../contexts/AppContext";
import useResearchCorpus from "../hooks/useResearchCorpus";
import {
  ActionButton,
  EmptyState,
  ErrorNotice,
  PageHeader,
  ProcessingStatusBadge,
} from "../components/research/ResearchComponents";
import Icon from "../components/research/Icons";
import { sampleQueries } from "../utils/researchData";

const PIPELINE_STAGES = ["PENDING", "UPLOADED", "EXTRACTING", "CHUNKING", "EMBEDDING", "INDEXING", "COMPLETED"];
const STAGE_LABELS    = ["Queued", "Uploaded", "Extracting", "Chunking", "Embedding", "Indexing", "Ready"];

function PipelineTracker({ status }) {
  const idx = PIPELINE_STAGES.indexOf(status === "READY" ? "COMPLETED" : status);
  if (!status || status === "FAILED") return null;
  return (
    <div className="pipeline-tracker" style={{ padding: "10px 0 0" }}>
      {PIPELINE_STAGES.map((s, i) => (
        <div
          key={s}
          className={`pipeline-step ${i < idx ? "done" : i === idx ? "active" : ""}`}
        >
          <div className="pipeline-node">
            {i < idx ? "✓" : i === idx ? "○" : String(i + 1)}
          </div>
          <span className="pipeline-label">{STAGE_LABELS[i]}</span>
        </div>
      ))}
    </div>
  );
}

function CitationChip({ citation, index, onClick }) {
  return (
    <button className="citation-chip" onClick={() => onClick(citation)} type="button" title={citation.documentTitle}>
      <span className="citation-chip-num">{index + 1}</span>
      {citation.documentTitle?.length > 28
        ? citation.documentTitle.slice(0, 28) + "…"
        : citation.documentTitle}
      {citation.score && (
        <span style={{ opacity: 0.7 }}>· {Math.round(citation.score * 100)}%</span>
      )}
    </button>
  );
}

function Message({ message, onCitationClick, onCopy }) {
  return (
    <div className={`message ${message.role}`}>
      <span>{message.role === "user" ? "You" : "DocLens AI"}</span>
      <p>{message.content}</p>
      {!!message.citations?.length && (
        <div className="citation-strip">
          {message.citations.map((c, i) => (
            <CitationChip key={`${c.documentTitle}-${i}`} citation={c} index={i} onClick={onCitationClick} />
          ))}
        </div>
      )}
      {message.role === "assistant" && (
        <div className="message-actions">
          <button className="msg-action-btn" onClick={() => onCopy(message.content)} type="button">
            <Icon name="citation" size={11} /> Copy
          </button>
        </div>
      )}
    </div>
  );
}

const ChatPage = () => {
  const { activeCollectionId, navigateTo } = useApp();
  const { collections, papers, error } = useResearchCorpus();
  const [selectedCollectionId, setSelectedCollectionId] = useState(activeCollectionId || "");
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [input, setInput] = useState(localStorage.getItem("doclens_last_query") || "");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Ask a grounded research question and I'll answer with source citations from your papers. Select a collection and paper to scope the session.",
      citations: [],
    },
  ]);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [chatError, setChatError] = useState("");
  const [history, setHistory] = useState(() => JSON.parse(localStorage.getItem("doclens_query_history") || "[]"));
  const [sending, setSending] = useState(false);
  const [activeCitation, setActiveCitation] = useState(null);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (!selectedCollectionId && collections[0]?.id) setSelectedCollectionId(collections[0].id);
  }, [collections, selectedCollectionId]);

  const collectionPapers = useMemo(
    () => papers.filter(p => !selectedCollectionId || p.collectionId === selectedCollectionId),
    [papers, selectedCollectionId],
  );

  useEffect(() => {
    if (!selectedPaperId && collectionPapers[0]?.id) setSelectedPaperId(collectionPapers[0].id);
  }, [collectionPapers, selectedPaperId]);

  useEffect(() => {
    if (!selectedCollectionId) return;
    let cancelled = false;
    queryApi.sessions(selectedCollectionId)
      .then(items => { if (!cancelled) setSessions(items); })
      .catch(() => { if (!cancelled) setSessions([]); });
    return () => { cancelled = true; };
  }, [selectedCollectionId, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const selectedPaper     = papers.find(p => p.id === selectedPaperId) || collectionPapers[0];
  const selectedCollection = collections.find(c => c.id === selectedCollectionId);
  const readyPapers       = collectionPapers.filter(p => ["READY", "COMPLETED"].includes(p.status));
  const latestAssistant   = [...messages].reverse().find(m => m.role === "assistant");
  const processingPapers  = collectionPapers.filter(p => !["READY", "COMPLETED", "FAILED"].includes(p.status));

  const persistHistory = (question) => {
    const next = [question, ...history.filter(i => i !== question)].slice(0, 6);
    setHistory(next);
    localStorage.setItem("doclens_query_history", JSON.stringify(next));
    localStorage.setItem("doclens_query_count", String(Number(localStorage.getItem("doclens_query_count") || 0) + 1));
  };

  const sendMessage = async (question = input) => {
    const trimmed = question.trim();
    if (!trimmed || sending) return;
    localStorage.setItem("doclens_last_query", "");
    setInput("");
    persistHistory(trimmed);
    setActiveCitation(null);
    setChatError("");
    setMessages(prev => [...prev, { role: "user", content: trimmed, citations: [] }]);
    setSending(true);

    try {
      if (!selectedCollectionId) throw new Error("Create a collection and upload papers before asking grounded questions.");
      const response = await queryApi.ask({
        question: trimmed,
        collectionId: selectedCollectionId,
        sessionId: sessionId || undefined,
        topK: 6,
        documentIds: selectedPaperId ? [selectedPaperId] : undefined,
      });
      if (!response.citations?.length) {
        throw new Error("DocLens could not produce a citation-backed answer for this question.");
      }
      setSessionId(response.session_id || response.sessionId || sessionId);
      setMessages(prev => [...prev, { role: "assistant", content: response.content, citations: response.citations || [] }]);
    } catch (err) {
      setChatError(err?.message || "The research query could not be completed with source citations.");
      return;
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: err?.statusCode === 404 || err?.statusCode === 503
            ? "The AI query service is not connected yet. Once the semantic service is live, this question will be answered with source citations."
            : err?.message || "The research query could not be completed.",
          citations: readyPapers.slice(0, 3).map(p => ({
            documentTitle: p.title,
            score: 0.82,
            chunk: "",
          })),
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const clearSession = () => {
    setMessages([{ role: "assistant", content: "Session cleared. Ask a new research question.", citations: [] }]);
    setActiveCitation(null);
    setSessionId("");
    setChatError("");
  };

  const loadSession = async (id) => {
    setChatError("");
    try {
      const session = await queryApi.session(id);
      setSessionId(id);
      setMessages(session.messages || []);
      setActiveCitation(null);
    } catch (err) {
      setChatError(err?.message || "Unable to load chat session.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Research Chat"
        title="Ask papers with source material in view."
        description="Citation-aware answers scoped to your research collections. Click a citation chip to inspect the source chunk."
        actions={
          <>
            <ActionButton icon="arrowRight" variant="ghost" onClick={clearSession}>Clear Session</ActionButton>
          </>
        }
      />

      <ErrorNotice message={error && "The paper API is unavailable. Research Chat is rendering with fallback states."} />
      <ErrorNotice message={chatError} />

      <div className="chat-layout">
        {/* Left: PDF viewer + source panel */}
        <section className="pdf-viewer">
          <div className="pdf-toolbar">
            <div>
              <strong>{selectedPaper?.title || "No paper selected"}</strong>
              <span style={{ display: "block", color: "var(--rp-text-muted)", fontSize: "0.78rem", marginTop: 3 }}>
                {selectedCollection?.name || "Research collection"} / Source view
              </span>
            </div>
            {selectedPaper && <ProcessingStatusBadge status={selectedPaper.status} />}
          </div>

          {selectedPaper ? (
            <>
              {processingPapers.some(p => p.id === selectedPaper.id) && (
                <PipelineTracker status={selectedPaper.status} />
              )}
              {activeCitation ? (
                <div className="pdf-page">
                  <h2>{selectedPaper.title}</h2>
                  <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(110,231,249,0.1)", borderRadius: 6, border: "1px solid rgba(110,231,249,0.25)", fontSize: "0.78rem", color: "var(--rp-cyan)", fontFamily: "var(--rp-mono)" }}>
                    Source citation from: {activeCitation.documentTitle}
                    {activeCitation.pageNumber ? ` / page ${activeCitation.pageNumber}` : ""}
                    {activeCitation.chunkIndex !== undefined ? ` / chunk ${activeCitation.chunkIndex}` : ""}
                  </div>
                  <p style={{ fontSize: "0.84rem", lineHeight: 1.65, color: "#152029" }}>{activeCitation.chunk}</p>
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: "0.72rem", color: "#5c7080" }}>
                    <span>Semantic relevance: {Math.round((activeCitation.score || 0) * 100)}%</span>
                    {activeCitation.documentId && (
                      <button
                        type="button"
                        onClick={() => documentsApi.download(activeCitation.documentId, `${activeCitation.documentTitle || "paper"}.pdf`)}
                        style={{ border: "1px solid rgba(21,32,41,0.15)", borderRadius: 5, background: "rgba(255,255,255,0.6)", color: "#152029", padding: "4px 8px", cursor: "pointer" }}
                      >
                        Open PDF
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ position: "relative", height: "100%", minHeight: 300, display: "flex", flexDirection: "column", gap: 14, padding: "30px 40px", background: "rgba(255, 255, 255, 0.02)", borderRadius: 8, border: "1px solid rgba(255, 255, 255, 0.04)", overflow: "hidden" }}>
                  <div style={{ width: "35%", height: 22, background: "rgba(255, 255, 255, 0.06)", borderRadius: 4, marginBottom: 8 }} />
                  <div style={{ width: "85%", height: 12, background: "rgba(255, 255, 255, 0.03)", borderRadius: 3 }} />
                  <div style={{ width: "92%", height: 12, background: "rgba(255, 255, 255, 0.03)", borderRadius: 3 }} />
                  <div style={{ width: "78%", height: 12, background: "rgba(255, 255, 255, 0.03)", borderRadius: 3 }} />
                  <div style={{ width: "88%", height: 12, background: "rgba(255, 255, 255, 0.03)", borderRadius: 3, marginTop: 12 }} />
                  <div style={{ width: "95%", height: 12, background: "rgba(255, 255, 255, 0.03)", borderRadius: 3 }} />
                  <div style={{ width: "65%", height: 12, background: "rgba(255, 255, 255, 0.03)", borderRadius: 3 }} />

                  {/* Gradient overlay for smooth fade out */}
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 10%, rgba(17, 24, 32, 0.8) 50%, rgba(17, 24, 32, 1) 90%)", display: "grid", placeItems: "center", padding: "0 20px" }}>
                    <EmptyState
                      compact icon="citation"
                      title="No source viewed"
                      description="Ask a question and click on a citation chip to read the source paragraph directly from the document."
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ position: "relative", height: "100%", minHeight: 400, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px", background: "rgba(255, 255, 255, 0.02)", borderRadius: 8, border: "1px solid rgba(255, 255, 255, 0.04)" }}>
               <Icon name="chat" size={32} style={{ color: "var(--rp-cyan)", opacity: 0.8, marginBottom: 16 }} />
               <h3 style={{ margin: "0 0 8px 0", fontSize: "1.1rem" }}>Start a Research Conversation</h3>
               <p style={{ color: "var(--rp-text-soft)", textAlign: "center", maxWidth: 300, marginBottom: 24, fontSize: "0.85rem", lineHeight: 1.5 }}>
                 Select a paper to view its source text, or ask a general question across your collection.
               </p>
               <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 360 }}>
                 {[
                   "What is the main contribution?",
                   "What methodology was used?",
                   "What datasets were used?",
                   "What limitations exist?",
                   "What future work is suggested?",
                 ].map(q => (
                   <button
                     key={q}
                     onClick={() => sendMessage(q)}
                     style={{ textAlign: "left", padding: "10px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "var(--rp-text)", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.2s" }}
                     onMouseOver={e => { e.target.style.background = "rgba(110,231,249,0.08)"; e.target.style.borderColor = "var(--rp-cyan)"; }}
                     onMouseOut={e => { e.target.style.background = "rgba(255,255,255,0.03)"; e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
                   >
                     {q}
                   </button>
                 ))}
               </div>
            </div>
          )}

          <div className="source-panel">
            <select
              className="field-control"
              value={selectedCollectionId}
              onChange={e => { setSelectedCollectionId(e.target.value); setSelectedPaperId(""); }}
            >
              {!collections.length && <option value="">No collections yet</option>}
              {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="field-control"
              value={selectedPaperId}
              onChange={e => setSelectedPaperId(e.target.value)}
            >
              {!collectionPapers.length && <option value="">No papers in collection</option>}
              {collectionPapers.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <div className="source-card">
              <strong>Source References</strong>
              <span>{readyPapers.length} indexed / {collectionPapers.length} total papers in collection</span>
            </div>
            {!!sessions.length && (
              <div className="source-card">
                <strong>Recent Chat Sessions</strong>
                {sessions.slice(0, 4).map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => loadSession(item.id)}
                    style={{ marginTop: 8, width: "100%", border: 0, background: "rgba(255,255,255,0.04)", color: "var(--rp-text-soft)", borderRadius: 6, padding: "7px 8px", textAlign: "left", cursor: "pointer", fontSize: "0.75rem" }}
                  >
                    {item.title || "Untitled session"}
                  </button>
                ))}
              </div>
            )}
            {latestAssistant?.citations?.slice(0, 4).map((c, i) => (
              <button
                key={`${c.documentTitle}-${i}`}
                className="source-card"
                style={{ width: "100%", textAlign: "left", cursor: "pointer", border: activeCitation === c ? "1px solid rgba(110,231,249,0.35)" : undefined }}
                onClick={() => setActiveCitation(activeCitation === c ? null : c)}
                type="button"
              >
                <strong>[{i + 1}] {c.documentTitle?.length > 34 ? c.documentTitle.slice(0, 34) + "…" : c.documentTitle}</strong>
                <span>{Math.round((c.score || 0) * 100)}% semantic match · Click to inspect</span>
              </button>
            ))}
          </div>
        </section>

        {/* Right: Chat interface */}
        <section className="chat-interface">
          <div className="chat-toolbar">
            <div>
              <strong>Research Session</strong>
              <span style={{ display: "block", color: "var(--rp-text-muted)", fontSize: "0.78rem", marginTop: 3 }}>
                Citation-aware answers · semantic recall · {messages.filter(m => m.role === "user").length} questions this session
              </span>
            </div>
            <span className="citation-badge">
              <Icon name="citation" size={13} />
              {latestAssistant?.citations?.length || 0} citations
            </span>
          </div>

          <div className="chat-messages">
            {!collections.length && (
              <EmptyState compact icon="collections"
                title="Create a collection to start"
                description="Research Chat needs a collection so answers can be scoped to papers."
                action={<ActionButton icon="collections" onClick={() => navigateTo(PAGES.COLLECTIONS)}>Open Collections</ActionButton>}
              />
            )}
            {messages.map((m, i) => (
              <Message key={i} message={m} onCitationClick={setActiveCitation} onCopy={handleCopy} />
            ))}
            {sending && (
              <div className="message">
                <span>DocLens AI</span>
                <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid var(--rp-border)", borderTopColor: "var(--rp-cyan)", borderRadius: "50%", animation: "rp-spin 0.7s linear infinite" }} />
                  Reading source chunks and preparing a citation-aware response…
                </p>
              </div>
            )}
            {copied && (
              <div style={{ textAlign: "center", padding: "4px 0", color: "var(--rp-green)", fontFamily: "var(--rp-mono)", fontSize: "0.68rem" }}>
                Copied to clipboard ✓
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div>
            <div className="source-panel">
              <strong style={{ fontSize: "0.82rem" }}>Query History</strong>
              {(history.length ? history : sampleQueries.slice(0, 3)).map(item => (
                <button className="query-history-item" key={item} onClick={() => sendMessage(item)} type="button">
                  <strong>{item}</strong>
                  <span>Run in this research session</span>
                </button>
              ))}
            </div>
            <form className="chat-composer" onSubmit={e => { e.preventDefault(); sendMessage(); }}>
              <input
                ref={inputRef}
                className="field-control"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about methods, datasets, findings, or citations…"
              />
              <ActionButton icon="arrowRight" type="submit" disabled={sending || !input.trim()}>Ask</ActionButton>
            </form>
          </div>
        </section>
      </div>
    </>
  );
};

export default ChatPage;
