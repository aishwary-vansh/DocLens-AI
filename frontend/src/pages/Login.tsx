// src/pages/Login.tsx
// Minimal, centered dark login — clean card, no copy-paste from landing.
import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import BgCanvas from './landing/BgCanvas';

type Mode = 'login' | 'register';

const T = {
  bg:      '#080808',
  bg1:     '#0f0f0f',
  bg2:     '#141414',
  accent:  '#dedbd2',
  dim:     'rgba(222,219,210,0.65)',
  muted:   'rgba(222,219,210,0.38)',
  faint:   'rgba(222,219,210,0.12)',
  border:  'rgba(222,219,210,0.08)',
  borderH: 'rgba(222,219,210,0.24)',
};

const mono: React.CSSProperties = { fontFamily: "'DM Mono', monospace" };
const syne: React.CSSProperties = { fontFamily: "'Syne', sans-serif" };

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
    <div style={{
      position: 'fixed', inset: 0,
      background: T.bg, color: T.accent,
      fontFamily: "'DM Mono', monospace",
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'none', overflow: 'hidden',
    }}>
      <BgCanvas />

      {/* ── Card ── */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: '420px',
        margin: '0 1.5rem',
        background: T.bg1,
        border: `1px solid ${T.borderH}`,
        borderRadius: '20px',
        padding: '2.8rem 2.5rem',
        boxShadow: '0 0 60px rgba(222,219,210,0.04), 0 24px 64px rgba(0,0,0,0.6)',
      }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '2.2rem' }}>
          <div style={{
            width: '28px', height: '28px',
            border: `1.5px solid ${T.dim}`, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <div style={{ width: '9px', height: '9px', border: `1.5px solid ${T.accent}`, borderRadius: '50%' }} />
          </div>
          <span style={{ ...syne, fontWeight: 700, fontSize: '1rem',
            letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            DocLens
          </span>
        </div>

        {/* Title */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ ...mono, fontSize: '0.58rem', letterSpacing: '0.18em',
            textTransform: 'uppercase', color: T.muted, marginBottom: '0.5rem' }}>
            {mode === 'login' ? '// Sign in to continue' : '// Create your account'}
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: '4px', background: T.bg, borderRadius: '10px',
          padding: '4px', marginBottom: '1.8rem', border: `1px solid ${T.border}` }}>
          {(['login', 'register'] as Mode[]).map(m => (
            <button key={m} onClick={() => { setMode(m); reset(); }} style={{
              flex: 1, padding: '0.5rem',
              background: mode === m ? T.bg1 : 'transparent',
              border: `1px solid ${mode === m ? T.borderH : 'transparent'}`,
              borderRadius: '8px',
              ...mono, fontSize: '0.58rem', fontWeight: 600,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: mode === m ? T.accent : T.muted,
              cursor: 'none', transition: 'all 0.15s',
            }}>
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {mode === 'register' && (
            <Field label="Full Name" type="text" value={name}
              onChange={v => { setName(v); reset(); }} placeholder="Your name" />
          )}

          <Field label="Email" type="email" value={email}
            onChange={v => { setEmail(v); reset(); }} placeholder="you@research.ai" />

          <Field label="Password" type="password" value={pass}
            onChange={v => { setPass(v); reset(); }} placeholder="••••••••" />

          {(local || error) && (
            <div style={{
              ...mono, fontSize: '0.6rem', color: '#ef4444',
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.18)',
              padding: '0.55rem 0.75rem', letterSpacing: '0.03em',
            }}>
              ⚠ {local || error}
            </div>
          )}

          <button type="submit" disabled={busy} style={{
            marginTop: '0.4rem',
            background: busy ? T.faint : T.accent,
            color: busy ? T.muted : T.bg,
            ...mono, fontSize: '0.68rem', fontWeight: 600,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '0.82rem',
            border: `1px solid ${T.border}`,
            borderRadius: '10px',
            cursor: 'none',
            transition: 'opacity 0.18s, transform 0.18s',
          }}
            onMouseEnter={e => { if (!busy) { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = ''; }}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign In →' : 'Create Account →'}
          </button>
        </form>

        {/* Demo hint */}
        <div style={{
          marginTop: '1.6rem',
          padding: '0.9rem 1rem',
          background: T.bg,
          border: `1px solid ${T.border}`,
          borderRadius: '10px',
        }}>
          <div style={{ ...mono, fontSize: '0.5rem', letterSpacing: '0.16em',
            textTransform: 'uppercase', color: T.muted, marginBottom: '0.45rem', fontWeight: 600 }}>
            // Demo credentials
          </div>
          <div style={{ ...mono, fontSize: '0.6rem', color: T.muted }}>
            <span style={{ color: T.accent }}>admin@doclens.ai</span> / Admin@1234
          </div>
        </div>
      </div>

      {/* Bottom label */}
      <div style={{
        position: 'fixed', bottom: '1.5rem', left: 0, right: 0,
        textAlign: 'center', zIndex: 1,
        ...mono, fontSize: '0.52rem', color: T.muted,
        letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.4,
      }}>
        © Aishwary Vansh 2026 · Phase 1 · Foundation
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.38rem' }}>
      <label style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '0.52rem', letterSpacing: '0.16em',
        textTransform: 'uppercase', color: 'rgba(222,219,210,0.38)',
      }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '0.72rem', letterSpacing: '0.04em',
          padding: '0.68rem 0.85rem',
          background: '#141414',
          border: `1px solid ${focused ? 'rgba(222,219,210,0.24)' : 'rgba(222,219,210,0.08)'}`,
          borderRadius: '8px',
          color: '#dedbd2', outline: 'none',
          transition: 'border-color 0.15s',
        }}
      />
    </div>
  );
};

export default Login;
