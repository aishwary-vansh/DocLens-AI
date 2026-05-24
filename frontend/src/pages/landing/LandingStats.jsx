// src/pages/landing/LandingStats.jsx
// Counter animation via IntersectionObserver
import { useEffect, useRef } from 'react';

const STATS = [
  { count: 50,  suffix: 'k+', label: 'Papers Analyzed' },
  { count: 10,  suffix: 'x',  label: 'Faster Literature Reviews' },
  { count: 99,  suffix: '%',  label: 'Citation Accuracy' },
  { count: 100, suffix: 'k+', label: 'Queries Answered' },
];

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const StatCell = ({ stat }) => {
  const valRef  = useRef(null);
  const cellRef = useRef(null);

  useEffect(() => {
    const el   = valRef.current;
    const cell = cellRef.current;
    if (!el || !cell) return;

    // Scroll-reveal
    const revObs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) cell.classList.add('in');
    }, { threshold: 0.1 });
    revObs.observe(cell);

    // Counter
    const countObs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      countObs.disconnect();
      const dur = 1600;
      const t0  = performance.now();
      const tick = (now) => {
        const p = Math.min((now - t0) / dur, 1);
        el.textContent = Math.round(easeOut(p) * stat.count) + stat.suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    countObs.observe(el);

    return () => { revObs.disconnect(); countObs.disconnect(); };
  }, [stat.count, stat.suffix]);

  return (
    <div className="stat-cell reveal" ref={cellRef}>
      <div className="stat-val" ref={valRef}>0</div>
      <div className="stat-lbl">{stat.label}</div>
    </div>
  );
};

const LandingStats = () => (
  <div className="l-stats">
    {STATS.map((s) => <StatCell key={s.label} stat={s} />)}
  </div>
);

export default LandingStats;
