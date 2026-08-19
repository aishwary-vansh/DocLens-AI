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

// ── Citation chip ──────────────────────────────────────────────────────
function CitationChip({ citation, index, onClick }) {
  return (
    <button
      className="citation-chip"
      onClick={() => onClick(citation)}
      type="button"
      title={citation.documentTitle}
    >
      <span className="citation-chip-num">{index + 1}</span>
      {citation.documentTitle?.length > 28
        ? citation.documentTitle.slice(0, 28) + "…"
        : citation.documentTitle}
      {citation.score && (
        <span style={{ opacity: 0.6 }}>· {Math.round(citation.score * 100)}%</span>
      )}
    </button>
  );
}

// ── Single message bubble ──────────────────────────────────────────────
function Message({ message, onCitationClick, onCopy }) {
  return (
    <div className={`message ${message.role}`}>
      <span>{message.role === "user" ? "You" : "DocLens AI"}</span>
      <p>{message.content}</p>
      {!!message.citations?.length && (
        <div className="citation-strip">
          {message.citations.map((c, i) => (
            <CitationChip
              key={`${c.documentTitle}-${i}`}
              citation={c}
              index={i}
              onClick={onCitationClick}
            />
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
        border: `1px solid ${isActive ? "rgba(6,182,212,0.35)" : "rgba(255,255,255,0.05)"}`,
        background: isActive ? "rgba(6,182,212,0.07)" : "rgba(255,255,255,0.02)",
        cursor: "pointer",
        transition: "all 0.18s",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
      onMouseEnter={e => {
        if (!isActive) {
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.background = "rgba(255,255,255,0.02)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
        }
      }}
    >
      <span style={{
        fontSize: "0.78rem",
        color: isActive ? "var(--rp-cyan)" : "var(--rp-text)",
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
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
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

  const sendMessage = async (question = input) => {
    const trimmed = question.trim();
    if (!trimmed || sending) return;
    localStorage.setItem("doclens_last_query", "");
    setInput("");
    persistHistory(trimmed);
    setActiveCitation(null);
    setCitationPanel(null);
    setChatError("");
    setMessages(prev => [...prev, { role: "user", content: trimmed, citations: [] }]);
    setSending(true);

    try {
      if (!selectedCollectionId)
        throw new Error("Create a collection and upload papers before asking grounded questions.");
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
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: response.content, citations: response.citations || [] },
      ]);
    } catch (err) {
      setChatError(err?.message || "The research query could not be completed.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleCopy = text => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const clearSession = () => {
    setMessages([{ role: "assistant", content: "Session cleared. Ask a new research question.", citations: [] }]);
    setActiveCitation(null);
    setCitationPanel(null);
    setSessionId("");
    setChatError("");
  };

  const loadSession = async id => {
    setChatError("");
    try {
      const session = await queryApi.session(id);
      setSessionId(id);
      setMessages(session.messages || []);
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
      <aside className="chat-inspector-panel" style={{
        width: inspectorOpen ? 320 : 0,
        minWidth: inspectorOpen ? 320 : 0,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--rp-border)",
        background: "rgba(10,12,18,0.98)",
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
          <span style={{ fontSize: "0.72rem", fontFamily: "var(--rp-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--rp-text-muted)" }}>
            History
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={clearSession}
              style={{ fontSize: "0.65rem", color: "var(--rp-text-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--rp-mono)" }}
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
                borderBottom: `2px solid ${activeHistoryTab === tab ? "var(--rp-cyan)" : "transparent"}`,
                background: "none",
                color: activeHistoryTab === tab ? "var(--rp-cyan)" : "var(--rp-text-muted)",
                fontSize: "0.65rem",
                fontFamily: "var(--rp-mono)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
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
            <div style={{ fontSize: "0.6rem", fontFamily: "var(--rp-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--rp-cyan)", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
                style={{ marginTop: 8, padding: "5px 10px", border: "1px solid var(--rp-border)", borderRadius: 5, background: "rgba(6,182,212,0.08)", color: "var(--rp-cyan)", cursor: "pointer", fontSize: "0.7rem", width: "100%" }}
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
              background: historyOpen ? "rgba(6,182,212,0.08)" : "transparent",
              color: historyOpen ? "var(--rp-cyan)" : "var(--rp-text-muted)",
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
            <div style={{ maxWidth: 560, margin: "0 auto 24px", width: "100%" }}>
              <p style={{ fontSize: "0.7rem", fontFamily: "var(--rp-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--rp-text-muted)", marginBottom: 12 }}>
                Suggested questions
              </p>
              <div className="chat-suggestion-grid">
                {[
                  "What is the main contribution?",
                  "What methodology was used?",
                  "What datasets were evaluated on?",
                  "What are the key limitations?",
                  "What future work is suggested?",
                  "How does this compare to prior work?",
                ].map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    style={{
                      textAlign: "left", padding: "10px 14px",
                      background: "rgba(255,255,255,0.025)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 8, color: "var(--rp-text-soft)",
                      fontSize: "0.78rem", cursor: "pointer",
                      transition: "all 0.18s", lineHeight: 1.4,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(6,182,212,0.07)"; e.currentTarget.style.borderColor = "rgba(6,182,212,0.25)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <Message key={i} message={m} onCitationClick={handleCitationClick} onCopy={handleCopy} />
          ))}

          {sending && (
            <div className="message">
              <span>DocLens AI</span>
              <p style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  display: "inline-block", width: 14, height: 14,
                  border: "2px solid var(--rp-border)",
                  borderTopColor: "var(--rp-cyan)",
                  borderRadius: "50%",
                  animation: "rp-spin 0.7s linear infinite",
                  flexShrink: 0,
                }} />
                Reading source chunks and preparing a citation-aware response…
              </p>
            </div>
          )}

          {copied && (
            <div style={{ textAlign: "center", padding: "4px 0", color: "var(--rp-green)", fontFamily: "var(--rp-mono)", fontSize: "0.68rem" }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.6rem", fontFamily: "var(--rp-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--rp-text-muted)", flexShrink: 0 }}>
              Scope:
            </span>
            <select
              className="field-control"
              value={selectedCollectionId}
              onChange={e => { setSelectedCollectionId(e.target.value); setSelectedPaperId(""); }}
              style={{ padding: "5px 10px", fontSize: "0.75rem", height: "auto", flex: "0 1 200px", minWidth: 120 }}
            >
              {!collections.length && <option value="">No collections</option>}
              {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <select
              className="field-control"
              value={selectedPaperId}
              onChange={e => setSelectedPaperId(e.target.value)}
              style={{ padding: "5px 10px", fontSize: "0.75rem", height: "auto", flex: "0 1 260px", minWidth: 120 }}
            >
              <option value="">All papers in collection</option>
              {collectionPapers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title.length > 45 ? p.title.slice(0, 45) + "…" : p.title}
                </option>
              ))}
            </select>

            {/* Status badges */}
            <span style={{ fontSize: "0.65rem", color: "var(--rp-text-muted)", flexShrink: 0 }}>
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
            placeholder="Ask about methods, datasets, findings, or citations… (Enter to send, Shift+Enter for newline)"
            credits={undefined}
            onUpgrade={() => {}}
          />
        </div>
      </div>
    </div>
  </div>
  );
};

export default ChatPage;
