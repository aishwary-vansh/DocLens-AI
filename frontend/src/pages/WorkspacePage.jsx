// src/pages/WorkspacePage.jsx — Dark aesthetic
import { useState, useEffect, useCallback } from "react";
import { useApp, PAGES } from "../contexts/AppContext";
import { workspacesApi, collectionsApi, ApiError } from "../services/api";

const T = {
  bg: "#080808", bg1: "#0f0f0f", bg2: "#141414",
  accent: "#dedbd2", dim: "rgba(222,219,210,0.65)",
  muted: "rgba(222,219,210,0.38)", faint: "rgba(222,219,210,0.12)",
  border: "rgba(222,219,210,0.08)", borderH: "rgba(222,219,210,0.22)",
};
const mono = { fontFamily: "'DM Mono', monospace" };
const syne = { fontFamily: "'Syne', sans-serif" };

const DarkInput = ({ label, value, onChange, placeholder, as: As = "input", rows }) => {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <label style={{ ...mono, fontSize: "0.52rem", letterSpacing: "0.16em", textTransform: "uppercase", color: T.muted }}>{label}</label>
      <As value={value} rows={rows} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ ...mono, fontSize: "0.72rem", color: T.accent, background: T.bg2,
          border: `1px solid ${focused ? T.borderH : T.border}`, borderRadius: "8px",
          padding: "0.65rem 0.85rem", outline: "none",
          resize: As === "textarea" ? "none" : undefined, transition: "border-color 0.15s" }} />
    </div>
  );
};

