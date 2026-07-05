export type Emotion = "normal" | "happy" | "sad" | "angry" | "romantic";

export interface VoiceOptions {
  name: string;
  speed: number;
  volumeGainDb: number;
  emotion: Emotion;
}

export interface DubbingSettings {
  sourceLanguage: string;
  targetLanguage: "km";
  removeOriginalVoices: boolean;
  geminiApiKey?: string;
  groqApiKey?: string;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface ProcessingStep {
  key:
    | "upload"
    | "extract-audio"
    | "separate-vocals"
    | "transcribe"
    | "translate"
    | "generate-voice"
    | "replace-audio"
    | "export";
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  message?: string;
}

export interface DubbingResult {
  jobId: string;
  sourceFileName: string;
  sourceLanguage: string;
  targetLanguage: "Khmer";
  durationSeconds: number;
  estimatedSeconds: number;
  status: "completed" | "failed";
  steps: ProcessingStep[];
  subtitles: SubtitleCue[];
  transcript: string;
  translatedTranscript: string;
  videoUrl?: string;
  voicePreviewUrl?: string;
  error?: string;
}
