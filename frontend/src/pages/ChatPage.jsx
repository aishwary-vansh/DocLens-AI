import { useEffect, useMemo, useRef, useState } from "react";
import { documentsApi, queryApi } from "../services/api";
import { useApp, PAGES } from "../contexts/AppContext";
import useResearchCorpus from "../hooks/useResearchCorpus";
import {
  ActionButton,
  EmptyState,
  ErrorNotice,
  ProcessingStatusBadge,
} from "../components/research/ResearchComponents";
import Icon from "../components/research/Icons";
import { sampleQueries } from "../utils/researchData";
import { PromptInput } from "../components/ui/PromptInput";
import MarkdownAnswer from "../components/research/MarkdownAnswer";

// ── Source card (numbered like the [n] markers in the answer) ─────────
function SourceCard({ citation, index, active, onClick }) {
  return (
    <button
      className={`source-card ${active ? "is-active" : ""}`}
      onClick={() => onClick(citation)}
      type="button"
      title={`Open source ${index + 1}`}
    >
      <span className="source-card-num">{index + 1}</span>
      <span className="source-card-body">
        <strong>{citation.documentTitle || "Untitled paper"}</strong>
        <small>
          {citation.pageNumber ? `Page ${citation.pageNumber}` : "Page n/a"}
          {citation.score ? ` · ${Math.round(citation.score * 100)}% match` : ""}
        </small>
      </span>
    </button>
  );
}

/** Id that lets the backend recognise a retry of the same question. */
function newRequestId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const DEGRADED_REASON = {
  timeout: "The AI answer took too long",
  unavailable: "The AI model is unavailable (quota or API key)",
};

/** One shape for live answers and answers reloaded from a saved session. */
function toAssistantMessage(raw) {
  return {
    role: "assistant",
    content: raw.content,
    citations: raw.citations || [],
    insufficientEvidence: Boolean(raw.insufficient_evidence ?? raw.insufficientEvidence),
    evidenceConflict: Boolean(raw.evidence_conflict ?? raw.evidenceConflict),
    background: raw.background || null,
    degraded: raw.model_used === "extractive-citation-fallback" || Boolean(raw.degraded),
    aiFailure: raw.ai_failure || raw.aiFailure || null,
    unverifiedClaims: raw.unverifiedClaims ?? (raw.claims || []).filter(claim => claim.verified === false).length,
  };
}

function answerFlags(message) {
  const flags = [];
  if (message.degraded) {
    flags.push({ tone: "warn", text: `${DEGRADED_REASON[message.aiFailure] || "AI answer unavailable"}: showing the most relevant passages, not a written answer.` });
  } else if (message.insufficientEvidence) {
    flags.push({ tone: "warn", text: "Not enough evidence in your papers to answer this." });
  }
  if (message.evidenceConflict) flags.push({ tone: "conflict", text: "Sources disagree. Both sides are cited below." });
  if (message.unverifiedClaims > 0) {
    flags.push({ tone: "muted", text: `${message.unverifiedClaims} claim(s) could not be matched to their cited passage.` });
  }
  return flags;
}

