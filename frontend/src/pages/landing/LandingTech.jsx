// src/pages/landing/LandingTech.jsx
import { useEffect, useRef } from 'react';

const TECH_ROWS = [
  { layer: 'Frontend',     chips: ['React', 'TailwindCSS', 'Socket.io Client'] },
  { layer: 'API Gateway',  chips: ['NestJS', 'WebSockets', 'JWT Auth'] },
  { layer: 'AI Service',   chips: ['Python', 'FastAPI', 'HuggingFace'] },
  { layer: 'Vector Store', chips: ['FAISS', 'Sentence Transformers'] },
  { layer: 'Database',     chips: ['PostgreSQL', 'Prisma ORM'] },
  { layer: 'Deployment',   chips: ['Docker', 'Docker Compose', 'Nginx'] },
];

const RevealRow = ({ children }) => {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.classList.add('in'); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return <div className="reveal" ref={ref}>{children}</div>;
};

const ArchDiagram = () => (
  <svg viewBox="0 0 860 220" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', maxWidth: '860px' }}>
    {/* React */}
    <rect x="8" y="55" width="130" height="110" stroke="rgba(222,219,210,0.25)" strokeWidth="1"/>
    <text x="73" y="100" fill="#dedbd2" fontFamily="monospace" fontSize="10" textAnchor="middle" opacity="0.85">React App</text>
    <text x="73" y="118" fill="#dedbd2" fontFamily="monospace" fontSize="8.5" textAnchor="middle" opacity="0.45">TailwindCSS</text>
    <text x="73" y="135" fill="#dedbd2" fontFamily="monospace" fontSize="8.5" textAnchor="middle" opacity="0.35">Socket.io Client</text>
    {/* Arrow REST/WS */}
    <line x1="138" y1="110" x2="200" y2="110" stroke="rgba(222,219,210,0.2)" strokeWidth="1"/>
    <text x="168" y="103" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" opacity="0.35">REST / WS</text>
    <circle r="3.5" fill="#dedbd2" opacity="0">
      <animate attributeName="cx" values="140;196" dur="2.4s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="110;110" dur="2.4s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.7;0" dur="2.4s" repeatCount="indefinite"/>
    </circle>
    {/* NestJS */}
    <rect x="200" y="30" width="160" height="160" stroke="rgba(222,219,210,0.25)" strokeWidth="1"/>
    <text x="280" y="70"  fill="#dedbd2" fontFamily="monospace" fontSize="10"  textAnchor="middle" opacity="0.85">NestJS</text>
    <text x="280" y="90"  fill="#dedbd2" fontFamily="monospace" fontSize="8.5" textAnchor="middle" opacity="0.55">API Gateway</text>
    <line x1="210" y1="100" x2="350" y2="100" stroke="rgba(222,219,210,0.1)" strokeWidth="0.5"/>
    <text x="280" y="118" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" textAnchor="middle" opacity="0.35">Auth · CRUD</text>
    <text x="280" y="133" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" textAnchor="middle" opacity="0.35">WebSocket Events</text>
    <text x="280" y="148" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" textAnchor="middle" opacity="0.3">Prisma · PostgreSQL</text>
    <text x="280" y="163" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" textAnchor="middle" opacity="0.25">Direct Processing</text>
    {/* Arrow HTTP */}
    <line x1="360" y1="110" x2="420" y2="110" stroke="rgba(222,219,210,0.2)" strokeWidth="1"/>
    <text x="380" y="103" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" opacity="0.35">HTTP</text>
    <circle r="3.5" fill="#dedbd2" opacity="0">
      <animate attributeName="cx" values="362;416" dur="2.8s" repeatCount="indefinite" begin="0.6s"/>
      <animate attributeName="cy" values="110;110" dur="2.8s" repeatCount="indefinite" begin="0.6s"/>
      <animate attributeName="opacity" values="0;0.7;0" dur="2.8s" repeatCount="indefinite" begin="0.6s"/>
    </circle>
    {/* FastAPI */}
    <rect x="420" y="30" width="160" height="160" stroke="rgba(222,219,210,0.25)" strokeWidth="1"/>
    <text x="500" y="70"  fill="#dedbd2" fontFamily="monospace" fontSize="10"  textAnchor="middle" opacity="0.85">FastAPI</text>
    <text x="500" y="90"  fill="#dedbd2" fontFamily="monospace" fontSize="8.5" textAnchor="middle" opacity="0.55">AI Service</text>
    <line x1="430" y1="100" x2="572" y2="100" stroke="rgba(222,219,210,0.1)" strokeWidth="0.5"/>
    <text x="500" y="118" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" textAnchor="middle" opacity="0.35">Sentence Transformers</text>
    <text x="500" y="133" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" textAnchor="middle" opacity="0.35">HuggingFace LLM</text>
    <text x="500" y="148" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" textAnchor="middle" opacity="0.3">FAISS Index</text>
    <text x="500" y="163" fill="#dedbd2" fontFamily="monospace" fontSize="7.5" textAnchor="middle" opacity="0.25">PyMuPDF Extractor</text>
    {/* Arrows to storage */}
    <line x1="580" y1="80"  x2="640" y2="80"  stroke="rgba(222,219,210,0.15)" strokeWidth="1"/>
    <line x1="580" y1="140" x2="640" y2="140" stroke="rgba(222,219,210,0.15)" strokeWidth="1"/>
    {/* PostgreSQL */}
    <rect x="640" y="30" width="140" height="70" stroke="rgba(222,219,210,0.18)" strokeWidth="0.8"/>
    <text x="710" y="62" fill="#dedbd2" fontFamily="monospace" fontSize="9.5" textAnchor="middle" opacity="0.65">PostgreSQL</text>
    <text x="710" y="79" fill="#dedbd2" fontFamily="monospace" fontSize="8"   textAnchor="middle" opacity="0.35">Primary Database</text>
    {/* Upload storage */}
    <rect x="640" y="120" width="140" height="70" stroke="rgba(222,219,210,0.18)" strokeWidth="0.8"/>
    <text x="710" y="152" fill="#dedbd2" fontFamily="monospace" fontSize="9.5" textAnchor="middle" opacity="0.65">Uploads</text>
    <text x="710" y="169" fill="#dedbd2" fontFamily="monospace" fontSize="8"   textAnchor="middle" opacity="0.35">PDF Storage</text>
  </svg>
);

const LandingTech = () => {
  const hdrRef = useRef(null);
  const archRef = useRef(null);

  useEffect(() => {
    [hdrRef, archRef].forEach((r) => {
      const el = r.current;
      if (!el) return;
      const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.classList.add('in'); }, { threshold: 0.1 });
      obs.observe(el);
      return () => obs.disconnect();
    });
  }, []);

  return (
    <section className="l-tech" id="architecture">
      <div className="reveal" ref={hdrRef}>
        <div className="sec-label">Technical Architecture</div>
        <h2 className="sec-title">BUILT ON THE<br />RIGHT STACK</h2>
      </div>

      <div className="tech-rows">
        {TECH_ROWS.map((row) => (
          <RevealRow key={row.layer}>
            <div className="tech-row">
              <div className="tech-layer">{row.layer}</div>
              <div className="chips">
                {row.chips.map((c) => <span className="chip" key={c}>{c}</span>)}
              </div>
            </div>
          </RevealRow>
        ))}
      </div>

      <div className="arch-box reveal" ref={archRef}>
        <div className="arch-box-label">// System architecture overview</div>
        <ArchDiagram />
      </div>
    </section>
  );
};

export default LandingTech;
