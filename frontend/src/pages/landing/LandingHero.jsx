// src/pages/landing/LandingHero.jsx
const HeroDeco = () => (
  <svg className="hero-deco" viewBox="0 0 440 560" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Primary document */}
    <rect x="40" y="30" width="155" height="210" stroke="#dedbd2" strokeWidth="1" opacity="0.35"/>
    <line x1="40" y1="75"  x2="195" y2="75"  stroke="#dedbd2" strokeWidth="0.5" opacity="0.2"/>
    <line x1="40" y1="100" x2="175" y2="100" stroke="#dedbd2" strokeWidth="0.5" opacity="0.2"/>
    <line x1="40" y1="125" x2="183" y2="125" stroke="#dedbd2" strokeWidth="0.5" opacity="0.2"/>
    <line x1="40" y1="150" x2="160" y2="150" stroke="#dedbd2" strokeWidth="0.5" opacity="0.15"/>
    <line x1="40" y1="175" x2="179" y2="175" stroke="#dedbd2" strokeWidth="0.5" opacity="0.15"/>
    <line x1="40" y1="200" x2="167" y2="200" stroke="#dedbd2" strokeWidth="0.5" opacity="0.12"/>
    <line x1="40" y1="220" x2="190" y2="220" stroke="#dedbd2" strokeWidth="0.5" opacity="0.12"/>
    {/* Fold corner */}
    <polyline points="168,30 195,30 195,57 168,57 168,30" stroke="#dedbd2" strokeWidth="0.8" opacity="0.3"/>
    {/* Connector dashes */}
    <line x1="195" y1="135" x2="278" y2="135" stroke="#dedbd2" strokeWidth="0.5" strokeDasharray="5 4" opacity="0.18"/>
    {/* Second document */}
    <rect x="278" y="75" width="130" height="160" stroke="#dedbd2" strokeWidth="0.8" opacity="0.28"/>
    <line x1="278" y1="108" x2="408" y2="108" stroke="#dedbd2" strokeWidth="0.5" opacity="0.15"/>
    <line x1="278" y1="132" x2="395" y2="132" stroke="#dedbd2" strokeWidth="0.5" opacity="0.15"/>
    <line x1="278" y1="156" x2="400" y2="156" stroke="#dedbd2" strokeWidth="0.5" opacity="0.12"/>
    <line x1="278" y1="180" x2="388" y2="180" stroke="#dedbd2" strokeWidth="0.5" opacity="0.1"/>
    <line x1="278" y1="204" x2="402" y2="204" stroke="#dedbd2" strokeWidth="0.5" opacity="0.1"/>
    {/* Connector down */}
    <line x1="118" y1="240" x2="118" y2="310" stroke="#dedbd2" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.18"/>
    {/* Embedding vector box */}
    <rect x="30" y="310" width="310" height="90" stroke="#dedbd2" strokeWidth="0.6" strokeDasharray="4 3" opacity="0.22"/>
    <text x="48" y="340" fill="#dedbd2" fontFamily="monospace" fontSize="9.5" opacity="0.45">{'[ 0.234, −0.891, 0.445, 0.112,'}</text>
    <text x="48" y="360" fill="#dedbd2" fontFamily="monospace" fontSize="9.5" opacity="0.45">{'  0.778, −0.334, 0.567, ... ]'}</text>
    <text x="48" y="385" fill="#dedbd2" fontFamily="monospace" fontSize="8.5" opacity="0.25">dim: 768 · model: all-MiniLM-L6-v2</text>
    {/* Connector down */}
    <line x1="118" y1="400" x2="118" y2="458" stroke="#dedbd2" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.15"/>
    {/* FAISS index box */}
    <rect x="30" y="458" width="370" height="80" stroke="#dedbd2" strokeWidth="0.6" opacity="0.2"/>
    <text x="48" y="480" fill="#dedbd2" fontFamily="monospace" fontSize="8" opacity="0.4">FAISS  IndexFlatIP</text>
    <line x1="30" y1="490" x2="400" y2="490" stroke="#dedbd2" strokeWidth="0.4" opacity="0.15"/>
    <rect x="42"  y="500" width="32" height="22" stroke="#dedbd2" strokeWidth="0.5" opacity="0.3"/>
    <rect x="82"  y="500" width="32" height="22" stroke="#dedbd2" strokeWidth="0.5" opacity="0.3"/>
    <rect x="122" y="500" width="32" height="22" stroke="#dedbd2" strokeWidth="0.5" opacity="0.3"/>
    <rect x="162" y="500" width="32" height="22" stroke="#dedbd2" strokeWidth="0.5" opacity="0.28"/>
    <rect x="202" y="500" width="32" height="22" stroke="#dedbd2" strokeWidth="0.5" opacity="0.22"/>
    <rect x="242" y="500" width="32" height="22" stroke="#dedbd2" strokeWidth="0.5" opacity="0.18"/>
    <rect x="282" y="500" width="32" height="22" stroke="#dedbd2" strokeWidth="0.5" opacity="0.14"/>
    <rect x="322" y="500" width="65" height="22" stroke="#dedbd2" strokeWidth="0.5" opacity="0.1"/>
    {/* Right-side lines */}
    <line x1="420" y1="30"  x2="440" y2="30"  stroke="#dedbd2" strokeWidth="0.5" opacity="0.2"/>
    <line x1="440" y1="30"  x2="440" y2="200" stroke="#dedbd2" strokeWidth="0.5" opacity="0.2"/>
    <line x1="420" y1="200" x2="440" y2="200" stroke="#dedbd2" strokeWidth="0.5" opacity="0.2"/>
    <line x1="420" y1="300" x2="440" y2="300" stroke="#dedbd2" strokeWidth="0.5" opacity="0.15"/>
    <line x1="440" y1="300" x2="440" y2="480" stroke="#dedbd2" strokeWidth="0.5" opacity="0.15"/>
    <line x1="420" y1="480" x2="440" y2="480" stroke="#dedbd2" strokeWidth="0.5" opacity="0.15"/>
    {/* Animated dot */}
    <circle r="3" fill="#dedbd2" opacity="0.5">
      <animateMotion dur="4s" repeatCount="indefinite">
        <mpath href="#right-path"/>
      </animateMotion>
    </circle>
    <path id="right-path" d="M420,30 L440,30 L440,200 L420,200" stroke="none"/>
  </svg>
);

const LandingHero = ({ onGetStarted }) => (
  <section className="l-hero" id="home">
    <HeroDeco />

    <div className="hero-pill">
      <div className="pill-dot" />
      AI-Powered · Document Intelligence · v1.0
    </div>

    <h1 className="hero-h1">
      INTELLIGENT<br />
      <span className="h1-outline">DOCUMENT</span><br />
      <span className="h1-accent">LENS</span>
    </h1>

    <div className="hero-role">Your Local Research Assistant</div>

    <p className="hero-desc">
      Upload documents, query them semantically, extract citations,<br />
      generate summaries, and synthesize knowledge directly from your machine.<br />
      Powered by the OpenRouter API and Llama-3.
    </p>

    <div className="hero-ctas">
      <button className="l-btn-primary" onClick={onGetStarted}>
        Explore Features
      </button>
      <a href="#pipeline" className="l-btn-ghost">View Pipeline →</a>
    </div>

    <div className="scroll-hint">
      <div className="scroll-bar" />
      Scroll to explore
    </div>
  </section>
);

export default LandingHero;
