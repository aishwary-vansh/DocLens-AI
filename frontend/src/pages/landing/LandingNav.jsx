// src/pages/landing/LandingNav.jsx
const LandingNav = ({ onGetStarted }) => (
  <nav className="l-nav">
    <a href="#home" className="nav-logo">
      <div className="logo-mark" />
      DocLens
    </a>

    <div className="nav-links">
      <a href="#features">Features</a>
      <a href="#pipeline">Pipeline</a>
      <a href="#architecture">Stack</a>
      <a href="#contact">Contact</a>
    </div>

    <div className="nav-right">
      <div className="badge-pill">
        <div className="dot-green" />
        Open to internships
      </div>
      <button className="l-btn-primary" onClick={onGetStarted}>
        Get Started
      </button>
    </div>
  </nav>
);

export default LandingNav;
