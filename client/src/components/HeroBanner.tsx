import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface HeroBannerProps {
  running: boolean;
  onRun: () => void;
}

function HeroBanner({ running, onRun }: HeroBannerProps) {
  return (
    <motion.header
      className="hero-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <div className="hero-content">
        <div>
          <p className="hero-kicker">Khmer Subtitle AI Pro V4</p>
          <h1>Professional Khmer Dubbing Workflow</h1>
          <p>
            Upload your video, configure API keys and language settings, generate Khmer voice, preview results, and
            export MP4 with synced subtitles.
          </p>
        </div>

        <button onClick={onRun} className="primary-button" type="button" disabled={running}>
          <Sparkles size={18} />
          {running ? "Processing..." : "Translate and Dub to Khmer"}
        </button>
      </div>
    </motion.header>
  );
}

export default HeroBanner;