import axios from "axios";
import type { DubbingResult, Emotion, TtsProvider } from "./types";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function stripApiSuffix(value: string): string {
  return value.replace(/\/api$/i, "");
}

const configuredApiBase = trimTrailingSlashes(import.meta.env.VITE_API_BASE_URL?.trim() || "");
const fallbackBase = typeof window !== "undefined" ? window.location.origin : "";
const resolvedBase = configuredApiBase || fallbackBase;

export const API_BASE_URL = stripApiSuffix(resolvedBase);
const API_PREFIX = /\/api$/i.test(resolvedBase) ? resolvedBase : `${API_BASE_URL}/api`;

const api = axios.create({
  baseURL: API_PREFIX,
  timeout: 1000 * 60 * 15
});

export interface RunDubbingPayload {
  file: File;
  sourceLanguage: string;
  removeOriginalVoices: boolean;
  originalVocalVolumePercent: number;
  backgroundAudioVolumePercent: number;
  aiVoiceVolumePercent: number;
  ttsProvider: TtsProvider;
  voiceName?: string;
  voiceSpeed: number;
  voiceVolume: number;
  emotion: Emotion;
  geminiApiKey?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
}

export async function runDubbing(payload: RunDubbingPayload): Promise<DubbingResult> {
  const form = new FormData();

  const normalizedSourceLanguage = payload.sourceLanguage?.trim() || "auto";
  const normalizedVoiceName = payload.voiceName?.trim() || "alloy";
  const normalizedVoiceSpeed = String(payload.voiceSpeed ?? 1);
  const normalizedVoiceVolume = String(payload.voiceVolume ?? 0);
  const normalizedEmotion = payload.emotion || "normal";
  const normalizedRemoveOriginalVoices = String(payload.removeOriginalVoices ?? false);
  const normalizedOriginalVocalVolumePercent = String(payload.originalVocalVolumePercent ?? 0);
  const normalizedBackgroundAudioVolumePercent = String(payload.backgroundAudioVolumePercent ?? 100);
  const normalizedAiVoiceVolumePercent = String(payload.aiVoiceVolumePercent ?? 100);

  form.append("video", payload.file);
  form.append("sourceLanguage", normalizedSourceLanguage);
  form.append("removeOriginalVoices", normalizedRemoveOriginalVoices);
  form.append("originalVocalVolumePercent", normalizedOriginalVocalVolumePercent);
  form.append("backgroundAudioVolumePercent", normalizedBackgroundAudioVolumePercent);
  form.append("aiVoiceVolumePercent", normalizedAiVoiceVolumePercent);
  form.append("voiceName", normalizedVoiceName);
  form.append("voiceSpeed", normalizedVoiceSpeed);
  form.append("voiceVolume", normalizedVoiceVolume);
  form.append("emotion", normalizedEmotion);
  form.append("ttsProvider", payload.ttsProvider);

  const geminiApiKey = payload.geminiApiKey?.trim();
  const groqApiKey = payload.groqApiKey?.trim();
  const openaiApiKey = payload.openaiApiKey?.trim();

  if (geminiApiKey) {
    form.append("geminiApiKey", geminiApiKey);
  }
  if (groqApiKey) {
    form.append("groqApiKey", groqApiKey);
  }
  if (openaiApiKey) {
    form.append("openaiApiKey", openaiApiKey);
  }

  console.log("[runDubbing] FormData keys:", Array.from(form.keys()));

  const { data } = await api.post<DubbingResult>("/dubbing/run", form, {
    headers: {
      "Content-Type": "multipart/form-data"
    }
  });

  return data;
}

export async function previewVoice(payload: {
  text: string;
  ttsProvider: TtsProvider;
  voiceName?: string;
  voiceSpeed: number;
  voiceVolume: number;
  emotion: Emotion;
  geminiApiKey?: string;
  openaiApiKey?: string;
}): Promise<{ audioUrl: string }> {
  const requestPayload = {
    ...payload,
    ...(payload.voiceName?.trim() ? { voiceName: payload.voiceName.trim() } : {})
  };
  const { data } = await api.post<{ audioUrl: string }>("/dubbing/preview-voice", requestPayload);
  return data;
}

export async function checkBackendHealth(): Promise<{ ok: boolean; service: string }> {
  const { data } = await api.get<{ ok: boolean; service: string }>("/health");
  return data;
}

export function toAssetUrl(pathValue: string): string {
  if (/^https?:\/\//i.test(pathValue)) {
    return pathValue;
  }

  return `${API_BASE_URL}${pathValue}`;
}
