// src/pages/landing/LandingCTA.jsx
import { useEffect, useRef } from 'react';

const LandingCTA = ({ onGetStarted }) => {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.classList.add('in'); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section className="l-cta" id="contact">
      <div className="sec-label" style={{ justifyContent: 'center' }}>
        // Ready to build
      </div>
      <h2 className="cta-title reveal" ref={ref}>
        TRANSFORM YOUR<br />
        <span className="cta-outline">DOCUMENTS</span><br />
        WITH AI
      </h2>
      <p className="cta-sub">
        DocLens — Intelligent Research & Document Understanding Platform
      </p>
      <div className="cta-btns">
        <button
          className="l-btn-primary"
          style={{ padding: '0.9rem 2.2rem', fontSize: '0.76rem' }}
          onClick={onGetStarted}
        >
          Get Started
        </button>
        <a href="#features" className="l-btn-ghost" style={{ fontSize: '0.76rem' }}>
          Read the Docs →
        </a>
      </div>
    </section>
  );
};

export default LandingCTA;
