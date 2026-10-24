// src/pages/Login.tsx
// Split-screen sign-in: product story on the left, auth card on the right.
// Google sign-in (Google Identity Services) plus email/password, with inline
// validation, password visibility, strength meter and animated mode switch.
import { useCallback, useEffect, useMemo, useState, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import {
  AlertCircle, ArrowLeft, ArrowRight, BookOpen, Eye, EyeOff, FileSearch, GitCompare,
  Lightbulb, Loader2, Lock, Mail, Quote, ShieldCheck, User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import useGoogleSignIn from '../hooks/useGoogleSignIn';
import BgCanvas from './landing/BgCanvas';
import logoUrl from '@/assets/logo.png';
import '../styles/auth.css';

type Mode = 'login' | 'register';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FEATURES = [
  { icon: FileSearch, title: 'Answers with receipts', text: 'Every sentence links to the exact passage and page it came from.' },
  { icon: GitCompare, title: 'Cross-paper synthesis', text: 'Compare methods, datasets and results without mixing up studies.' },
  { icon: Lightbulb, title: 'Defensible research gaps', text: 'Gaps are marked as stated by authors or inferred — never blurred.' },
];

const SAMPLE_QUESTIONS = [
  { q: 'Which papers report results on WMT 2014, and how do they differ?', a: 'The Transformer reaches 28.4 BLEU on EN–DE', cite: 'Vaswani et al., p. 8' },
  { q: 'What limitations do the authors themselves state?', a: 'Detection relied on a single wearable cohort', cite: 'Mishra et al., p. 11' },
  { q: 'Where do BERT and GPT-3 disagree on fine-tuning?', a: 'GPT-3 is evaluated without gradient updates', cite: 'Brown et al., p. 5' },
];

function passwordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const level = Math.min(4, score);
  return { level, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][level] };
}

type LoginProps = {
  /** Driven by the route (#/login or #/register). */
  mode?: Mode;
  onModeChange?: (mode: Mode) => void;
  onBack?: () => void;
};

