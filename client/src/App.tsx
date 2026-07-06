import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import axios from "axios";
import { CheckCircle2, Download, Languages, LoaderCircle, Settings2, UploadCloud, Video } from "lucide-react";
import { API_BASE_URL, checkBackendHealth, previewVoice, runDubbing, toAssetUrl } from "./api";
import HeroBanner from "./components/HeroBanner";
import type { DubbingResult, Emotion, SettingsState, SubtitleCue, WorkflowStep } from "./types";

const workflowLabels: WorkflowStep[] = [
  { key: "upload", label: "Upload", status: "pending" },
  { key: "extract-audio", label: "Extract Audio", status: "pending" },
  { key: "separate-vocals", label: "AI Vocal Separation", status: "pending" },
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
const OPENAI_KEY_STORAGE = "khmer-v4-openai-api-key";
const TTS_PROVIDER_STORAGE = "khmer-v4-tts-provider";
const ORIGINAL_VOCAL_VOLUME_STORAGE = "khmer-v4-original-vocal-volume";
const BACKGROUND_VOLUME_STORAGE = "khmer-v4-background-volume";
const AI_VOICE_VOLUME_STORAGE = "khmer-v4-ai-voice-volume";
const SUBTITLE_DEFAULT_FONT_SIZE = 20;
const SUBTITLE_MIN_FONT_SIZE = 16;
const SUBTITLE_MAX_FONT_SIZE = 28;
const SUBTITLE_LINE_HEIGHT = 1.6;
const SUBTITLE_VIEWPORT_HEIGHT = 320;
const SUBTITLE_OVERSCAN = 8;
const TARGET_LANGUAGE = "Khmer";

function readStoredValue(key: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(key) ?? "";
}

function readStoredTtsProvider(): "openai" | "gemini" {
  const value = readStoredValue(TTS_PROVIDER_STORAGE).toLowerCase();
  return value === "gemini" ? "gemini" : "openai";
}

function readStoredNumber(key: string, fallback: number): number {
  const value = Number(readStoredValue(key));
  return Number.isFinite(value) ? value : fallback;
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
        Khmer subtitles will appear here after translation.
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
  const [videoTime, setVideoTime] = useState(0);
  const [audioTime, setAudioTime] = useState(0);

  return (
    <div className="media-preview-grid">
      <article>
        <h3>Video Preview</h3>
        <video
          controls
          preload="metadata"
          src={videoSrc || undefined}
          onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
        />
        <p className="media-progress">Progress: {formatTime(videoTime)}</p>
      </article>

      <article>
        <h3>Voice Preview</h3>
        <audio
          controls
          preload="metadata"
          src={audioSrc || undefined}
          onTimeUpdate={(event) => setAudioTime(event.currentTarget.currentTime)}
          onError={(event) => {
            const mediaErrorCode = event.currentTarget.error?.code;
            onAudioError(`Audio playback failed (code ${mediaErrorCode ?? "unknown"}).`);
          }}
        />
        <p className="media-progress">Progress: {formatTime(audioTime)}</p>
      </article>
    </div>
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
  const [voicePreviewText, setVoicePreviewText] = useState("សូមស្វាគមន៍មកកាន់ Khmer Subtitle AI Pro V4");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DubbingResult | null>(null);
  const [error, setError] = useState("");
  const [healthStatus, setHealthStatus] = useState<"checking" | "online" | "offline">("checking");
  const [subtitleFontSize, setSubtitleFontSize] = useState(SUBTITLE_DEFAULT_FONT_SIZE);

  const previewBlobUrlRef = useRef<string | null>(null);

  const [settings, setSettings] = useState<SettingsState>({
    geminiApiKey: readStoredValue(GEMINI_KEY_STORAGE),
    groqApiKey: readStoredValue(GROQ_KEY_STORAGE),
    openaiApiKey: readStoredValue(OPENAI_KEY_STORAGE),
    ttsProvider: readStoredTtsProvider(),
    originalVocalVolumePercent: readStoredNumber(ORIGINAL_VOCAL_VOLUME_STORAGE, 0),
    backgroundAudioVolumePercent: readStoredNumber(BACKGROUND_VOLUME_STORAGE, 100),
    aiVoiceVolumePercent: readStoredNumber(AI_VOICE_VOLUME_STORAGE, 100)
  });

  const [previewVideoUrl, setPreviewVideoUrl] = useState("");

  useEffect(() => {
    window.localStorage.setItem(GEMINI_KEY_STORAGE, settings.geminiApiKey);
  }, [settings.geminiApiKey]);

  useEffect(() => {
    window.localStorage.setItem(GROQ_KEY_STORAGE, settings.groqApiKey);
  }, [settings.groqApiKey]);

  useEffect(() => {
    window.localStorage.setItem(OPENAI_KEY_STORAGE, settings.openaiApiKey);
  }, [settings.openaiApiKey]);

  useEffect(() => {
    window.localStorage.setItem(TTS_PROVIDER_STORAGE, settings.ttsProvider);
  }, [settings.ttsProvider]);

  useEffect(() => {
    window.localStorage.setItem(ORIGINAL_VOCAL_VOLUME_STORAGE, String(settings.originalVocalVolumePercent));
  }, [settings.originalVocalVolumePercent]);

  useEffect(() => {
    window.localStorage.setItem(BACKGROUND_VOLUME_STORAGE, String(settings.backgroundAudioVolumePercent));
  }, [settings.backgroundAudioVolumePercent]);

  useEffect(() => {
    window.localStorage.setItem(AI_VOICE_VOLUME_STORAGE, String(settings.aiVoiceVolumePercent));
  }, [settings.aiVoiceVolumePercent]);

  useEffect(() => {
    checkBackendHealth()
      .then(() => {
        setHealthStatus("online");
        setError((current) =>
          current.includes("Cannot reach backend") || current.includes("Backend health check") ? "" : current
        );
      })
      .catch((healthError) => {
        setHealthStatus("offline");
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

  const progressSteps = useMemo(() => {
    if (!result) {
      return workflowLabels;
    }

    return workflowLabels.map((step) => result.steps.find((serverStep) => serverStep.key === step.key) || step);
  }, [result]);

  const subtitles = useMemo(() => result?.subtitles ?? [], [result]);

  const providerMissingMessage = useMemo(() => {
    if (settings.ttsProvider === "openai" && !settings.openaiApiKey.trim()) {
      return "OpenAI API Key is required when TTS Provider is OpenAI.";
    }

    if (settings.ttsProvider === "gemini" && !settings.geminiApiKey.trim()) {
      return "Gemini API Key is required when TTS Provider is Gemini.";
    }

    return "";
  }, [settings.geminiApiKey, settings.openaiApiKey, settings.ttsProvider]);

  const canPreviewVoice = useMemo(() => !providerMissingMessage && voicePreviewText.trim().length > 0, [providerMissingMessage, voicePreviewText]);

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
      .map((cue, index) => `${index + 1}\n${toSrtTimestamp(cue.start)} --> ${toSrtTimestamp(cue.end)}\n${cue.text}`)
      .join("\n\n");
  }, [subtitles, toSrtTimestamp]);

  const handleSubtitleFontIncrease = useCallback(() => {
    setSubtitleFontSize((current) => Math.min(SUBTITLE_MAX_FONT_SIZE, current + 2));
  }, []);

  const handleSubtitleFontDecrease = useCallback(() => {
    setSubtitleFontSize((current) => Math.max(SUBTITLE_MIN_FONT_SIZE, current - 2));
  }, []);

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

    if (providerMissingMessage) {
      setError(providerMissingMessage);
      return;
    }

    try {
      const data = await previewVoice({
        text: voicePreviewText,
        ttsProvider: settings.ttsProvider,
        voiceName,
        voiceSpeed,
        voiceVolume: 0,
        emotion,
        geminiApiKey: settings.geminiApiKey || undefined,
        openaiApiKey: settings.openaiApiKey || undefined
      });

      const absoluteAudioUrl = toAssetUrl(data.audioUrl);
      const playbackUrl = `${absoluteAudioUrl}${absoluteAudioUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
      setVoicePreviewUrl(playbackUrl);
    } catch (previewError) {
      setError(getApiErrorMessage(previewError, "Voice preview failed."));
    }
  }, [
    emotion,
    providerMissingMessage,
    settings.geminiApiKey,
    settings.openaiApiKey,
    settings.ttsProvider,
    voiceName,
    voicePreviewText,
    voiceSpeed,
    settings.aiVoiceVolumePercent
  ]);

  const handleRun = useCallback(async () => {
    if (!file) {
      setError("Please upload a video before running dubbing.");
      return;
    }

    if (!settings.geminiApiKey || !settings.groqApiKey) {
      setError("Gemini API Key and Groq API Key are required for translation and transcription.");
      return;
    }

    if (providerMissingMessage) {
      setError(providerMissingMessage);
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
        originalVocalVolumePercent: settings.originalVocalVolumePercent,
        backgroundAudioVolumePercent: settings.backgroundAudioVolumePercent,
        aiVoiceVolumePercent: settings.aiVoiceVolumePercent,
        ttsProvider: settings.ttsProvider,
        voiceName,
        voiceSpeed,
        voiceVolume: 0,
        emotion,
        geminiApiKey: settings.geminiApiKey || undefined,
        groqApiKey: settings.groqApiKey || undefined,
        openaiApiKey: settings.openaiApiKey || undefined
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
      setError(getApiErrorMessage(runError, "Dubbing failed."));
    } finally {
      setRunning(false);
    }
  }, [
    emotion,
    file,
    removeOriginalVoices,
    settings.geminiApiKey,
    settings.groqApiKey,
    settings.openaiApiKey,
    settings.ttsProvider,
    settings.originalVocalVolumePercent,
    settings.backgroundAudioVolumePercent,
    settings.aiVoiceVolumePercent,
    sourceLanguage,
    providerMissingMessage,
    voiceName,
    voiceSpeed
  ]);

  const handleAudioError = useCallback((message: string) => {
    setError(message);
  }, []);

  return (
    <div className="app-shell">
      <main className="content-area">
        <HeroBanner running={running} onRun={handleRun} />

        <section className="layout-grid">
          <article className="panel card upload-panel">
            <h2>
              <UploadCloud size={18} /> Upload Video
            </h2>
            <div className="status-strip" role="status" aria-live="polite">
              <span className={clsx("status-pill", `status-${healthStatus}`)}>
                Backend: {healthStatus === "checking" ? "Checking" : healthStatus === "online" ? "Online" : "Offline"}
              </span>
              <span className="status-pill status-neutral">TTS: {settings.ttsProvider === "openai" ? "OpenAI" : "Gemini"}</span>
            </div>
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
              <p>{file ? file.name : "Drag and drop your video here"}</p>
              <span>Supports MP4, MOV, MKV, AVI, WEBM</span>
              <input
                type="file"
                accept=".mp4,.mov,.mkv,.avi,.webm"
                onChange={(event) => onDropFile(event.target.files?.[0])}
              />
            </div>
          </article>

          <article className="panel card settings-panel">
            <h2>
              <Settings2 size={18} /> Settings
            </h2>

            <div className="settings-grid">
              <label>
                Gemini API Key
                <input
                  type="password"
                  value={settings.geminiApiKey}
                  onChange={(event) => setSettings((state) => ({ ...state, geminiApiKey: event.target.value }))}
                  placeholder="Required for translation"
                />
              </label>

              <label>
                Groq API Key
                <input
                  type="password"
                  value={settings.groqApiKey}
                  onChange={(event) => setSettings((state) => ({ ...state, groqApiKey: event.target.value }))}
                  placeholder="Required for transcription"
                />
              </label>

              <label>
                OpenAI API Key
                <input
                  type="password"
                  value={settings.openaiApiKey}
                  onChange={(event) => setSettings((state) => ({ ...state, openaiApiKey: event.target.value }))}
                  placeholder="Used when TTS Provider is OpenAI"
                />
              </label>

              <label>
                TTS Provider
                <select
                  value={settings.ttsProvider}
                  onChange={(event) =>
                    setSettings((state) => ({ ...state, ttsProvider: event.target.value as "openai" | "gemini" }))
                  }
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>

              <div className="settings-note" role="note">
                <strong>Provider requirement:</strong> {settings.ttsProvider === "openai" ? "OpenAI API Key required" : "Gemini API Key required"}
              </div>

              <label>
                Source Language
                <input value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)} />
              </label>

              <label>
                Target Language
                <input value={TARGET_LANGUAGE} readOnly />
              </label>

              <label className="checkbox-label">
                <span>Remove Original Voices</span>
                <input
                  type="checkbox"
                  checked={removeOriginalVoices}
                  onChange={(event) => setRemoveOriginalVoices(event.target.checked)}
                />
              </label>

              <label>
                Original Vocal Volume ({settings.originalVocalVolumePercent}%)
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={settings.originalVocalVolumePercent}
                  onChange={(event) =>
                    setSettings((state) => ({ ...state, originalVocalVolumePercent: Number(event.target.value) }))
                  }
                />
              </label>

              <label>
                Background Audio Volume ({settings.backgroundAudioVolumePercent}%)
                <input
                  type="range"
                  min={50}
                  max={120}
                  step={1}
                  value={settings.backgroundAudioVolumePercent}
                  onChange={(event) =>
                    setSettings((state) => ({ ...state, backgroundAudioVolumePercent: Number(event.target.value) }))
                  }
                />
              </label>

              <label>
                AI Voice Volume ({settings.aiVoiceVolumePercent}%)
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={1}
                  value={settings.aiVoiceVolumePercent}
                  onChange={(event) =>
                    setSettings((state) => ({ ...state, aiVoiceVolumePercent: Number(event.target.value) }))
                  }
                />
              </label>
            </div>

            <p className="panel-help">
              Tip: Default TTS provider is OpenAI. Keep Gemini and Groq keys filled for full workflow.
            </p>

            {providerMissingMessage ? <p className="inline-warning">{providerMissingMessage}</p> : null}

            <button className="primary-button" type="button" onClick={handleRun} disabled={running || !file}>
              {running ? <LoaderCircle className="spin" size={18} /> : <Languages size={18} />}
              {running ? "Processing..." : "Translate and Dub to Khmer"}
            </button>
          </article>

          <article className="panel card voice-panel">
            <h2>
              <Languages size={18} /> Voice Setup
            </h2>

            <div className="settings-grid">
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
                AI Voice Volume ({settings.aiVoiceVolumePercent}%)
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={1}
                  value={settings.aiVoiceVolumePercent}
                  onChange={(event) =>
                    setSettings((state) => ({ ...state, aiVoiceVolumePercent: Number(event.target.value) }))
                  }
                />
              </label>
            </div>

            <label>
              Preview Text
              <textarea value={voicePreviewText} onChange={(event) => setVoicePreviewText(event.target.value)} rows={3} />
            </label>

            <button className="secondary-button" type="button" onClick={handlePreviewVoice} disabled={!canPreviewVoice}>
              Preview Audio
            </button>
          </article>

          <article className="panel card status-panel">
            <h2>
              <CheckCircle2 size={18} /> Workflow Status
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

          <article className="panel card preview-panel">
            <h2>
              <Video size={18} /> Preview and Subtitles
            </h2>

            <MediaPreview videoSrc={previewVideoUrl} audioSrc={voicePreviewUrl} onAudioError={handleAudioError} />

            <div className="subtitle-toolbar">
              <button type="button" className="secondary-button subtitle-toolbar-button" onClick={handleSubtitleFontIncrease}>
                A+
              </button>
              <button type="button" className="secondary-button subtitle-toolbar-button" onClick={handleSubtitleFontDecrease}>
                A-
              </button>
              <button type="button" className="secondary-button subtitle-toolbar-button" onClick={handleDownloadSrt}>
                Download SRT
              </button>
            </div>

            <SubtitleVirtualList subtitles={subtitles} fontSize={subtitleFontSize} />
          </article>

          <article className="panel card output-panel">
            <h2>
              <Download size={18} /> Output
            </h2>
            <div className="output-metrics">
              <p>
                <span>Source Language</span>
                <strong>{result?.sourceLanguage || sourceLanguage}</strong>
              </p>
              <p>
                <span>Target Language</span>
                <strong>{TARGET_LANGUAGE}</strong>
              </p>
              <p>
                <span>Duration</span>
                <strong>{result ? `${result.durationSeconds.toFixed(1)}s` : "-"}</strong>
              </p>
              <p>
                <span>Status</span>
                <strong>{result?.status || (running ? "running" : "idle")}</strong>
              </p>
            </div>

            {result?.videoUrl ? (
              <a className="primary-button" href={toAssetUrl(result.videoUrl)} target="_blank" rel="noreferrer">
                Download or Export MP4
              </a>
            ) : (
              <button type="button" className="primary-button" disabled>
                Download or Export MP4
              </button>
            )}
          </article>
        </section>

        {error ? <p className="error-message">{error}</p> : null}
      </main>
    </div>
  );
}

export default App;
