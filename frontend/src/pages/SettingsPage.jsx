import { useState } from "react";
import { authApi } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { useSocket } from "../contexts/SocketContext";
import { ActionButton, ErrorNotice, PageHeader, Panel } from "../components/research/ResearchComponents";
import Icon from "../components/research/Icons";

const SERVICES = [
  { label: "Document Ingestion",   detail: "PDF upload, text extraction, chunking pipeline", status: "online"  },
  { label: "Semantic Search",      detail: "FAISS vector retrieval + question answering",     status: "pending" },
  { label: "Citation Grounding",   detail: "Source references in research chat answers",      status: "online"  },
  { label: "Real-Time Processing", detail: "WebSocket-based pipeline status updates",         status: "online"  },
  { label: "AI Query Service",     detail: "FastAPI + HuggingFace embedding models",          status: "offline" },
];

const TECH_STACK = [
  { layer: "Frontend",          items: ["React", "Vite", "TailwindCSS"] },
  { layer: "Backend API",       items: ["NestJS", "Prisma", "PostgreSQL"] },
  { layer: "AI / Retrieval",    items: ["FastAPI", "FAISS", "Sentence-Transformers"] },
  { layer: "Real-Time",         items: ["Socket.io", "WebSockets"] },
];

const SettingsPage = () => {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const [name, setName]                   = useState(user?.name || "");
  const [password, setPassword]           = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving]               = useState(false);
  const [message, setMessage]             = useState("");
  const [error, setError]                 = useState("");

  const saveProfile = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password && password !== confirmPassword) { setError("Passwords do not match."); return; }
    setSaving(true);
    try {
      const payload = {};
      if (name.trim() && name.trim() !== user?.name) payload.name = name.trim();
      if (password) payload.password = password;
      if (!Object.keys(payload).length) { setMessage("No profile changes to save."); return; }
      await authApi.updateProfile(payload);
      setMessage("Research profile updated.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err?.message || "Unable to update profile.");
    } finally {
      setSaving(false);
    }
  };

  const clearQueryHistory = () => {
    localStorage.removeItem("doclens_query_history");
    localStorage.removeItem("doclens_query_count");
    localStorage.removeItem("doclens_last_query");
    setMessage("Query history cleared.");
  };

  return (
    <>
      <PageHeader
        eyebrow="Research Workspace Settings"
        title="Configure the DocLens research environment."
        description="Manage your profile, inspect platform service health, and review the tech stack powering semantic search and document intelligence."
      />

      <ErrorNotice message={error} />
      {message && (
        <div className="error-notice" style={{ borderColor: "rgba(125,223,149,0.3)", color: "var(--rp-green)", background: "rgba(125,223,149,0.08)", marginBottom: 14 }}>
          <Icon name="spark" size={15} /> {message}
        </div>
      )}

      <div className="settings-grid">
        {/* Left: Profile form */}
        <Panel title="Research Profile" eyebrow="Account">
          <form className="settings-form" onSubmit={saveProfile}>
            <div className="form-row">
              <label>Email</label>
              <input className="field-control" value={user?.email || ""} disabled />
            </div>
            <div className="form-row">
              <label>Role</label>
              <input className="field-control" value={user?.role || "researcher"} disabled />
            </div>
            <div className="form-row">
              <label>Display Name</label>
              <input
                className="field-control"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Researcher name"
              />
            </div>
            <div className="form-row">
              <label>New Password</label>
              <input className="field-control" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank to keep current" />
            </div>
            <div className="form-row">
              <label>Confirm Password</label>
              <input className="field-control" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat new password" />
            </div>
            <ActionButton icon="settings" type="submit" disabled={saving}>{saving ? "Saving…" : "Save Profile"}</ActionButton>
          </form>

          {/* Data management */}
          <div className="settings-section-label"><Icon name="clock" size={13} /> Data Management</div>
          <div style={{ padding: "14px 20px", display: "grid", gap: 10 }}>
            <p style={{ margin: 0, color: "var(--rp-text-muted)", fontSize: "0.84rem", lineHeight: 1.6 }}>
              Clear your local query history and session data. This does not affect uploaded papers or collections.
            </p>
            <ActionButton icon="filter" variant="ghost" onClick={clearQueryHistory}>Clear Query History</ActionButton>
          </div>
        </Panel>

        {/* Right column */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* Platform status */}
          <Panel title="Platform Status" eyebrow="Service Health">
            {SERVICES.map(svc => {
              const isSocket = svc.label === "Real-Time Processing";
              const live = isSocket ? socket?.connected : svc.status === "online";
              const cls  = svc.status === "offline" ? "offline" : svc.status === "pending" ? "pending" : "";
              return (
                <div className="platform-status-row" key={svc.label}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>{svc.label}</div>
                    <div style={{ color: "var(--rp-text-muted)", fontSize: "0.74rem", marginTop: 2 }}>{svc.detail}</div>
                  </div>
                  <span className={`status-indicator ${!live && svc.status !== "pending" ? "offline" : svc.status === "pending" ? "pending" : ""}`}>
                    <i />
                    {isSocket ? (socket?.connected ? "Online" : "Offline") : svc.status === "online" ? "Online" : svc.status === "pending" ? "Setup needed" : "Offline"}
                  </span>
                </div>
              );
            })}
          </Panel>

          {/* Tech stack */}
          <Panel title="Technology Stack" eyebrow="Architecture">
            <div style={{ padding: "10px 20px" }}>
              {TECH_STACK.map(row => (
                <div key={row.layer} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--rp-border)" }}>
                  <span style={{ color: "var(--rp-text-muted)", fontFamily: "var(--rp-mono)", fontSize: "0.68rem", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
                    {row.layer}
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {row.items.map(item => (
                      <span key={item} style={{ padding: "3px 8px", border: "1px solid var(--rp-border)", borderRadius: 4, fontSize: "0.72rem", color: "var(--rp-text-soft)", background: "rgba(255,255,255,0.03)" }}>
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* Session */}
          <Panel title="Session" eyebrow="Security">
            <div className="panel-padding">
              <p style={{ margin: "0 0 14px", color: "var(--rp-text-muted)", lineHeight: 1.6, fontSize: "0.86rem" }}>
                Signed in as <strong style={{ color: "var(--rp-text)" }}>{user?.email}</strong>. Sign out to clear your local DocLens session token.
              </p>
              <ActionButton icon="arrowRight" variant="ghost" onClick={logout}>Sign Out</ActionButton>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
};

export default SettingsPage;
