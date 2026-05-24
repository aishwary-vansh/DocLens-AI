// src/pages/landing/LandingFeatures.jsx
// 3D card tilt is implemented via React onMouseMove/onMouseLeave handlers
import { useEffect, useRef } from 'react';

const FEATURES = [
  {
    num: '01',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        <path d="M11 8v6M8 11h6"/>
      </svg>
    ),
    name: 'Semantic Library Search',
    desc: 'Search by meaning or question — not just exact keywords. Instantly surface the most relevant paragraphs across your uploaded research papers.',
    tag: 'Semantic Discovery',
  },
  {
    num: '02',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        <line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/>
      </svg>
    ),
    name: 'Instant Answers with Citations',
    desc: 'Ask natural language questions. Powered by OpenRouter, DocLens generates highly accurate answers instantly and provides exact source citations from your uploaded papers.',
    tag: 'Powered by OpenRouter Llama-3',
  },
  {
    num: '03',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
    name: 'Smart Summarization',
    desc: 'Generate concise, accurate summaries of lengthy research papers. Understand long reports without having to read them cover-to-cover.',
    tag: 'Quick Summarization',
  },
  {
    num: '04',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="2" y="3" width="7" height="9"/><rect x="15" y="3" width="7" height="9"/>
        <rect x="2" y="15" width="7" height="6"/><rect x="15" y="15" width="7" height="6"/>
        <path d="M9 7.5h6M9 18h6"/>
      </svg>
    ),
    name: 'Cross-Paper Comparisons',
    desc: 'Compare findings, trace recurring themes, or synthesize knowledge across entire document collections. Easily connect the dots between multiple authors.',
    tag: 'Theme Synthesis',
  },
  {
    num: '05',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    name: 'Local Document Processing',
    desc: 'Process your documents entirely on your local machine before querying the LLM, ensuring you maintain control over your raw files.',
    tag: 'Local Intelligence',
  },
  {
    num: '06',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
    name: 'Personal Workspaces',
    desc: 'Organize documents into clean, personal workspaces. Maintain isolated knowledge bases per project on your own machine.',
    tag: 'Local Organization',
  },
];

const FeatureCard = ({ feature }) => {
  const cardRef = useRef(null);

  const onMouseMove = (e) => {
    const card = cardRef.current;
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left)  / r.width  - 0.5;
    const y = (e.clientY - r.top)   / r.height - 0.5;
    card.style.transition = 'transform 0.08s ease, background 0.3s';
    card.style.transform  = `perspective(700px) rotateY(${x * 9}deg) rotateX(${-y * 9}deg) translateZ(10px)`;
  };

  const onMouseLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transition = 'transform 0.5s ease, background 0.3s';
    card.style.transform  = 'perspective(700px) rotateY(0) rotateX(0) translateZ(0)';
  };

  // Attach reveal observer
  const revealRef = useRef(null);
  useEffect(() => {
    const el = revealRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.classList.add('in'); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={(el) => { cardRef.current = el; revealRef.current = el; }}
      className="fc reveal"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <span className="fc-num">{feature.num}</span>
      <div className="fc-icon">{feature.icon}</div>
      <div className="fc-name">{feature.name}</div>
      <p className="fc-desc">{feature.desc}</p>
      <span className="fc-tag">{feature.tag}</span>
    </div>
  );
};

const LandingFeatures = () => {
  const hdrRef = useRef(null);
  useEffect(() => {
    const el = hdrRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.classList.add('in'); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section className="l-features" id="features">
      <div className="features-hdr reveal" ref={hdrRef}>
        <div>
          <div className="sec-label">Core Capabilities</div>
          <h2 className="sec-title">WHAT DOCLENS<br />CAN DO</h2>
        </div>
        <p>A personal document intelligence tool designed for your local research workflow.</p>
      </div>

      <div className="fg">
        {FEATURES.map((f) => <FeatureCard key={f.num} feature={f} />)}
      </div>
    </section>
  );
};

export default LandingFeatures;
