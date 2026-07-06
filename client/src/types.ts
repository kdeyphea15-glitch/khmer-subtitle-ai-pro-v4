export type Emotion = "normal" | "happy" | "sad" | "angry" | "romantic";
export type TtsProvider = "openai" | "gemini";

export interface WorkflowStep {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  message?: string;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface DubbingResult {
  jobId: string;
  sourceFileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  durationSeconds: number;
  estimatedSeconds: number;
  status: "completed" | "failed";
  steps: WorkflowStep[];
  subtitles: SubtitleCue[];
  transcript: string;
  translatedTranscript: string;
  videoUrl?: string;
  voicePreviewUrl?: string;
  error?: string;
}

export interface SettingsState {
  geminiApiKey: string;
  groqApiKey: string;
  openaiApiKey: string;
  ttsProvider: TtsProvider;
  originalVocalVolumePercent: number;
  backgroundAudioVolumePercent: number;
  aiVoiceVolumePercent: number;
}
