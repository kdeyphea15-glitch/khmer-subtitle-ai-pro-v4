import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
  BadgeCheck,
  Clapperboard,
  Cog,
  FolderKanban,
  Headphones,
  HelpCircle,
  History,
  Languages,
  UploadCloud,
  Video
} from "lucide-react";
import clsx from "clsx";
import axios from "axios";
import { API_BASE_URL, checkBackendHealth, previewVoice, runDubbing, toAssetUrl } from "./api";
import HeroBanner from "./components/HeroBanner";
import type { DubbingResult, Emotion, SettingsState, SubtitleCue, WorkflowStep } from "./types";

const workflowLabels: WorkflowStep[] = [
  { key: "upload", label: "Upload", status: "pending" },
  { key: "separate-vocals", label: "AI Vocal Separation (Demucs)", status: "pending" },
  { key: "transcribe", label: "Transcribe", status: "pending" },
  { key: "translate", label: "Translate", status: "pending" },
  { key: "generate-voice", label: "Generate Khmer Voice", status: "pending" },
  { key: "replace-audio", label: "Replace Audio", status: "pending" },
  { key: "export", label: "Export MP4", status: "pending" }
];

const voiceChoices = [
  { label: "Khmer Female", value: "Khmer Female" },
  { label: "Khmer Male", value: "Khmer Male" }
];

const GEMINI_KEY_STORAGE = "khmer-v4-gemini-api-key";
const GROQ_KEY_STORAGE = "khmer-v4-groq-api-key";
const SUBTITLE_DEFAULT_FONT_SIZE = 20;
const SUBTITLE_MIN_FONT_SIZE = 16;
const SUBTITLE_MAX_FONT_SIZE = 26;
const SUBTITLE_LINE_HEIGHT = 1.6;
const SUBTITLE_VIEWPORT_HEIGHT = 320;
const SUBTITLE_OVERSCAN = 8;
const UI_UPDATE_INTERVAL_MS = 120;
const DEMUCS_SETUP_COMMANDS = [
  "python3 -m venv .venv-demucs",
  "source .venv-demucs/bin/activate",
  "python3 -m pip install --upgrade pip demucs"
].join("\n");

const sidebarItems = [
  { icon: Clapperboard, label: "Home" },
  { icon: FolderKanban, label: "Projects" },
  { icon: History, label: "History" },
  { icon: Headphones, label: "AI Voice" },
  { icon: Cog, label: "Settings" },
  { icon: AudioLines, label: "API Services" },
  { icon: HelpCircle, label: "Support" },
  { icon: BadgeCheck, label: "About" }
];

