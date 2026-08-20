// src/pages/Login.tsx
import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import BgCanvas from './landing/BgCanvas';
import logoUrl from '@/assets/logo.png';

type Mode = 'login' | 'register';

const Login = () => {
  const { login, register, error, clearError } = useAuth();
  const [mode, setMode]   = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [name,  setName]  = useState('');
  const [busy,  setBusy]  = useState(false);
  const [local, setLocal] = useState('');

  const reset = () => { clearError(); setLocal(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !pass) return setLocal('Email and password required.');
    if (mode === 'register' && !name) return setLocal('Name required.');
    setBusy(true);
    try {
      if (mode === 'login') await login(email, pass);
      else                  await register(email, pass, name);
    } catch { /* errors surfaced via context */ }
    finally { setBusy(false); }
  };

  return (
    <div className="login-root">
      <BgCanvas />

      {/* ── Ambient glow orbs ── */}
      <div className="login-orb login-orb-1" />
      <div className="login-orb login-orb-2" />

      {/* ── Card ── */}
      <div className="login-card">

        {/* Brand */}
        <div className="login-brand">
          <img src={logoUrl} alt="DocLens Logo" style={{ width: 80, height: "auto", objectFit: "contain", flexShrink: 0, borderRadius: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="login-logo-text">DocLens</span>
            <span className="login-logo-badge" style={{ alignSelf: 'flex-start' }}>AI</span>
          </div>
        </div>

        {/* Headline */}
        <div className="login-headline">
          <h1 className="login-title">
            {mode === 'login' ? 'Welcome back' : 'Get started'}
          </h1>
          <p className="login-subtitle">
            {mode === 'login'
              ? 'Sign in to your research workspace'
              : 'Create your research workspace'}
          </p>
        </div>

        {/* Mode tabs */}
        <div className="login-tabs">
          {(['login', 'register'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); reset(); }}
              className={`login-tab${mode === m ? ' active' : ''}`}
            >
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={submit} className="login-form">
          {mode === 'register' && (
            <Field label="Full Name" type="text" value={name}
              onChange={v => { setName(v); reset(); }} placeholder="Your name" />
          )}
          <Field label="Email" type="email" value={email}
            onChange={v => { setEmail(v); reset(); }} placeholder="you@research.ai" />
          <Field label="Password" type="password" value={pass}
            onChange={v => { setPass(v); reset(); }} placeholder="••••••••" />

          {(local || error) && (
            <div className="login-error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {local || error}
            </div>
          )}

          <button type="submit" disabled={busy} className={`login-submit${busy ? ' busy' : ''}`}>
            {busy ? (
              <>
                <span className="login-spinner" />
                Please wait…
              </>
            ) : (
              <>
                {mode === 'login' ? 'Sign In' : 'Create Account'}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </>
            )}
          </button>
        </form>

        {/* Demo hint */}
        <div className="login-demo">
          <div className="login-demo-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
            </svg>
            Demo Access
          </div>
          <div className="login-demo-creds">
            <span className="login-demo-email">admin@doclens.ai</span>
            <span className="login-demo-sep">/</span>
            <span>Admin@1234</span>
          </div>
        </div>
      </div>

      {/* Bottom label */}
      <div className="login-footer">
        © Aishwary Vansh 2026 · DocLens AI · Research Intelligence Platform
      </div>

      <style>{`
        .login-root {
          position: fixed; inset: 0;
          background: #050507;
          color: #eafaf1;
          font-family: 'Inter', sans-serif;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
        }

        .login-orb {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          filter: blur(120px);
        }
        .login-orb-1 {
          width: 500px; height: 500px;
          top: -100px; left: -100px;
          background: radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%);
        }
        .login-orb-2 {
          width: 400px; height: 400px;
          bottom: -80px; right: -80px;
          background: radial-gradient(circle, rgba(16,185,129,0.10) 0%, transparent 70%);
        }

        .login-card {
          position: relative; z-index: 1;
          width: 100%; max-width: 440px;
          margin: 0 1.5rem;
          background: rgba(9, 9, 15, 0.85);
          border: 1px solid rgba(16, 185, 129, 0.18);
          border-radius: 20px;
          padding: 2.8rem 2.5rem;
          box-shadow:
            0 0 0 1px rgba(6,182,212,0.06),
            0 32px 80px rgba(0,0,0,0.7),
            inset 0 1px 0 rgba(255,255,255,0.04);
          backdrop-filter: blur(24px);
        }

        /* Brand */
        .login-brand {
          display: flex; align-items: center; gap: 0.65rem;
          margin-bottom: 2rem;
        }
        .login-logo-mark {
          width: 30px; height: 30px;
          border: 1.5px solid rgba(6,182,212,0.5);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: rgba(6,182,212,0.06);
          flex-shrink: 0;
        }
        .login-logo-inner {
          width: 10px; height: 10px;
          border: 1.5px solid #06b6d4;
          border-radius: 50%;
          background: rgba(6,182,212,0.25);
        }
        .login-logo-text {
          font-family: 'Outfit', sans-serif;
          font-weight: 800; font-size: 1rem;
          letter-spacing: 0.14em; text-transform: uppercase;
          background: linear-gradient(135deg, #cffafe, #34d399);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .login-logo-badge {
          font-family: 'Inter', sans-serif;
          font-size: 0.52rem; font-weight: 700;
          letter-spacing: 0.12em; text-transform: uppercase;
          color: #06b6d4;
          border: 1px solid rgba(6,182,212,0.35);
          background: rgba(6,182,212,0.08);
          padding: 0.18rem 0.45rem;
          border-radius: 4px;
        }

        /* Headline */
        .login-headline { margin-bottom: 1.8rem; }
        .login-title {
          font-family: 'Outfit', sans-serif;
          font-weight: 800; font-size: 1.75rem;
          letter-spacing: -0.03em; line-height: 1.1;
          background: linear-gradient(135deg, #cffafe 0%, #34d399 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin: 0 0 0.4rem;
        }
        .login-subtitle {
          font-size: 0.8rem; line-height: 1.6;
          color: rgba(234,250,241,0.48);
          margin: 0;
          font-family: 'Inter', sans-serif;
        }

        /* Tabs */
        .login-tabs {
          display: flex; gap: 4px;
          background: rgba(0,0,0,0.35);
          border: 1px solid rgba(16,185,129,0.12);
          border-radius: 10px; padding: 4px;
          margin-bottom: 1.6rem;
        }
        .login-tab {
          flex: 1; padding: 0.52rem;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 7px;
          font-family: 'Inter', sans-serif;
          font-size: 0.72rem; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase;
          color: rgba(234,250,241,0.38);
          cursor: pointer;
          transition: all 0.18s ease;
        }
        .login-tab.active {
          background: rgba(6,182,212,0.10);
          border-color: rgba(6,182,212,0.28);
          color: #cffafe;
        }
        .login-tab:hover:not(.active) {
          color: rgba(234,250,241,0.65);
          background: rgba(255,255,255,0.04);
        }

        /* Form */
        .login-form {
          display: flex; flex-direction: column; gap: 1rem;
        }
        .login-field {
          display: flex; flex-direction: column; gap: 0.4rem;
        }
        .login-label {
          font-family: 'Inter', sans-serif;
          font-size: 0.62rem; letter-spacing: 0.14em;
          text-transform: uppercase; font-weight: 600;
          color: rgba(234,250,241,0.42);
        }
        .login-input {
          font-family: 'Inter', sans-serif;
          font-size: 0.875rem; letter-spacing: 0.01em;
          padding: 0.72rem 0.9rem;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(16,185,129,0.15);
          border-radius: 9px;
          color: #eafaf1;
          outline: none;
          transition: border-color 0.18s, background 0.18s, box-shadow 0.18s;
          width: 100%;
        }
        .login-input::placeholder {
          color: rgba(234,250,241,0.22);
        }
        .login-input:focus {
          border-color: rgba(6,182,212,0.45);
          background: rgba(6,182,212,0.04);
          box-shadow: 0 0 0 3px rgba(6,182,212,0.08);
        }

        /* Error */
        .login-error {
          display: flex; align-items: center; gap: 0.5rem;
          font-family: 'Inter', sans-serif;
          font-size: 0.75rem; color: #f87171;
          background: rgba(239,68,68,0.06);
          border: 1px solid rgba(239,68,68,0.18);
          border-radius: 8px;
          padding: 0.6rem 0.85rem;
          line-height: 1.5;
        }

        /* Submit */
        .login-submit {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          margin-top: 0.3rem;
          padding: 0.82rem;
          background: linear-gradient(135deg, #06b6d4, #10b981);
          color: #fff;
          font-family: 'Inter', sans-serif;
          font-size: 0.82rem; font-weight: 700;
          letter-spacing: 0.04em;
          border: none; border-radius: 10px;
          cursor: pointer;
          transition: opacity 0.18s, transform 0.18s, box-shadow 0.18s;
          box-shadow: 0 4px 20px rgba(6,182,212,0.30);
          width: 100%;
        }
        .login-submit:hover:not(.busy) {
          opacity: 0.9;
          transform: translateY(-1px);
          box-shadow: 0 8px 32px rgba(6,182,212,0.45);
        }
        .login-submit.busy {
          background: rgba(255,255,255,0.08);
          color: rgba(234,250,241,0.45);
          box-shadow: none;
          cursor: not-allowed;
        }
        .login-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(234,250,241,0.2);
          border-top-color: rgba(234,250,241,0.7);
          border-radius: 50%;
          animation: login-spin 0.7s linear infinite;
          flex-shrink: 0;
        }
        @keyframes login-spin { to { transform: rotate(360deg); } }

        /* Demo hint */
        .login-demo {
          margin-top: 1.4rem;
          padding: 0.85rem 1rem;
          background: rgba(6,182,212,0.04);
          border: 1px solid rgba(6,182,212,0.14);
          border-radius: 10px;
        }
        .login-demo-label {
          display: flex; align-items: center; gap: 0.4rem;
          font-family: 'Inter', sans-serif;
          font-size: 0.6rem; letter-spacing: 0.14em;
          text-transform: uppercase; font-weight: 700;
          color: rgba(6,182,212,0.7);
          margin-bottom: 0.45rem;
        }
        .login-demo-creds {
          display: flex; align-items: center; gap: 0.5rem;
          font-family: 'DM Mono', 'Courier New', monospace;
          font-size: 0.72rem;
          color: rgba(234,250,241,0.42);
        }
        .login-demo-email { color: #34d399; }
        .login-demo-sep { color: rgba(234,250,241,0.2); }

        /* Footer */
        .login-footer {
          position: fixed; bottom: 1.5rem; left: 0; right: 0;
          text-align: center; z-index: 1;
          font-family: 'Inter', sans-serif;
          font-size: 0.6rem; letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(234,250,241,0.22);
        }
      `}</style>
    </div>
  );
};

/* ── Reusable field ── */
const Field = ({ label, type, value, onChange, placeholder }: {
  label: string; type: string;
  value: string; onChange: (v: string) => void; placeholder: string;
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <div className="login-field">
      <label className="login-label">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`login-input${focused ? ' focused' : ''}`}
      />
    </div>
  );
};

export default Login;
