// src/pages/Landing.jsx
// Assembles all landing page sections. Scoped under .landing-root to prevent
// style leakage into the main application.
import './landing/landing.css';
import BgCanvas       from './landing/BgCanvas';
import LandingNav     from './landing/LandingNav';
import LandingHero    from './landing/LandingHero';
import LandingMarquee from './landing/LandingMarquee';
import LandingFeatures from './landing/LandingFeatures';
import LandingPipeline from './landing/LandingPipeline';
import LandingStats   from './landing/LandingStats';
import LandingTech    from './landing/LandingTech';
import LandingCTA     from './landing/LandingCTA';
import LandingFooter  from './landing/LandingFooter';

/**
 * @param {{ onGetStarted: () => void }} props
 *   `onGetStarted` — called when the user clicks "Get Started" / "Explore".
 *   The parent (App.jsx) switches to the Login view.
 */
const Landing = ({ onGetStarted }) => (
  <div className="landing-root">
    {/* Full-viewport canvas particle network */}
    <BgCanvas />

    {/* Fixed navigation */}
    <LandingNav onGetStarted={onGetStarted} />

    {/* Sections */}
    <LandingHero    onGetStarted={onGetStarted} />
    <LandingFeatures />
    <LandingPipeline />
    <LandingTech />
    <LandingCTA     onGetStarted={onGetStarted} />
    <LandingFooter />
  </div>
);

export default Landing;
