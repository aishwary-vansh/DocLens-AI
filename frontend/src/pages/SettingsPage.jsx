import { useState } from "react";
import { authApi } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { useSocket } from "../contexts/SocketContext";
import { ActionButton, ErrorNotice, PageHeader, Panel } from "../components/research/ResearchComponents";
import Icon from "../components/research/Icons";
import useServiceHealth from "../hooks/useServiceHealth";
import useTheme from "../hooks/useTheme";

// Live checks: `source` picks which probe drives the row (see useServiceHealth / SocketContext).
const SERVICES = [
  { label: "Application API",      detail: "Accounts, collections, uploads, chat history", source: "api" },
  { label: "AI Research Service",  detail: "Parsing, hybrid retrieval, reranking, answers",  source: "pipeline" },
  { label: "Real-Time Processing", detail: "Live document status updates (WebSocket)",      source: "socket" },
];


const SettingsPage = () => {
  const { user, logout, updateUser } = useAuth();
  const socket = useSocket();
  const { apiOk, pipelineOk } = useServiceHealth();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const [name, setName]                   = useState(user?.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword]           = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving]               = useState(false);
  const [message, setMessage]             = useState("");
  const [error, setError]                 = useState("");

  // false only for accounts created with Google that never set a password.
  const hasPassword = user?.hasPassword !== false;

  const saveProfile = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password && password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (password && password.length < 6) { setError("Use at least 6 characters for the new password."); return; }
    if (password && hasPassword && !currentPassword) { setError("Enter your current password to set a new one."); return; }
    setSaving(true);
    try {
      const payload = {};
      if (name.trim() && name.trim() !== user?.name) payload.name = name.trim();
      if (password) { payload.password = password; if (hasPassword) payload.currentPassword = currentPassword; }
      if (!Object.keys(payload).length) { setMessage("No profile changes to save."); return; }
      const updated = await authApi.updateProfile(payload);
      updateUser(updated);
      setMessage(password ? "Profile and password updated." : "Profile updated.");
      setCurrentPassword("");
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
        eyebrow="Account"
        title="Settings"
        description="Profile, appearance, service status and session."
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
              <label htmlFor="settings-email">Email</label>
              <input id="settings-email" className="field-control" value={user?.email || ""} disabled />
            </div>
            <div className="form-row">
              <label htmlFor="settings-name">Display name</label>
              <input
                id="settings-name"
                className="field-control"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Researcher name"
              />
            </div>
            <div className="settings-subhead">
              <strong>{hasPassword ? "Change password" : "Set a password"}</strong>
              <span>{hasPassword
                ? "Leave these blank to keep your current password."
                : "You sign in with Google. Add a password to also sign in with your email."}</span>
            </div>
            {hasPassword && (
              <div className="form-row">
                <label htmlFor="settings-current-password">Current password</label>
                <input id="settings-current-password" className="field-control" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
              </div>
            )}
            <div className="form-row">
              <label htmlFor="settings-new-password">New password</label>
              <input id="settings-new-password" className="field-control" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </div>
            <div className="form-row">
              <label htmlFor="settings-confirm-password">Confirm new password</label>
              <input id="settings-confirm-password" className="field-control" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            </div>
            <ActionButton icon={null} type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</ActionButton>
          </form>

          {/* Data management */}
          <div className="settings-block">
            <div className="settings-subhead">
              <strong>Local history</strong>
              <span>Clears the query history kept in this browser. Papers, collections and saved chats are not affected.</span>
            </div>
            <ActionButton icon={null} variant="ghost" onClick={clearQueryHistory}>Clear query history</ActionButton>
          </div>
        </Panel>

        {/* Right column */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* Appearance */}
          <Panel title="Appearance" eyebrow="Theme">
            <div className="panel-padding" style={{ display: "grid", gap: 10 }}>
              <div className="theme-choice" role="radiogroup" aria-label="Colour theme">
                {[["dark", "Dark"], ["light", "Light"], ["system", "System"]].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={themePreference === value}
                    className={themePreference === value ? "active" : ""}
                    onClick={() => setThemePreference(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p style={{ margin: 0, color: "var(--rp-text-muted)", fontSize: "0.8rem" }}>
                Saved in this browser. "System" follows your operating system setting.
              </p>
            </div>
          </Panel>

          {/* Platform status */}
          <Panel title="Platform Status" eyebrow="Service Health">
            {SERVICES.map(svc => {
              const live = svc.source === "api" ? apiOk : svc.source === "pipeline" ? pipelineOk : Boolean(socket?.connected);
              const state = live === null ? "pending" : live ? "" : "offline";
              return (
                <div className="platform-status-row" key={svc.label}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>{svc.label}</div>
                    <div style={{ color: "var(--rp-text-muted)", fontSize: "0.74rem", marginTop: 2 }}>{svc.detail}</div>
                  </div>
                  <span className={`status-indicator ${state}`}>
                    <i />
                    {live === null ? "Checking…" : live ? "Online" : "Unreachable"}
                  </span>
                </div>
              );
            })}
          </Panel>

          {/* Session */}
          <Panel title="Session" eyebrow="Security">
            <div className="panel-padding">
              <p style={{ margin: "0 0 14px", color: "var(--rp-text-muted)", lineHeight: 1.6, fontSize: "0.86rem" }}>
                Signed in as <strong style={{ color: "var(--rp-text)" }}>{user?.email}</strong>. Sign out to clear your local DocLens session token.
              </p>
              <ActionButton icon={null} variant="ghost" onClick={logout}>Sign out</ActionButton>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
};

export default SettingsPage;