// ── Single message bubble ──────────────────────────────────────────────
function Message({ message, onCitationClick, onCopy, activeCitation }) {
  const flags = message.role === "assistant" ? answerFlags(message) : [];
  return (
    <div className={`message ${message.role}`}>
      <span>{message.role === "user" ? "You" : "DocLens AI"}</span>
      {!!flags.length && (
        <div className="answer-flags" role="note">
          {flags.map(flag => (
            <span key={flag.text} className={`answer-flag is-${flag.tone}`}>{flag.text}</span>
          ))}
        </div>
      )}
      {message.role === "assistant" ? (
        <div className="message-body">
          <MarkdownAnswer text={message.content} citations={message.citations} onCite={onCitationClick} />
        </div>
      ) : (
        <p>{message.content}</p>
      )}
      {message.role === "assistant" && message.background && (
        <aside className="answer-background" aria-label="Background knowledge">
          <div className="answer-background-label">Background · general knowledge, not from your papers</div>
          <p>{message.background}</p>
        </aside>
      )}
      {!!message.citations?.length && (
        <div className="source-list" aria-label="Sources">
          <div className="source-list-label">Sources</div>
          <div className="source-list-grid">
            {message.citations.map((c, i) => (
              <SourceCard
                key={`${c.documentTitle}-${i}`}
                citation={c}
                index={i}
                active={activeCitation === c}
                onClick={onCitationClick}
              />
            ))}
          </div>
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

// ── History sidebar item ───────────────────────────────────────────────
function HistoryItem({ item, isActive, onClick, type = "session" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${isActive ? "var(--ds-accent-line)" : "var(--rp-border)"}`,
        background: isActive ? "var(--ds-accent-soft)" : "var(--ds-hover-faint)",
        cursor: "pointer",
        transition: "all 0.18s",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
      onMouseEnter={e => {
        if (!isActive) {
          e.currentTarget.style.background = "var(--ds-hover)";
          e.currentTarget.style.borderColor = "var(--rp-border-strong)";
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.background = "var(--ds-hover-faint)";
          e.currentTarget.style.borderColor = "var(--rp-border)";
        }
      }}
    >
      <span style={{
        fontSize: "0.78rem",
        color: isActive ? "var(--ds-accent)" : "var(--rp-text)",
        fontWeight: 500,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {typeof item === "string" ? item : item.title || "Untitled session"}
      </span>
      {type === "session" && (
        <span style={{ fontSize: "0.65rem", color: "var(--rp-text-muted)" }}>
          Click to restore session
        </span>
      )}
    </button>
  );
}

// ── Main ChatPage ──────────────────────────────────────────────────────
// Progress events from POST /query/ask/stream.
const STAGE_LABELS = {
  queued: "Sending your question…",
  loading_models: "Loading retrieval models…",
  rewriting: "Interpreting your follow-up question…",
  retrieving: "Searching and reranking passages in your papers…",
  generating: "Writing a cited answer with Gemini…",
  verifying: "Checking every claim against its cited passage…",
  background: "No relevant passage found. Checking if this is a general question…",
  fallback: "AI answer unavailable, collecting the most relevant passages…",
};

const ChatPage = () => {
  const { activeCollectionId, navigateTo } = useApp();
  const { collections, papers, error } = useResearchCorpus();
  const [selectedCollectionId, setSelectedCollectionId] = useState(activeCollectionId || "");
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [input, setInput] = useState(localStorage.getItem("doclens_last_query") || "");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Ask a grounded research question and I'll answer with source citations from your papers. Use the selectors below to scope your search to a collection or specific paper.",
      citations: [],
    },
  ]);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [chatError, setChatError] = useState("");
  const [history, setHistory] = useState(() =>
    JSON.parse(localStorage.getItem("doclens_query_history") || "[]")
  );
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  // Only the latest request may update the chat; older ones are aborted/ignored.
  const requestSeqRef = useRef(0);
  const abortRef = useRef(null);
  const [copied, setCopied] = useState(false);
  // Open by default on wide screens; on phones the panel is an overlay, so start closed.
  const [historyOpen, setHistoryOpen] = useState(() => !window.matchMedia?.("(max-width: 1200px)").matches);
  const [activeHistoryTab, setActiveHistoryTab] = useState("sessions"); // "sessions" | "queries"
  const [citationPanel, setCitationPanel] = useState(null); // for inline citation view
  const [activeCitation, setActiveCitation] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!selectedCollectionId && collections[0]?.id)
      setSelectedCollectionId(collections[0].id);
  }, [collections, selectedCollectionId]);

  const collectionPapers = useMemo(
    () => papers.filter(p => !selectedCollectionId || p.collectionId === selectedCollectionId),
    [papers, selectedCollectionId]
  );

  useEffect(() => {
    if (!selectedPaperId && collectionPapers[0]?.id)
      setSelectedPaperId(collectionPapers[0].id);
  }, [collectionPapers, selectedPaperId]);

  useEffect(() => {
    if (!selectedCollectionId) return;
    let cancelled = false;
    queryApi
      .sessions(selectedCollectionId)
      .then(items => { if (!cancelled) setSessions(items); })
      .catch(() => { if (!cancelled) setSessions([]); });
    return () => { cancelled = true; };
  }, [selectedCollectionId, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Elapsed-seconds counter so a long answer never looks frozen.
  useEffect(() => {
    if (!sending) return undefined;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [sending]);

  // Abort an in-flight answer when the page unmounts or the collection changes.
  useEffect(() => () => cancelInFlight(), [selectedCollectionId]);

  const readyPapers = collectionPapers.filter(p => ["READY", "COMPLETED"].includes(p.status));
  const inspectorOpen = historyOpen || Boolean(citationPanel);
  const latestAssistant = messages.slice().reverse().find(m => m.role === "assistant");

  const persistHistory = question => {
    const next = [question, ...history.filter(i => i !== question)].slice(0, 20);
    setHistory(next);
    localStorage.setItem("doclens_query_history", JSON.stringify(next));
    localStorage.setItem(
      "doclens_query_count",
      String(Number(localStorage.getItem("doclens_query_count") || 0) + 1)
    );
  };

  const cancelInFlight = () => {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setStage("");
  };

  const sendMessage = async (question = input) => {
    const trimmed = question.trim();
    if (!trimmed || sending) return;
    const seq = ++requestSeqRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () => requestSeqRef.current === seq;
    localStorage.setItem("doclens_last_query", "");
    setInput("");
    persistHistory(trimmed);
    setActiveCitation(null);
    setCitationPanel(null);
    setChatError("");
    setMessages(prev => [...prev, { role: "user", content: trimmed, citations: [] }]);
    setSending(true);
    setStage("queued");

    try {
      if (!selectedCollectionId)
        throw new Error("Create a collection and upload papers before asking grounded questions.");
      const payload = {
        question: trimmed,
        collectionId: selectedCollectionId,
        sessionId: sessionId || undefined,
        topK: 6,
        documentIds: selectedPaperId ? [selectedPaperId] : undefined,
        // Lets the backend recognise a retry of this exact request.
        clientRequestId: newRequestId(),
      };
      let response;
      try {
        response = await queryApi.askStream(payload, next => isCurrent() && setStage(next), controller.signal);
      } catch (err) {
        // Older backend without the stream route: same request, same id, no streaming.
        if (err?.statusCode !== 404) throw err;
        response = await queryApi.ask(payload);
      }
      if (!isCurrent()) return; // superseded or cancelled: never show a stale answer
      setSessionId(response.session_id || response.sessionId || sessionId);
      // An uncited reply is only shown when the backend marked it as
      // "not enough evidence"; it is labelled as such, never as a sourced answer.
      if (!response.citations?.length && !response.insufficient_evidence) {
        throw new Error("DocLens could not produce a citation-backed answer for this question.");
      }
      setMessages(prev => [...prev, toAssistantMessage(response)]);
    } catch (err) {
      if (!isCurrent()) return;
      setChatError(
        err?.statusCode === 499
          ? "Cancelled. Nothing was saved."
          : err?.message || "The research query could not be completed."
      );
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        setSending(false);
        setStage("");
        inputRef.current?.focus();
      }
    }
  };

  const handleCopy = text => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const clearSession = () => {
    cancelInFlight();
    setMessages([{ role: "assistant", content: "Session cleared. Ask a new research question.", citations: [] }]);
    setActiveCitation(null);
    setCitationPanel(null);
    setSessionId("");
    setChatError("");
  };

  const loadSession = async id => {
    cancelInFlight();
    setChatError("");
    try {
      const session = await queryApi.session(id);
      setSessionId(id);
      setMessages((session.messages || []).map(m => (m.role === "assistant" ? toAssistantMessage(m) : m)));
      setActiveCitation(null);
      setCitationPanel(null);
    } catch (err) {
      setChatError(err?.message || "Unable to load chat session.");
    }
  };

  const handleCitationClick = citation => {
    setCitationPanel(prev => (prev === citation ? null : citation));
    setActiveCitation(citation);
  };

  return (
    <div style={{
      display: "flex",
      height: "100%",
      flex: 1,
      width: "100%",
      overflow: "hidden",
      gap: 0,
      position: "relative",
    }}>

      {/* ── LEFT: History Sidebar ───────────────────────────── */}
      <aside className={`chat-inspector-panel ${inspectorOpen ? "is-open" : ""}`} style={{
        width: inspectorOpen ? 320 : 0,
        minWidth: inspectorOpen ? 320 : 0,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--rp-border)",
        background: "var(--chat-inspector-bg, rgba(10,12,18,0.98))",
        overflow: "hidden",
        transition: "width 0.25s ease, min-width 0.25s ease",
        order: 2,
      }}>
        {/* Sidebar header */}
        <div style={{
          padding: "16px",
          borderBottom: "1px solid var(--rp-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--rp-text-muted)" }}>
            History
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={clearSession}
              style={{ fontSize: "0.74rem", color: "var(--rp-text-muted)", background: "none", border: "none", cursor: "pointer" }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => { setHistoryOpen(false); setCitationPanel(null); }}
              aria-label="Close chat inspector"
              title="Close panel"
              style={{ color: "var(--rp-text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid var(--rp-border)",
          flexShrink: 0,
        }}>
          {["sessions", "queries"].map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveHistoryTab(tab)}
              style={{
                flex: 1,
                padding: "9px 4px",
                border: "none",
                borderBottom: `2px solid ${activeHistoryTab === tab ? "var(--ds-accent)" : "transparent"}`,
                background: "none",
                color: activeHistoryTab === tab ? "var(--ds-accent)" : "var(--rp-text-muted)",
                fontSize: "0.78rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "color 0.15s",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Sidebar content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {activeHistoryTab === "sessions" ? (
            sessions.length ? (
              sessions.slice(0, 20).map(item => (
                <HistoryItem
                  key={item.id}
                  item={item}
                  isActive={item.id === sessionId}
                  onClick={() => loadSession(item.id)}
                  type="session"
                />
              ))
            ) : (
              <div style={{ padding: "24px 8px", textAlign: "center", color: "var(--rp-text-muted)", fontSize: "0.75rem" }}>
                No sessions yet. Ask a question to start one.
              </div>
            )
          ) : (
            (history.length ? history : sampleQueries.slice(0, 6)).map((q, i) => (
              <HistoryItem
                key={i}
                item={q}
                isActive={false}
                onClick={() => sendMessage(q)}
                type="query"
              />
            ))
          )}
        </div>

        {/* Citation preview at the bottom of sidebar */}
        {citationPanel && (
          <div style={{
            borderTop: "1px solid var(--rp-border)",
            padding: "14px",
            flexShrink: 0,
            maxHeight: 220,
            overflowY: "auto",
          }}>
            <div style={{ fontSize: "0.6rem", fontWeight: 600, color: "var(--ds-accent)", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Source Citation</span>
              <button type="button" onClick={() => setCitationPanel(null)} style={{ background: "none", border: "none", color: "var(--rp-text-muted)", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--rp-text-soft)", fontStyle: "italic", marginBottom: 6 }}>
              {citationPanel.documentTitle}
              {citationPanel.pageNumber ? ` · p.${citationPanel.pageNumber}` : ""}
            </div>
            <p style={{ fontSize: "0.78rem", lineHeight: 1.6, color: "var(--rp-text)", margin: 0 }}>
              {citationPanel.chunk_text || citationPanel.chunk || citationPanel.chunkText || "Excerpt not available."}
            </p>
            <div style={{ marginTop: 8, fontSize: "0.65rem", color: "var(--rp-text-muted)" }}>
              Relevance: {Math.round((citationPanel.score || 0) * 100)}%
            </div>
            {citationPanel.documentId && (
              <button
                type="button"
                onClick={() => documentsApi.download(citationPanel.documentId, `${citationPanel.documentTitle || "paper"}.pdf`)}
                style={{ marginTop: 8, padding: "5px 10px", border: "1px solid var(--rp-border)", borderRadius: 5, background: "var(--ds-accent-soft)", color: "var(--ds-accent)", cursor: "pointer", fontSize: "0.7rem", width: "100%" }}
              >
                Download PDF
              </button>
            )}
          </div>
        )}
      </aside>

      {/* ── MAIN: Full Chat Area ────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Sleek Tool Bar instead of duplicate header */}
        <div style={{
          padding: "8px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 12,
          flexShrink: 0,
        }}>
          {latestAssistant?.citations?.length > 0 && (
            <span className="citation-badge">
              <Icon name="citation" size={13} />
              {latestAssistant.citations.length} citations
            </span>
          )}
          <ActionButton icon="arrowRight" variant="ghost" onClick={clearSession}>
            New Session
          </ActionButton>
          <button
            type="button"
            onClick={() => setHistoryOpen(o => !o)}
            title={historyOpen ? "Hide History" : "Show History"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 7,
              border: "1px solid var(--rp-border)",
              background: historyOpen ? "var(--ds-accent-soft)" : "transparent",
              color: historyOpen ? "var(--ds-accent)" : "var(--rp-text-muted)",
              cursor: "pointer",
              transition: "all 0.18s",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
        </div>

        {/* Error notices */}
        {(error || chatError) && (
          <div style={{ flexShrink: 0, padding: "0 20px" }}>
            <ErrorNotice message={error && "Paper API unavailable — showing fallback states."} />
            <ErrorNotice message={chatError} />
          </div>
        )}

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: "10px 0" }}>
          <div style={{ flex: 1, maxWidth: 860, width: "100%", margin: "0 auto", padding: "10px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {!collections.length && (
            <EmptyState compact icon="collections"
              title="Create a collection to start"
              description="Research Chat needs a collection so answers can be scoped to your papers."
              action={<ActionButton icon="collections" onClick={() => navigateTo(PAGES.COLLECTIONS)}>Open Collections</ActionButton>}
            />
          )}

          {/* Suggested questions when session is fresh */}
          {messages.length === 1 && collections.length > 0 && (
            <div className="chat-suggestions">
              <p className="chat-suggestions-label">Suggested questions</p>
              <div className="chat-suggestion-grid">
                {[
                  "What is the main contribution?",
                  "What methodology was used?",
                  "What datasets were evaluated on?",
                  "What are the key limitations?",
                  "What future work is suggested?",
                  "How does this compare to prior work?",
                ].map(q => (
                  <button key={q} type="button" className="chat-suggestion" onClick={() => sendMessage(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <Message key={i} message={m} onCitationClick={handleCitationClick} onCopy={handleCopy} activeCitation={activeCitation} />
          ))}

          {sending && (
            <div className="message">
              <span>DocLens AI</span>
              <p style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  display: "inline-block", width: 14, height: 14,
                  border: "2px solid var(--rp-border)",
                  borderTopColor: "var(--ds-accent)",
                  borderRadius: "50%",
                  animation: "rp-spin 0.7s linear infinite",
                  flexShrink: 0,
                }} />
                <span>
                  {STAGE_LABELS[stage] || "Working on your question…"}
                  <span style={{ color: "var(--rp-text-muted)", marginLeft: 8, fontVariantNumeric: "tabular-nums", fontSize: "0.72rem" }}>
                    {elapsed}s
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => { cancelInFlight(); setChatError("Cancelled. Nothing was saved."); }}
                  style={{
                    marginLeft: "auto", background: "transparent", border: "1px solid var(--rp-border)",
                    color: "var(--rp-text)", borderRadius: 6, padding: "2px 10px", cursor: "pointer", fontSize: "0.75rem",
                  }}
                >
                  Cancel
                </button>
              </p>
              {elapsed >= 45 && (
                <p style={{ color: "var(--rp-text-muted)", fontSize: "0.75rem", marginTop: 4 }}>
                  Reranking and generation run on CPU here; long answers can take a minute or two.
                </p>
              )}
            </div>
          )}

          {copied && (
            <div style={{ textAlign: "center", padding: "4px 0", color: "var(--rp-green)", fontSize: "0.74rem" }}>
              Copied to clipboard ✓
            </div>
          )}

          <div ref={bottomRef} style={{ height: 20 }} />
        </div>
        </div>

        {/* ── Bottom: PromptInput with inline paper selector ── */}
        <div style={{
          flexShrink: 0,
          padding: "16px 20px 24px",
        }}>
          <div style={{ maxWidth: 860, width: "100%", margin: "0 auto" }}>
          {/* Collection + Paper picker row */}
          <div className="chat-scope">
            <span className="chat-scope-label">Scope</span>
            <select
              className="field-control"
              value={selectedCollectionId}
              onChange={e => { setSelectedCollectionId(e.target.value); setSelectedPaperId(""); }}
              aria-label="Collection"
            >
              {!collections.length && <option value="">No collections</option>}
              {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <select
              className="field-control"
              value={selectedPaperId}
              onChange={e => setSelectedPaperId(e.target.value)}
              aria-label="Paper"
            >
              <option value="">All papers in collection</option>
              {collectionPapers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title.length > 45 ? p.title.slice(0, 45) + "…" : p.title}
                </option>
              ))}
            </select>

            {/* Status badges */}
            <span className="chat-scope-count">
              {readyPapers.length} / {collectionPapers.length} indexed
            </span>
          </div>

          {/* Prompt input */}
          <PromptInput
            ref={inputRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              localStorage.setItem("doclens_last_query", e.target.value);
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            onSubmit={() => sendMessage()}
            isLoading={sending}
            placeholder="Ask about methods, datasets, findings, or citations…"
            hint="Enter to send · Shift+Enter for a new line · answers cite your papers"
          />
        </div>
      </div>
    </div>
  </div>
  );
};

export default ChatPage;
