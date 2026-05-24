// src/pages/InsightsPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { workspacesApi, collectionsApi, documentsApi } from '../services/api';
import { useApp, PAGES } from '../contexts/AppContext';
import BgCanvas from './landing/BgCanvas';

/* ── Design tokens (match landing.css variables inline) ─────── */
const T = {
  bg:      '#080808',
  bg1:     '#0f0f0f',
  bg2:     '#141414',
  accent:  '#dedbd2',
  dim:     'rgba(222,219,210,0.65)',
  muted:   'rgba(222,219,210,0.38)',
  faint:   'rgba(222,219,210,0.12)',
  glow:    'rgba(222,219,210,0.04)',
  border:  'rgba(222,219,210,0.08)',
  borderH: 'rgba(222,219,210,0.22)',
};

const s = {
  mono:  { fontFamily: "'DM Mono', monospace" },
  syne:  { fontFamily: "'Syne', sans-serif" },
};

/* ── Reusable label ─────────────────────────────────────────── */
const SecLabel = ({ children }) => (
  <div style={{ ...s.mono, fontSize: '0.6rem', letterSpacing: '0.22em',
    textTransform: 'uppercase', color: T.muted,
    display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
    <span style={{ color: T.accent, fontWeight: 600 }}>//</span>
    {children}
  </div>
);

/* ── Animated counter ───────────────────────────────────────── */
const Counter = ({ value, suffix = '' }) => {
  const ref = useRef(null);
  const prev = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = prev.current;
    const end   = value;
    const dur   = 900;
    const t0    = performance.now();
    const ease  = (t) => 1 - Math.pow(1 - t, 3);
    const tick  = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      el.textContent = Math.round(start + ease(p) * (end - start)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else prev.current = end;
    };
    requestAnimationFrame(tick);
  }, [value, suffix]);

  return <span ref={ref}>0{suffix}</span>;
};

/* ── Stat card ──────────────────────────────────────────────── */
const StatCard = ({ label, value, suffix, sub, color = T.accent }) => {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? T.bg1 : T.bg,
        border: `1px solid ${hov ? T.borderH : T.border}`,
        padding: '1.8rem 2rem',
        transition: 'all 0.2s',
      }}
    >
      <div style={{ ...s.syne, fontSize: '2.2rem', fontWeight: 800,
        letterSpacing: '-0.03em', color, lineHeight: 1, marginBottom: '0.4rem' }}>
        {value !== null ? <Counter value={value} suffix={suffix} /> : '—'}
      </div>
      <div style={{ ...s.mono, fontSize: '0.6rem', letterSpacing: '0.14em',
        textTransform: 'uppercase', color: T.muted }}>{label}</div>
      {sub && <div style={{ ...s.mono, fontSize: '0.56rem', color: T.muted,
        opacity: 0.5, marginTop: '0.3rem' }}>{sub}</div>}
    </div>
  );
};

/* ── Document status row ────────────────────────────────────── */
const STATUS_COLOR = {
  PENDING:    T.muted,
  EXTRACTING: '#f59e0b',
  CHUNKING:   '#0ea5e9',
  EMBEDDING:  '#8b5cf6',
  COMPLETED:  '#4ade80',
  FAILED:     '#ef4444',
};

const DocRow = ({ doc }) => {
  const [hov, setHov] = useState(false);
  const color = STATUS_COLOR[doc.status] || T.muted;
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        padding: '0.85rem 1.4rem',
        borderBottom: `1px solid ${T.border}`,
        background: hov ? T.bg1 : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ width: '6px', height: '6px', borderRadius: '50%',
        background: color, flexShrink: 0,
        boxShadow: doc.status === 'COMPLETED' ? `0 0 6px ${color}88` : 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...s.mono, fontSize: '0.72rem', color: T.accent,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {doc.title || doc.filename}
        </div>
        <div style={{ ...s.mono, fontSize: '0.56rem', color: T.muted, marginTop: '2px' }}>
          {doc.filename}
        </div>
      </div>
      <div style={{ ...s.mono, fontSize: '0.58rem', letterSpacing: '0.08em',
        textTransform: 'uppercase', color,
        padding: '0.18rem 0.55rem', border: `1px solid ${color}44` }}>
        {doc.status}
      </div>
    </div>
  );
};