const Login = ({ mode: routeMode = 'login', onModeChange, onBack }: LoginProps) => {
  const { login, register, loginWithGoogle, error, clearError } = useAuth();
  const [mode, setMode] = useState<Mode>(routeMode);
  useEffect(() => { setMode(routeMode); }, [routeMode]);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [sample, setSample] = useState(0);
  const card = useAnimationControls();
  const shake = useCallback(() => {
    card.start({ x: [0, -9, 9, -6, 6, -3, 0], transition: { duration: 0.42 } });
  }, [card]);

  useEffect(() => {
    card.start({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: 'easeOut' } });
  }, [card]);

  const onGoogle = useCallback(async (credential: string) => {
    setBusy('google');
    try { await loginWithGoogle(credential); } catch { shake(); } finally { setBusy(null); }
  }, [loginWithGoogle, shake]);
  const google = useGoogleSignIn(onGoogle, { text: mode === 'login' ? 'signin_with' : 'signup_with' });

  useEffect(() => {
    const id = window.setInterval(() => setSample((i) => (i + 1) % SAMPLE_QUESTIONS.length), 4200);
    return () => window.clearInterval(id);
  }, []);

  const errors = useMemo(() => ({
    name: mode === 'register' && name.trim().length < 2 ? 'Enter your name (2+ characters).' : '',
    email: !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : '',
    pass: pass.length < 6 ? 'Use at least 6 characters.' : '',
  }), [mode, name, email, pass]);
  const strength = passwordStrength(pass);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    onModeChange?.(next);
    setTouched({});
    clearError();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, email: true, pass: true });
    if (errors.email || errors.pass || errors.name) { shake(); return; }
    setBusy('email');
    try {
      if (mode === 'login') await login(email.trim(), pass);
      else await register(email.trim(), pass, name.trim());
    } catch {
      shake();
    } finally {
      setBusy(null);
    }
  };

  const onPassKey = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);
  const fieldError = (key: 'name' | 'email' | 'pass') => (touched[key] ? errors[key] : '');
  const current = SAMPLE_QUESTIONS[sample];

  return (
    <div className="auth-root">
      <BgCanvas />
      <div className="auth-glow auth-glow-a" />
      <div className="auth-glow auth-glow-b" />

      {/* ── Story panel ── */}
      <aside className="auth-story" aria-hidden="true">
        <div className="auth-story-brand">
          <img src={logoUrl} alt="" />
          <span>DocLens <em>AI</em></span>
        </div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h2 className="auth-story-title">
            Read less.<br /><span>Understand more.</span>
          </h2>
          <p className="auth-story-lead">
            Upload papers, ask questions, and get answers you can verify — every claim traced back to its source.
          </p>
        </motion.div>

        <div className="auth-demo">
          <div className="auth-demo-label"><BookOpen size={13} /> Live example</div>
          <AnimatePresence mode="wait">
            <motion.div
              key={sample}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
            >
              <p className="auth-demo-q">{current.q}</p>
              <div className="auth-demo-a">
                <Quote size={14} />
                <span>{current.a}<sup>[1]</sup></span>
              </div>
              <div className="auth-demo-cite">[1] {current.cite}</div>
            </motion.div>
          </AnimatePresence>
          <div className="auth-demo-dots">
            {SAMPLE_QUESTIONS.map((_, i) => <i key={i} className={i === sample ? 'on' : ''} />)}
          </div>
        </div>

        <ul className="auth-features">
          {FEATURES.map(({ icon: Icon, title, text }, i) => (
            <motion.li key={title} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.12 }}>
              <span className="auth-feature-icon"><Icon size={17} /></span>
              <div><strong>{title}</strong><p>{text}</p></div>
            </motion.li>
          ))}
        </ul>
      </aside>

      {/* ── Auth card ── */}
      <main className="auth-panel">
        {onBack && (
          <button type="button" className="auth-back" onClick={onBack}>
            <ArrowLeft size={15} /> Back to home
          </button>
        )}

        <motion.div className="auth-card" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={card}>
          <div className="auth-card-brand">
            <img src={logoUrl} alt="DocLens" />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              className="auth-heading"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <h1>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1>
              <p>{mode === 'login' ? 'Sign in to continue your research.' : 'Start organising and questioning your papers in minutes.'}</p>
            </motion.div>
          </AnimatePresence>

          <div className="auth-tabs" role="tablist" aria-label="Sign in or create account">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={mode === m ? 'active' : ''}
                onClick={() => switchMode(m)}
              >
                {mode === m && <motion.span layoutId="auth-tab-pill" className="auth-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="auth-tab-label">{m === 'login' ? 'Sign in' : 'Create account'}</span>
              </button>
            ))}
          </div>

          {/* Google */}
          <div className="auth-google">
            <div ref={google.buttonRef} className={`auth-google-slot ${google.status === 'ready' ? 'is-ready' : ''}`} />
            {google.status !== 'ready' && (
              <button
                type="button"
                className="auth-google-fallback"
                disabled={google.status === 'loading'}
                title={google.status === 'unconfigured' ? 'Set GOOGLE_CLIENT_ID on the server to enable Google sign-in' : undefined}
                onClick={() => setTouched((t) => ({ ...t, google: true }))}
              >
                {google.status === 'loading' ? <Loader2 size={17} className="auth-spin" /> : <GoogleMark />}
                Continue with Google
              </button>
            )}
            {busy === 'google' && <div className="auth-google-busy"><Loader2 size={16} className="auth-spin" /> Signing you in…</div>}
            <AnimatePresence>
              {touched.google && google.status !== 'ready' && google.status !== 'loading' && (
                <motion.p className="auth-hint" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  {google.status === 'unconfigured'
                    ? 'Google sign-in is not enabled on this server yet. Use email below, or ask the admin to set GOOGLE_CLIENT_ID.'
                    : google.message}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="auth-divider"><span>or with email</span></div>

          <form onSubmit={submit} className="auth-form" noValidate>
            <AnimatePresence initial={false}>
              {mode === 'register' && (
                <motion.div
                  key="name"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  style={{ overflow: 'hidden' }}
                >
                  <Field
                    id="auth-name" label="Full name" icon={<User size={16} />} autoComplete="name"
                    value={name} placeholder="Ada Lovelace" error={fieldError('name')}
                    onChange={(v) => { setName(v); clearError(); }} onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <Field
              id="auth-email" label="Email" type="email" icon={<Mail size={16} />} autoComplete="email"
              value={email} placeholder="you@university.edu" error={fieldError('email')}
              valid={!errors.email && email.length > 0}
              onChange={(v) => { setEmail(v); clearError(); }} onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            />

            <Field
              id="auth-pass" label="Password" type={showPass ? 'text' : 'password'} icon={<Lock size={16} />}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={pass} placeholder={mode === 'login' ? 'Your password' : 'At least 6 characters'} error={fieldError('pass')}
              onChange={(v) => { setPass(v); clearError(); }} onBlur={() => setTouched((t) => ({ ...t, pass: true }))}
              onKeyUp={onPassKey}
              trailing={(
                <button type="button" className="auth-eye" onClick={() => setShowPass((s) => !s)} aria-label={showPass ? 'Hide password' : 'Show password'}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              )}
            />

            {capsLock && <p className="auth-hint auth-hint-warn">Caps Lock is on.</p>}

            {mode === 'register' && pass.length > 0 && (
              <div className="auth-strength" aria-live="polite">
                <div className="auth-strength-bars">
                  {[0, 1, 2, 3].map((i) => <i key={i} className={i < strength.level ? `lvl-${strength.level}` : ''} />)}
                </div>
                <span>{strength.label}</span>
              </div>
            )}

            <AnimatePresence>
              {error && (
                <motion.div className="auth-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <AlertCircle size={15} /> {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              className="auth-submit"
              disabled={busy !== null}
              whileHover={busy ? undefined : { y: -1 }}
              whileTap={busy ? undefined : { scale: 0.985 }}
            >
              {busy === 'email' ? (
                <><Loader2 size={17} className="auth-spin" /> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
              ) : (
                <>{mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={17} /></>
              )}
            </motion.button>
          </form>

          <p className="auth-switch">
            {mode === 'login' ? "New to DocLens? " : 'Already have an account? '}
            <button type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>

          <p className="auth-trust"><ShieldCheck size={13} /> Your papers stay private to your account.</p>
        </motion.div>

        <footer className="auth-footer">© Aishwary Vansh 2026 · DocLens AI</footer>
      </main>
    </div>
  );
};

function Field({
  id, label, icon, value, onChange, onBlur, onKeyUp, placeholder, type = 'text', error, valid, trailing, autoComplete,
}: {
  id: string; label: string; icon: ReactNode; value: string; onChange: (v: string) => void; onBlur?: () => void;
  onKeyUp?: (e: KeyboardEvent<HTMLInputElement>) => void; placeholder: string; type?: string; error?: string;
  valid?: boolean; trailing?: ReactNode; autoComplete?: string;
}) {
  return (
    <div className={`auth-field ${error ? 'has-error' : ''} ${valid ? 'is-valid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        <span className="auth-input-icon">{icon}</span>
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyUp={onKeyUp}
        />
        {trailing}
      </div>
      <AnimatePresence>
        {error && (
          <motion.span id={`${id}-error`} className="auth-field-error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default Login;