const Modal = ({ title, sub, onClose, onSubmit, loading, error, children }) => (
  <div onClick={e => e.target === e.currentTarget && onClose()} style={{
    position: "fixed", inset: 0, zIndex: 200,
    background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
  }}>
    <div style={{ width: "100%", maxWidth: "420px", background: T.bg1,
      border: `1px solid ${T.borderH}`, borderRadius: "16px", padding: "2rem",
      boxShadow: "0 24px 64px rgba(0,0,0,0.7)" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ ...syne, fontSize: "1rem", fontWeight: 700, color: T.accent }}>{title}</div>
        <div style={{ ...mono, fontSize: "0.6rem", color: T.muted, marginTop: "3px" }}>{sub}</div>
      </div>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {children}
        {error && <div style={{ ...mono, fontSize: "0.62rem", color: "#ef4444",
          background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
          padding: "0.55rem 0.8rem", borderRadius: "8px" }}>⚠ {error}</div>}
        <div style={{ display: "flex", gap: "8px", marginTop: "0.4rem" }}>
          <button type="button" onClick={onClose} style={{
            flex: 1, padding: "0.7rem", background: "transparent",
            border: `1px solid ${T.border}`, borderRadius: "10px", cursor: "none",
            ...mono, fontSize: "0.65rem", color: T.muted, letterSpacing: "0.06em" }}>Cancel</button>
          <button type="submit" disabled={loading} style={{
            flex: 2, padding: "0.7rem", background: loading ? T.faint : T.accent,
            color: loading ? T.muted : T.bg, border: "none", borderRadius: "10px", cursor: "none",
            ...mono, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em",
            textTransform: "uppercase", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Creating…" : "Create →"}
          </button>
        </div>
      </form>
    </div>
  </div>
);

const CollectionCard = ({ collection, onOpen, onDelete }) => {
  const [hov, setHov] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => { setHov(false); setConfirm(false); }}
      style={{
        background: hov ? T.bg1 : T.bg, border: `1px solid ${hov ? T.borderH : T.border}`,
        borderRadius: "12px", padding: "1.2rem",
        display: "flex", flexDirection: "column", gap: "0.9rem",
        cursor: "none", transition: "all 0.18s",
        transform: hov ? "translateY(-2px)" : "none",
        boxShadow: hov ? "0 6px 24px rgba(0,0,0,0.5)" : "none",
        position: "relative", overflow: "hidden",
      }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px",
        background: T.accent, opacity: hov ? 0.2 : 0, transition: "opacity 0.2s" }} />

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ width: "34px", height: "34px", borderRadius: "7px",
          border: `1px solid ${T.border}`, background: "rgba(222,219,210,0.04)",
          display: "flex", alignItems: "center", justifyContent: "center", color: T.muted }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        {hov && !confirm && (
          <button onClick={e => { e.stopPropagation(); setConfirm(true); }} style={{
            width: "24px", height: "24px", borderRadius: "6px",
            border: `1px solid ${T.border}`, background: "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: T.muted, cursor: "none", transition: "all 0.12s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)"; e.currentTarget.style.color = "#ef4444"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
          </button>
        )}
      </div>

      {confirm ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ ...mono, fontSize: "0.63rem", color: T.dim }}>Delete this collection?</p>
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={() => setConfirm(false)} style={{ flex: 1, padding: "5px", borderRadius: "6px", border: `1px solid ${T.border}`, background: "transparent", ...mono, fontSize: "0.6rem", color: T.muted, cursor: "none" }}>Cancel</button>
            <button onClick={() => onDelete(collection.id)} style={{ flex: 1, padding: "5px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", ...mono, fontSize: "0.6rem", color: "#ef4444", cursor: "none" }}>Delete</button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <div style={{ ...mono, fontSize: "0.82rem", fontWeight: 600, color: T.accent, lineHeight: 1.3 }}>{collection.name}</div>
            {collection.description && (
              <div style={{ ...mono, fontSize: "0.6rem", color: T.muted, marginTop: "4px", lineHeight: 1.6 }}>{collection.description}</div>
            )}
          </div>
          <div>
            <div style={{ ...mono, fontSize: "0.52rem", textTransform: "uppercase", letterSpacing: "0.08em", color: T.muted, marginBottom: "0.55rem" }}>
              {new Date(collection.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </div>
            <button onClick={() => onOpen(collection)} style={{
              width: "100%", padding: "0.55rem",
              border: `1px solid ${hov ? T.borderH : T.border}`, borderRadius: "7px",
              background: hov ? "rgba(222,219,210,0.05)" : "transparent",
              ...mono, fontSize: "0.62rem", letterSpacing: "0.06em",
              color: hov ? T.accent : T.muted, cursor: "none", transition: "all 0.15s" }}>
              Open Collection →
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const WorkspacePage = () => {
  const { activeWorkspaceId, navigateTo } = useApp();
  const [workspace, setWorkspace]   = useState(null);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [showModal, setShowModal]   = useState(false);
  const [name, setName]             = useState("");
  const [desc, setDesc]             = useState("");
  const [creating, setCreating]     = useState(false);
  const [createErr, setCreateErr]   = useState("");

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const [ws, cols] = await Promise.all([workspacesApi.get(activeWorkspaceId), collectionsApi.list(activeWorkspaceId)]);
      setWorkspace(ws); setCollections(cols);
    } catch { setError("Failed to load workspace."); }
    finally { setLoading(false); }
  }, [activeWorkspaceId]);
  useEffect(() => { load(); }, [load]);

  const handleDelete = async id => {
    try { await collectionsApi.remove(id); setCollections(p => p.filter(c => c.id !== id)); }
    catch { setError("Failed to delete."); }
  };

  const handleCreate = async e => {
    e.preventDefault();
    if (!name.trim()) return setCreateErr("Name required.");
    setCreating(true); setCreateErr("");
    try {
      const col = await collectionsApi.create({ name: name.trim(), description: desc.trim() || undefined, workspaceId: activeWorkspaceId });
      setCollections(p => [col, ...p]); setShowModal(false); setName(""); setDesc("");
    } catch (err) {
      setCreateErr(err instanceof ApiError ? err.message : "Failed to create.");
    } finally { setCreating(false); }
  };

  const breadBtn = { background: "none", border: "none", cursor: "none",
    ...mono, fontSize: "0.62rem", color: T.muted, padding: 0, transition: "color 0.12s" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.8rem" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <button onClick={() => navigateTo(PAGES.DASHBOARD)} style={breadBtn}
          onMouseEnter={e => e.currentTarget.style.color = T.accent}
          onMouseLeave={e => e.currentTarget.style.color = T.muted}>Workspaces</button>
        <span style={{ color: T.muted, fontSize: "0.6rem" }}>›</span>
        <span style={{ ...mono, fontSize: "0.62rem", color: T.accent }}>{workspace?.name ?? "…"}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
        <div>
          <div style={{ ...mono, fontSize: "0.52rem", letterSpacing: "0.2em",
            textTransform: "uppercase", color: T.muted, marginBottom: "0.4rem" }}>
            <span style={{ color: T.accent }}>//</span> Document Collections
          </div>
          <h1 style={{ ...syne, fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.03em", color: T.accent, margin: 0 }}>
            {loading ? "…" : workspace?.name}
          </h1>
          {workspace?.description && <p style={{ ...mono, fontSize: "0.62rem", color: T.muted, marginTop: "5px" }}>{workspace.description}</p>}
        </div>
        <button onClick={() => { setShowModal(true); setCreateErr(""); setName(""); setDesc(""); }} style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "0.55rem 1rem", background: T.accent, color: T.bg,
          border: "none", borderRadius: "8px", cursor: "none",
          ...mono, fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", flexShrink: 0, transition: "opacity 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          New Collection
        </button>
      </div>

      {error && <div style={{ ...mono, fontSize: "0.62rem", color: "#ef4444",
        background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)",
        padding: "0.7rem 1rem", borderRadius: "8px" }}>⚠ {error}</div>}

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
          {[1, 2].map(i => <div key={i} style={{ height: "160px", borderRadius: "12px",
            background: T.bg1, border: `1px solid ${T.border}`,
            animation: "dark-pulse 1.5s ease-in-out infinite" }} />)}
        </div>
      ) : collections.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
          padding: "3.5rem 2rem", textAlign: "center",
          background: T.bg1, border: `1px solid ${T.border}`, borderRadius: "14px" }}>
          <div style={{ width: "46px", height: "46px", borderRadius: "9px",
            border: `1px solid ${T.border}`, background: "rgba(222,219,210,0.04)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: T.muted, marginBottom: "1rem" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ ...syne, fontSize: "0.95rem", fontWeight: 700, color: T.accent, marginBottom: "0.4rem" }}>No collections yet</div>
          <p style={{ ...mono, fontSize: "0.62rem", color: T.muted, lineHeight: 1.7, maxWidth: "280px", marginBottom: "1.2rem" }}>
            Create collections to group papers by topic — e.g. "Transformers", "RAG Systems".
          </p>
          <button onClick={() => setShowModal(true)} style={{
            padding: "0.55rem 1.2rem", background: T.accent, color: T.bg,
            border: "none", borderRadius: "8px", cursor: "none",
            ...mono, fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Create First Collection
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
          {collections.map((col, i) => (
            <CollectionCard key={col.id} collection={col} index={i}
              onOpen={c => navigateTo(PAGES.COLLECTION, activeWorkspaceId, c.id)}
              onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showModal && (
        <Modal title="New Collection" sub="Group related research papers"
          onClose={() => setShowModal(false)} onSubmit={handleCreate}
          loading={creating} error={createErr}>
          <DarkInput label="Collection Name *" value={name} onChange={setName} placeholder="e.g. Transformers" />
          <DarkInput label="Description (optional)" value={desc} onChange={setDesc}
            placeholder="What papers belong here?" as="textarea" rows={3} />
        </Modal>
      )}

      <style>{`@keyframes dark-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  );
};

export default WorkspacePage;
