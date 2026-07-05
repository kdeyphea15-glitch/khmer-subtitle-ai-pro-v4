import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SubtitleCue } from "../types/workflow.js";

interface GeminiTranslationPayload {
  transcript: string;
  subtitles: Array<{ start: number; end: number; text: string }>;
}

interface GeminiTranslationResult {
  translatedTranscript: string;
  translatedSubtitles: Array<{ start: number; end: number; text: string }>;
}

function tryParseJson(text: string): GeminiTranslationResult | null {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(cleaned) as GeminiTranslationResult;
  } catch {
    return null;
  }
}

export async function translateToKhmer(
  transcript: string,
  subtitles: SubtitleCue[],
  geminiApiKey: string
): Promise<{ translatedTranscript: string; translatedSubtitles: SubtitleCue[] }> {
  const client = new GoogleGenerativeAI(geminiApiKey);
  const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

  const payload: GeminiTranslationPayload = {
    transcript,
    subtitles: subtitles.map((cue) => ({ start: cue.start, end: cue.end, text: cue.text }))
  };

  const prompt = [
    "Translate this content to natural Khmer for dubbing.",
    "Preserve meaning and timing.",
    "Return strict JSON only with this shape:",
    '{"translatedTranscript":"...","translatedSubtitles":[{"start":0,"end":1.2,"text":"..."}]}.',
    "Do not include markdown fences.",
    JSON.stringify(payload)
  ].join("\n");

  const response = await model.generateContent(prompt);
  const text = response.response.text();
  const parsed = tryParseJson(text);

  if (!parsed?.translatedTranscript) {
    throw new Error("Gemini response parsing failed.");
  }

  const translatedSubtitles: SubtitleCue[] = (parsed.translatedSubtitles ?? [])
    .filter((cue) => typeof cue.start === "number" && typeof cue.end === "number" && typeof cue.text === "string")
    .map((cue) => ({
      start: cue.start,
      end: cue.end,
      text: cue.text.trim()
    }));

  return {
    translatedTranscript: parsed.translatedTranscript.trim(),
    translatedSubtitles: translatedSubtitles.length ? translatedSubtitles : subtitles
  };
}
