import axios from "axios";
import type { DubbingResult, Emotion } from "./types";

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
  voiceName: string;
  voiceSpeed: number;
  voiceVolume: number;
  emotion: Emotion;
  geminiApiKey?: string;
  groqApiKey?: string;
}

export async function runDubbing(payload: RunDubbingPayload): Promise<DubbingResult> {
  const form = new FormData();
  form.append("video", payload.file);
  form.append("sourceLanguage", payload.sourceLanguage);
  form.append("removeOriginalVoices", String(payload.removeOriginalVoices));
  form.append("voiceName", payload.voiceName);
  form.append("voiceSpeed", String(payload.voiceSpeed));
  form.append("voiceVolume", String(payload.voiceVolume));
  form.append("emotion", payload.emotion);

  if (payload.geminiApiKey) {
    form.append("geminiApiKey", payload.geminiApiKey);
  }
  if (payload.groqApiKey) {
    form.append("groqApiKey", payload.groqApiKey);
  }

  const { data } = await api.post<DubbingResult>("/dubbing/run", form, {
    headers: {
      "Content-Type": "multipart/form-data"
    }
  });

  return data;
}

export async function previewVoice(payload: {
  text: string;
  voiceName: string;
  voiceSpeed: number;
  voiceVolume: number;
  emotion: Emotion;
  geminiApiKey?: string;
}): Promise<{ audioUrl: string }> {
  const { data } = await api.post<{ audioUrl: string }>("/dubbing/preview-voice", payload);
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