/* ── Pipeline bar ───────────────────────────────────────────── */
const PIPE_STEPS = ['Upload', 'Extract', 'Chunk', 'Embed', 'Index', 'Ready'];
const PipelineBar = ({ activeStep = 1 }) => (
  <div style={{ display: 'flex', gap: '1px', background: T.border }}>
    {PIPE_STEPS.map((label, i) => {
      const done   = i < activeStep;
      const active = i === activeStep;
      return (
        <div key={label} style={{
          flex: 1, padding: '0.9rem 0', textAlign: 'center',
          background: done ? T.bg1 : active ? T.bg2 : T.bg,
          borderTop: `1px solid ${done ? T.borderH : active ? T.faint : T.border}`,
        }}>
          <div style={{ ...s.mono, fontSize: '0.55rem', letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: done ? T.accent : active ? T.dim : T.muted }}>
            {String(i + 1).padStart(2, '0')} · {label}
          </div>
        </div>
      );
    })}
  </div>
);

/* ── Activity feed item ─────────────────────────────────────── */
const FeedItem = ({ icon, text, time, color = T.muted }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.8rem',
    padding: '0.75rem 0', borderBottom: `1px solid ${T.border}` }}>
    <div style={{ ...s.mono, fontSize: '0.72rem', color, flexShrink: 0 }}>{icon}</div>
    <div style={{ flex: 1 }}>
      <div style={{ ...s.mono, fontSize: '0.65rem', color: T.accent, lineHeight: 1.5 }}>
        {text}
      </div>
      <div style={{ ...s.mono, fontSize: '0.54rem', color: T.muted, marginTop: '3px' }}>
        {time}
      </div>
    </div>
  </div>
);