function readStoredValue(key: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(key) ?? "";
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const backendMessage =
      (typeof error.response?.data?.error === "string" && error.response.data.error) ||
      (typeof error.response?.data?.message === "string" && error.response.data.message);

    if (backendMessage) {
      return backendMessage;
    }

    if (error.code === "ERR_NETWORK") {
      return `Cannot reach backend at ${API_BASE_URL}. Ensure the backend is running and CORS is configured.`;
    }

    if (error.message) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

interface SubtitleVirtualListProps {
  subtitles: SubtitleCue[];
  fontSize: number;
}

const SubtitleVirtualList = memo(function SubtitleVirtualList({ subtitles, fontSize }: SubtitleVirtualListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const frameRef = useRef<number | null>(null);
  const pendingTopRef = useRef(0);
  const rowHeight = useMemo(() => Math.max(40, Math.round(fontSize * SUBTITLE_LINE_HEIGHT + 12)), [fontSize]);

  const totalHeight = subtitles.length * rowHeight;
  const visibleCount = Math.ceil(SUBTITLE_VIEWPORT_HEIGHT / rowHeight) + SUBTITLE_OVERSCAN * 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - SUBTITLE_OVERSCAN);
  const endIndex = Math.min(subtitles.length, startIndex + visibleCount);

  const visibleRows = useMemo(() => subtitles.slice(startIndex, endIndex), [subtitles, startIndex, endIndex]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    pendingTopRef.current = event.currentTarget.scrollTop;

    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = requestAnimationFrame(() => {
      const nextTop = pendingTopRef.current;
      setScrollTop((prev) => (Math.abs(prev - nextTop) >= 1 ? nextTop : prev));
      frameRef.current = null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  if (!subtitles.length) {
    return (
      <div className="subtitle-box subtitle-scroll-area" style={{ minHeight: SUBTITLE_VIEWPORT_HEIGHT }}>
        Subtitle lines will appear after translation.
      </div>
    );
  }

  return (
    <div
      className="subtitle-box virtualized-list subtitle-scroll-area"
      style={{ minHeight: SUBTITLE_VIEWPORT_HEIGHT, fontSize }}
      onScroll={onScroll}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${startIndex * rowHeight}px)` }}>
          {visibleRows.map((cue) => (
            <p
              key={`${cue.start}-${cue.end}-${cue.text.slice(0, 12)}`}
              style={{ minHeight: rowHeight, margin: 0, paddingBottom: "0.55rem", lineHeight: SUBTITLE_LINE_HEIGHT }}
            >
              <span>{cue.start.toFixed(1)}s</span> {cue.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
});

interface MediaPreviewProps {
  videoSrc: string;
  audioSrc: string;
  onAudioError: (message: string) => void;
}

const MediaPreview = memo(function MediaPreview({ videoSrc, audioSrc, onAudioError }: MediaPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [videoTime, setVideoTime] = useState(0);
  const [audioTime, setAudioTime] = useState(0);

  const runRafLoop = useCallback(() => {
    let lastUpdateAt = performance.now();

    const update = (timestamp: number) => {
      const elapsed = timestamp - lastUpdateAt;
      if (elapsed >= UI_UPDATE_INTERVAL_MS) {
        if (videoRef.current) {
          setVideoTime(videoRef.current.currentTime);
        }
        if (audioRef.current) {
          setAudioTime(audioRef.current.currentTime);
        }
        lastUpdateAt = timestamp;
      }

      const shouldContinue = Boolean(videoRef.current?.paused === false || audioRef.current?.paused === false);
      if (shouldContinue) {
        frameRef.current = requestAnimationFrame(update);
      } else {
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(update);
  }, []);

  const startRafIfNeeded = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }
    runRafLoop();
  }, [runRafLoop]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;

    if (!video || !audio) {
      return;
    }

    const handleMediaActivity = () => startRafIfNeeded();

    video.addEventListener("play", handleMediaActivity);
    video.addEventListener("seeked", handleMediaActivity);
    audio.addEventListener("play", handleMediaActivity);
    audio.addEventListener("seeked", handleMediaActivity);

    return () => {
      video.removeEventListener("play", handleMediaActivity);
      video.removeEventListener("seeked", handleMediaActivity);
      audio.removeEventListener("play", handleMediaActivity);
      audio.removeEventListener("seeked", handleMediaActivity);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [startRafIfNeeded]);

  return (
    <>
      <div>
        <h3>Video Preview</h3>
        <video ref={videoRef} controls preload="metadata" src={videoSrc || undefined} />
        <p className="media-progress">Progress: {formatTime(videoTime)}</p>
      </div>

      <div>
        <h3>Generated Voice Preview</h3>
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={audioSrc || undefined}
          onCanPlay={() => {
            console.log(`[PreviewVoice] Audio element can play: ${audioSrc}`);
          }}
          onError={(event) => {
            const mediaErrorCode = event.currentTarget.error?.code;
            onAudioError(`Audio playback failed (code ${mediaErrorCode ?? "unknown"}).`);
          }}
        />
        <p className="media-progress">Progress: {formatTime(audioTime)}</p>
      </div>
    </>
  );
});

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState("Auto Detect");
  const [removeOriginalVoices, setRemoveOriginalVoices] = useState(false);
  const [voiceName, setVoiceName] = useState(voiceChoices[0].value);
  const [emotion, setEmotion] = useState<Emotion>("normal");
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [voiceVolume, setVoiceVolume] = useState(0);
  const [voicePreviewText, setVoicePreviewText] = useState("សូមស្វាគមន៍មកកាន់ Khmer Subtitle AI Pro V4");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DubbingResult | null>(null);
  const [error, setError] = useState("");
  const [subtitleFontSize, setSubtitleFontSize] = useState(SUBTITLE_DEFAULT_FONT_SIZE);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollDebounceRef = useRef<number | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);

  const [settings, setSettings] = useState<SettingsState>({
    geminiApiKey: readStoredValue(GEMINI_KEY_STORAGE),
    groqApiKey: readStoredValue(GROQ_KEY_STORAGE),
    theme: "dark",
    language: "Khmer"
  });

  const [previewVideoUrl, setPreviewVideoUrl] = useState("");

  useEffect(() => {
    window.localStorage.setItem(GEMINI_KEY_STORAGE, settings.geminiApiKey);
  }, [settings.geminiApiKey]);

  useEffect(() => {
    window.localStorage.setItem(GROQ_KEY_STORAGE, settings.groqApiKey);
  }, [settings.groqApiKey]);

  useEffect(() => {
    checkBackendHealth()
      .then(() => {
        setError((current) =>
          current.includes("Cannot reach backend") || current.includes("Backend health check") ? "" : current
        );
      })
      .catch((healthError) => {
        setError(getApiErrorMessage(healthError, "Backend health check failed."));
      });
  }, []);

  useEffect(() => {
    return () => {
      if (previewBlobUrlRef.current) {
        URL.revokeObjectURL(previewBlobUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (!isScrolling) {
        setIsScrolling(true);
      }

      if (scrollDebounceRef.current !== null) {
        window.clearTimeout(scrollDebounceRef.current);
      }

      scrollDebounceRef.current = window.setTimeout(() => {
        setIsScrolling(false);
        scrollDebounceRef.current = null;
      }, 140);
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollDebounceRef.current !== null) {
        window.clearTimeout(scrollDebounceRef.current);
      }
    };
  }, [isScrolling]);

  const progressSteps = useMemo(() => {
    if (!result) {
      return workflowLabels;
    }

    return workflowLabels.map((step) => result.steps.find((serverStep) => serverStep.key === step.key) || step);
  }, [result]);

  const subtitles = useMemo(() => result?.subtitles ?? [], [result]);

  const subtitleText = useMemo(() => {
    if (!subtitles.length) {
      return "";
    }

    return subtitles.map((cue) => cue.text).join("\n");
  }, [subtitles]);

  const toSrtTimestamp = useCallback((secondsValue: number) => {
    const totalMs = Math.max(0, Math.round(secondsValue * 1000));
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const milliseconds = totalMs % 1000;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
  }, []);

  const subtitleSrtText = useMemo(() => {
    if (!subtitles.length) {
      return "";
    }

    return subtitles
      .map(
        (cue, index) =>
          `${index + 1}\n${toSrtTimestamp(cue.start)} --> ${toSrtTimestamp(cue.end)}\n${cue.text}`
      )
      .join("\n\n");
  }, [subtitles, toSrtTimestamp]);

  const handleSubtitleFontIncrease = useCallback(() => {
    setSubtitleFontSize((current) => Math.min(SUBTITLE_MAX_FONT_SIZE, current + 2));
  }, []);

  const handleSubtitleFontDecrease = useCallback(() => {
    setSubtitleFontSize((current) => Math.max(SUBTITLE_MIN_FONT_SIZE, current - 2));
  }, []);

  const handleCopySubtitle = useCallback(async () => {
    if (!subtitleText) {
      setError("No subtitles available to copy yet.");
      return;
    }

    try {
      await navigator.clipboard.writeText(subtitleText);
      setError("Subtitles copied to clipboard.");
    } catch {
      setError("Failed to copy subtitles. Please try again.");
    }
  }, [subtitleText]);

  const handleDownloadSrt = useCallback(() => {
    if (!subtitleSrtText) {
      setError("No subtitles available to download yet.");
      return;
    }

    const blob = new Blob([subtitleSrtText], { type: "application/x-subrip;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = file?.name ? file.name.replace(/\.[^.]+$/, "") : "khmer-subtitles";
    link.href = downloadUrl;
    link.download = `${baseName}.srt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }, [file, subtitleSrtText]);

  const onDropFile = useCallback((incomingFile?: File) => {
    if (!incomingFile) {
      return;
    }

    const allowed = ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm", "video/x-msvideo"];
    if (!allowed.includes(incomingFile.type)) {
      setError("Unsupported format. Please upload MP4, MOV, MKV, AVI, or WEBM.");
      return;
    }

    setError("");
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(incomingFile);
    previewBlobUrlRef.current = objectUrl;
    setPreviewVideoUrl(objectUrl);
    setResult(null);
    setFile(incomingFile);
  }, []);

  const handlePreviewVoice = useCallback(async () => {
    setError("");
    try {
      const data = await previewVoice({
        text: voicePreviewText,
        voiceName,
        voiceSpeed,
        voiceVolume,
        emotion,
        geminiApiKey: settings.geminiApiKey || undefined
      });

      const absoluteAudioUrl = toAssetUrl(data.audioUrl);
      const audioResponse = await fetch(absoluteAudioUrl, { method: "GET" });
      if (!audioResponse.ok) {
        throw new Error(`Preview audio fetch failed with status ${audioResponse.status}`);
      }

      const audioBlob = await audioResponse.blob();
      if (!audioBlob.size) {
        throw new Error("Preview audio response was empty.");
      }

      const playbackUrl = `${absoluteAudioUrl}${absoluteAudioUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
      setVoicePreviewUrl(playbackUrl);
    } catch (previewError) {
      setError(getApiErrorMessage(previewError, "Voice preview failed."));
    }
  }, [emotion, settings.geminiApiKey, voiceName, voicePreviewText, voiceSpeed, voiceVolume]);

  const handleRun = useCallback(async () => {
    if (!file) {
      setError("Please upload a video before running AI dubbing.");
      return;
    }

    if (!settings.geminiApiKey || !settings.groqApiKey) {
      setError("Please provide both Gemini API Key and Groq API Key in Settings.");
      return;
    }

    setRunning(true);
    setResult(null);
    setError("");

    try {
      const data = await runDubbing({
        file,
        sourceLanguage,
        removeOriginalVoices,
        voiceName,
        voiceSpeed,
        voiceVolume,
        emotion,
        geminiApiKey: settings.geminiApiKey || undefined,
        groqApiKey: settings.groqApiKey || undefined
      });

      setResult(data);
      if (data.voicePreviewUrl) {
        setVoicePreviewUrl(toAssetUrl(data.voicePreviewUrl));
      }
      if (data.videoUrl) {
        if (previewBlobUrlRef.current) {
          URL.revokeObjectURL(previewBlobUrlRef.current);
          previewBlobUrlRef.current = null;
        }
        setPreviewVideoUrl(toAssetUrl(data.videoUrl));
      }
    } catch (runError) {
      setError(getApiErrorMessage(runError, "Processing failed."));
    } finally {
      setRunning(false);
    }
  }, [
    emotion,
    file,
    removeOriginalVoices,
    settings.geminiApiKey,
    settings.groqApiKey,
    sourceLanguage,
    voiceName,
    voiceSpeed,
    voiceVolume
  ]);

  const handleAudioError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleDemucsSetupHelp = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(DEMUCS_SETUP_COMMANDS);
      setError("Demucs macOS setup commands copied. Run them in project root, then restart server.");
    } catch {
      setError(`Demucs macOS setup:\n${DEMUCS_SETUP_COMMANDS}\nRestart server after install.`);
    }
  }, []);

  return (
    <div className={clsx("app-shell", isScrolling && "is-scrolling")}>
      <aside className="sidebar glass-card perf-layer">
        <div className="logo-wrap">
          <div className="logo-mark">K</div>
          <div>
            <p className="logo-title">Khmer Subtitle AI Pro V4</p>
            <p className="logo-sub">AI Dubbing Studio</p>
          </div>
        </div>

        <nav className="menu-list">
          {sidebarItems.map((item) => (
            <button key={item.label} className="menu-item" type="button">
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content-area perf-layer">
        <HeroBanner running={running} onRun={handleRun} />

        <section className="grid-panels perf-layer">
          <article className="glass-card panel perf-layer">
            <h2>
              <UploadCloud size={18} /> Upload Panel
            </h2>
            <div
              className={clsx("drop-zone", dragOver && "drop-zone-active")}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                onDropFile(event.dataTransfer.files?.[0]);
              }}
            >
              <p>{file ? file.name : "Drag & Drop Video"}</p>
              <span>Supports MP4, MOV, MKV, AVI, WEBM</span>
              <input
                type="file"
                accept=".mp4,.mov,.mkv,.avi,.webm"
                onChange={(event) => onDropFile(event.target.files?.[0])}
              />
            </div>
          </article>

          <article className="glass-card panel perf-layer">
            <h2>
              <Headphones size={18} /> Voice Panel
            </h2>
            <div className="form-grid">
              <label>
                Voice
                <select value={voiceName} onChange={(event) => setVoiceName(event.target.value)}>
                  {voiceChoices.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Emotion
                <select value={emotion} onChange={(event) => setEmotion(event.target.value as Emotion)}>
                  <option value="normal">Normal</option>
                  <option value="happy">Happy</option>
                  <option value="sad">Sad</option>
                  <option value="angry">Angry</option>
                  <option value="romantic">Romantic</option>
                </select>
              </label>

              <label>
                Voice Speed ({voiceSpeed.toFixed(2)})
                <input
                  type="range"
                  min={0.5}
                  max={1.8}
                  step={0.05}
                  value={voiceSpeed}
                  onChange={(event) => setVoiceSpeed(Number(event.target.value))}
                />
              </label>

              <label>
                Voice Volume ({voiceVolume.toFixed(0)} dB)
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={voiceVolume}
                  onChange={(event) => setVoiceVolume(Number(event.target.value))}
                />
              </label>
            </div>

            <textarea value={voicePreviewText} onChange={(event) => setVoicePreviewText(event.target.value)} rows={3} />
            <button className="secondary-button" type="button" onClick={handlePreviewVoice}>
              Preview Voice
            </button>
          </article>

          <article className="glass-card panel perf-layer">
            <h2>
              <Languages size={18} /> Workflow Panel
            </h2>
            <ul className="workflow-list">
              {progressSteps.map((step, index) => (
                <motion.li
                  key={step.key}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={clsx("workflow-item", `state-${step.status}`)}
                >
                  <span>{step.label}</span>
                  <strong>{step.status}</strong>
                </motion.li>
              ))}
            </ul>
          </article>

          <article className="glass-card panel wide perf-layer">
            <h2>
              <Video size={18} /> Preview Panel
            </h2>
            <div className="preview-layout">
              <MediaPreview videoSrc={previewVideoUrl} audioSrc={voicePreviewUrl} onAudioError={handleAudioError} />

              <div>
                <h3>Subtitle Preview</h3>
                <div className="subtitle-toolbar">
                  <button
                    type="button"
                    className="secondary-button subtitle-toolbar-button"
                    onClick={handleSubtitleFontIncrease}
                    aria-label="Increase subtitle font size"
                  >
                    A+
                  </button>
                  <button
                    type="button"
                    className="secondary-button subtitle-toolbar-button"
                    onClick={handleSubtitleFontDecrease}
                    aria-label="Decrease subtitle font size"
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    className="secondary-button subtitle-toolbar-button"
                    onClick={handleCopySubtitle}
                  >
                    Copy subtitle
                  </button>
                  <button
                    type="button"
                    className="secondary-button subtitle-toolbar-button"
                    onClick={handleDownloadSrt}
                  >
                    Download SRT
                  </button>
                </div>
                <SubtitleVirtualList subtitles={subtitles} fontSize={subtitleFontSize} />
              </div>
            </div>
          </article>

          <article className="glass-card panel perf-layer">
            <h2>
              <Cog size={18} /> Settings
            </h2>
            <div className="form-grid">
              <label>
                Gemini API Key
                <input
                  type="password"
                  value={settings.geminiApiKey}
                  onChange={(event) => setSettings((state) => ({ ...state, geminiApiKey: event.target.value }))}
                />
              </label>
              <label>
                Groq API Key
                <input
                  type="password"
                  value={settings.groqApiKey}
                  onChange={(event) => setSettings((state) => ({ ...state, groqApiKey: event.target.value }))}
                />
              </label>
              <label>
                Source Language
                <input value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)} />
              </label>
              <label>
                Remove Original Voices
                <input
                  type="checkbox"
                  checked={removeOriginalVoices}
                  onChange={(event) => setRemoveOriginalVoices(event.target.checked)}
                />
              </label>
              <button type="button" className="secondary-button" onClick={handleDemucsSetupHelp}>
                Setup Demucs (macOS)
              </button>
              <p>
                Demucs virtualenv path: .venv-demucs. If unavailable, workflow continues with fallback audio mixing.
              </p>
              <label>
                Target Language
                <input value={settings.language} readOnly />
              </label>
            </div>
          </article>

          <article className="glass-card panel perf-layer">
            <h2>
              <Clapperboard size={18} /> Output Panel
            </h2>
            <div className="output-metrics">
              <p>
                <span>Source Language</span>
                <strong>{result?.sourceLanguage || sourceLanguage}</strong>
              </p>
              <p>
                <span>Target Language</span>
                <strong>Khmer</strong>
              </p>
              <p>
                <span>Duration</span>
                <strong>{result ? `${result.durationSeconds.toFixed(1)}s` : "-"}</strong>
              </p>
              <p>
                <span>Estimated Time</span>
                <strong>{result ? `${result.estimatedSeconds}s` : running ? "Processing..." : "-"}</strong>
              </p>
              <p>
                <span>Status</span>
                <strong>{result?.status || (running ? "running" : "idle")}</strong>
              </p>
              {result?.videoUrl ? (
                <a className="secondary-button" href={toAssetUrl(result.videoUrl)} target="_blank" rel="noreferrer">
                  Export MP4
                </a>
              ) : (
                <button type="button" className="secondary-button" disabled>
                  Export MP4
                </button>
              )}
            </div>
          </article>
        </section>

        {error ? <p className="error-message">{error}</p> : null}
      </main>
    </div>
  );
}

export default App;
