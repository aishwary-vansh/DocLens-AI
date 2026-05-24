// src/pages/landing/LandingPipeline.jsx
// Clean 3-step visual
import { useEffect, useRef } from 'react';

const STEPS = [
  {
    label: '1. Upload',
    desc: 'Securely upload your PDFs.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#dedbd2" strokeWidth="1.4">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    ),
  },
  {
    label: '2. Analyze',
    desc: 'Powered by OpenRouter Llama-3 AI.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#dedbd2" strokeWidth="1.4">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>
        <line x1="12" y1="2"  x2="12" y2="8"/>
        <line x1="12" y1="16" x2="12" y2="22"/>
        <line x1="2"  y1="12" x2="8"  y2="12"/>
        <line x1="16" y1="12" x2="22" y2="12"/>
      </svg>
    ),
  },
  {
    label: '3. Discover',
    desc: 'Get instant, cited answers.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#dedbd2" strokeWidth="1.4">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
    ),
  },
];

const LandingPipeline = () => {
  const revealRef = useRef(null);

  useEffect(() => {
    const el = revealRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.classList.add('in'); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section className="l-pipeline" id="pipeline">
      <div className="reveal" ref={revealRef}>
        <div className="sec-label">How it Works</div>
        <h2 className="sec-title">THE RESEARCH<br />WORKFLOW</h2>
      </div>

      <div className="pipe-grid reveal" style={{ marginTop: '4rem', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {STEPS.map((s) => (
          <div className="pipe-step" key={s.label} style={{ textAlign: 'center' }}>
            <div className="pipe-node lit" style={{ margin: '0 auto 1.5rem auto' }}>
              {s.icon}
            </div>
            <div className="pipe-label" style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>{s.label}</div>
            <div style={{ color: 'rgba(222,219,210,0.5)', fontSize: '0.95rem' }}>{s.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default LandingPipeline;
