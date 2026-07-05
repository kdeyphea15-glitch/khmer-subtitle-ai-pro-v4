import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface HeroBannerProps {
  running: boolean;
  onRun: () => void;
}

function HeroBanner({ running, onRun }: HeroBannerProps) {
  const heroBackgroundStyle = {
    backgroundImage:
      "linear-gradient(rgba(0,0,0,.38), rgba(0,0,0,.38)), url('/images/angkor-wat.jpg')",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundColor: "transparent"
  } as const;

  return (
    <motion.header
      className="hero-cinematic glass-card perf-layer"
      style={heroBackgroundStyle}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <img className="hero-media" src="/images/angkor-wat.jpg" alt="Angkor Wat at sunset" aria-hidden="true" />
      <div className="hero-overlay" aria-hidden="true" />
      <div className="hero-sun" aria-hidden="true" />

      <div className="hero-grid">
        <section className="hero-left">
          <div className="hero-brand-pill">
            <span className="hero-brand-mark">K</span>
            <span className="hero-brand-name">KHMER SUBTITLE AI PRO V4</span>
          </div>

          <p className="tagline">AI Dubbing Studio for Khmer</p>
          <h1>KHMER SUBTITLE AI PRO V4</h1>
          <p className="hero-description">
            Upload once. Transcribe, translate, generate Khmer voice, replace audio, and export MP4 in one cinematic
            workflow.
          </p>

          <button onClick={onRun} className="gold-button" type="button" disabled={running}>
            <Sparkles size={18} />
            {running ? "Processing..." : "Translate & Dub to Khmer"}
          </button>
        </section>

        <section className="hero-right" aria-label="Angkor Wat artwork panel">
          <div className="hero-right-overlay" aria-hidden="true" />
          <div className="khmer-ornament top">❈ ❈ ❈</div>
          <p className="khmer-signature">រចនាដោយ (ភក្ដី)</p>
          <div className="khmer-ornament bottom">❈ ❈ ❈</div>
        </section>
      </div>
    </motion.header>
  );
}

export default HeroBanner;