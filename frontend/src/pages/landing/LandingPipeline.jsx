// src/pages/landing/LandingPipeline.jsx
import { useEffect, useRef } from 'react';

const STEPS = [
  {
    label: '1. Upload',
    desc: 'Securely upload your PDFs.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    ),
  },
  {
    label: '2. Analyze',
    desc: 'AI extracts chunks & embeds with pgvector.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
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
    desc: 'Get instant, cited AI answers.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
    ),
  },
];

const LandingPipeline = () => {
  const hdrRef  = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    const observe = (el) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        ([e]) => { if (e.isIntersecting) { el.classList.add('in'); obs.disconnect(); } },
        { threshold: 0.1 }
      );
      obs.observe(el);
      return () => obs.disconnect();
    };
    observe(hdrRef.current);
    observe(gridRef.current);
  }, []);

  return (
    <section className="l-pipeline" id="pipeline">
      <div className="reveal" ref={hdrRef}>
        <div className="sec-label">How it Works</div>
        <h2 className="sec-title">THE RESEARCH<br />WORKFLOW</h2>
      </div>

      <div className="pipe-grid reveal" ref={gridRef}>
        {STEPS.map((s) => (
          <div className="pipe-step" key={s.label}>
            <div className="pipe-node lit">
              {s.icon}
            </div>
            <div className="pipe-label">{s.label}</div>
            <div className="pipe-desc">{s.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default LandingPipeline;