/* ── Main InsightsPage ──────────────────────────────────────── */
const InsightsPage = () => {
  const { navigateTo } = useApp();
  const [stats, setStats] = useState({ workspaces: null, collections: null, documents: null, completed: null });
  const [recentDocs, setRecentDocs]   = useState([]);
  const [recentWs,   setRecentWs]     = useState([]);
  const [loading, setLoading]         = useState(true);

  const load = useCallback(async () => {
    try {
      const workspaces = await workspacesApi.list();
      setRecentWs(workspaces.slice(0, 3));

      let totalDocs = 0, completed = 0, allDocs = [];
      let totalCollections = 0;

      await Promise.all(workspaces.map(async (ws) => {
        const cols = await collectionsApi.list(ws.id);
        totalCollections += cols.length;
        await Promise.all(cols.map(async (col) => {
          const docs = await documentsApi.list(col.id);
          totalDocs += docs.length;
          completed += docs.filter((d) => d.status === 'COMPLETED').length;
          allDocs.push(...docs);
        }));
      }));

      allDocs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setRecentDocs(allDocs.slice(0, 8));
      setStats({ workspaces: workspaces.length, collections: totalCollections, documents: totalDocs, completed });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const completedPct = stats.documents > 0
    ? Math.round((stats.completed / stats.documents) * 100)
    : 0;

  // Generate activity feed from recent docs
  const feed = recentDocs.slice(0, 5).map((d) => ({
    icon: d.status === 'COMPLETED' ? '✓' : d.status === 'FAILED' ? '✕' : '⟳',
    text: `${d.title || d.filename} · ${d.status.toLowerCase()}`,
    time: new Date(d.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    color: STATUS_COLOR[d.status] || T.muted,
  }));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: T.bg, color: T.accent,
      fontFamily: "'DM Mono', monospace",
      overflowY: 'auto',
    }}>
      {/* Particle canvas */}
      <BgCanvas />

      {/* Content wrapper */}
      <div style={{ position: 'relative', zIndex: 1, padding: '0 0 4rem' }}>

        {/* ── Header bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.1rem 2.5rem',
          borderBottom: `1px solid ${T.border}`,
          background: 'rgba(8,8,8,0.9)',
          backdropFilter: 'blur(20px)',
          position: 'sticky', top: 0, zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <button
              onClick={() => navigateTo(PAGES.DASHBOARD)}
              style={{ background: 'none', border: `1px solid ${T.border}`, cursor: 'none',
                ...s.mono, fontSize: '0.6rem', color: T.muted, letterSpacing: '0.1em',
                padding: '0.26rem 0.65rem', transition: 'border-color 0.15s, color 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.borderH; e.currentTarget.style.color = T.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
            >← Workspaces</button>
            <div style={{ ...s.syne, fontWeight: 700, fontSize: '0.9rem',
              letterSpacing: '0.2em', textTransform: 'uppercase' }}>DocLens</div>
            <span style={{ color: T.muted, fontSize: '0.6rem' }}>/</span>
            <span style={{ ...s.mono, fontSize: '0.6rem', color: T.muted,
              letterSpacing: '0.1em', textTransform: 'uppercase' }}>Insights</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem',
            border: `1px solid ${T.border}`, padding: '0.28rem 0.7rem',
            borderRadius: '100px', fontSize: '0.6rem', color: T.muted, ...s.mono }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%',
              background: '#4ade80', display: 'inline-block',
              animation: 'ins-blink 2.2s ease-in-out infinite' }} />
            Platform Live
          </div>
        </div>

        {/* ── Hero strip ── */}
        <div style={{ padding: '3.5rem 2.5rem 2.5rem', borderBottom: `1px solid ${T.border}` }}>
          <SecLabel>Research Intelligence · Phase 1</SecLabel>
          <h1 style={{ ...s.syne, fontSize: 'clamp(1.8rem, 4vw, 3.8rem)',
            fontWeight: 800, letterSpacing: '-0.025em', textTransform: 'uppercase',
            lineHeight: 0.92, marginBottom: '1rem' }}>
            PLATFORM<br />
            <span style={{ color: 'transparent', WebkitTextStroke: `1.5px ${T.accent}` }}>
              INSIGHTS
            </span>
          </h1>
          <p style={{ ...s.mono, fontSize: '0.7rem', color: T.muted,
            lineHeight: 1.75, maxWidth: '480px', fontWeight: 300 }}>
            Live metrics and document processing status across all your research workspaces.
          </p>
        </div>

        {/* ── Stats grid ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1px', background: T.border, borderBottom: `1px solid ${T.border}` }}>
          <StatCard label="Workspaces"  value={stats.workspaces}   suffix="" />
          <StatCard label="Collections" value={stats.collections}  suffix="" />
          <StatCard label="Documents"   value={stats.documents}    suffix="" />
          <StatCard label="Completed"   value={stats.completed !== null ? completedPct : null} suffix="%" sub={`${stats.completed ?? 0} of ${stats.documents ?? 0} indexed`} color="#4ade80" />
        </div>

        {/* ── Pipeline status ── */}
        <div style={{ padding: '2.5rem 2.5rem 0', borderBottom: `1px solid ${T.border}` }}>
          <SecLabel>Processing Pipeline</SecLabel>
          <PipelineBar activeStep={stats.completed > 0 ? 5 : stats.documents > 0 ? 1 : 0} />
          <div style={{ ...s.mono, fontSize: '0.58rem', color: T.muted,
            padding: '0.7rem 0 1.5rem' }}>
            {stats.documents === 0
              ? '> No documents uploaded yet — upload PDFs in any collection to begin processing.'
              : stats.completed === stats.documents
              ? `> All ${stats.documents} document${stats.documents !== 1 ? 's' : ''} indexed and ready for querying.`
              : `> ${stats.documents - (stats.completed ?? 0)} document${stats.documents - (stats.completed ?? 0) !== 1 ? 's' : ''} pending AI processing.`
            }
          </div>
        </div>

        {/* ── Two-column grid: Recent Docs + Workspaces ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: '1px', background: T.border, borderBottom: `1px solid ${T.border}` }}>

          {/* Recent documents */}
          <div style={{ background: T.bg, padding: '2rem 0' }}>
            <div style={{ padding: '0 2rem 1.2rem' }}>
              <SecLabel>Recent Documents</SecLabel>
            </div>
            {loading ? (
              <div style={{ padding: '0 2rem', ...s.mono, fontSize: '0.65rem', color: T.muted }}>
                Loading...
              </div>
            ) : recentDocs.length === 0 ? (
              <div style={{ padding: '0 2rem', ...s.mono, fontSize: '0.65rem', color: T.muted }}>
                No documents yet — upload PDFs in a collection.
              </div>
            ) : (
              recentDocs.map((d) => <DocRow key={d.id} doc={d} />)
            )}
          </div>

          {/* Activity feed + Workspace list */}
          <div style={{ background: T.bg }}>
            <div style={{ padding: '2rem 2rem 1.2rem' }}>
              <SecLabel>Activity Feed</SecLabel>
            </div>
            {feed.length === 0 ? (
              <div style={{ padding: '0 2rem', ...s.mono, fontSize: '0.65rem', color: T.muted }}>
                No recent activity.
              </div>
            ) : (
              <div style={{ padding: '0 2rem' }}>
                {feed.map((item, i) => <FeedItem key={i} {...item} />)}
              </div>
            )}

            <div style={{ padding: '2rem 2rem 1.2rem', marginTop: '1rem',
              borderTop: `1px solid ${T.border}` }}>
              <SecLabel>Workspaces</SecLabel>
            </div>
            <div style={{ padding: '0 2rem' }}>
              {recentWs.length === 0 ? (
                <div style={{ ...s.mono, fontSize: '0.65rem', color: T.muted }}>
                  No workspaces yet.
                </div>
              ) : recentWs.map((ws, i) => (
                <div key={ws.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.8rem',
                  padding: '0.75rem 0', borderBottom: `1px solid ${T.border}`,
                }}>
                  <span style={{ ...s.mono, fontSize: '0.55rem', color: T.muted }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...s.mono, fontSize: '0.7rem', color: T.accent }}>
                      {ws.name}
                    </div>
                    {ws.description && (
                      <div style={{ ...s.mono, fontSize: '0.56rem', color: T.muted, marginTop: '2px' }}>
                        {ws.description}
                      </div>
                    )}
                  </div>
                  <div style={{ ...s.mono, fontSize: '0.54rem', color: T.muted }}>
                    {new Date(ws.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Tech stack footer strip ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2rem',
          padding: '1.8rem 2.5rem', borderBottom: `1px solid ${T.border}`,
          flexWrap: 'wrap',
        }}>
          {['NestJS', 'FastAPI', 'React', 'FAISS', 'PostgreSQL', 'Prisma'].map((t) => (
            <span key={t} style={{
              ...s.mono, fontSize: '0.58rem', letterSpacing: '0.1em',
              color: T.muted, border: `1px solid ${T.border}`,
              padding: '0.22rem 0.6rem',
            }}>
              {t}
            </span>
          ))}
        </div>

        <div style={{ padding: '1.2rem 2.5rem', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ ...s.syne, fontSize: '0.75rem', fontWeight: 700,
            letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted }}>
            DocLens
          </div>
          <div style={{ ...s.mono, fontSize: '0.55rem', color: T.muted, opacity: 0.4 }}>
            © Aishwary Vansh 2026 · Phase 1 · Foundation
          </div>
        </div>
      </div>

      <style>{`@keyframes ins-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
};

export default InsightsPage;
