import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { Emotion, SubtitleCue, VoiceOptions } from "../types/workflow.js";
import { getMediaDuration } from "./ffmpeg.service.js";

export interface SynthesizedVoiceResult {
  filePath: string;
  mimeType: string;
  byteLength: number;
}

export interface SynthesizedSubtitleSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  voice: SynthesizedVoiceResult;
}

const emotionStyles: Record<Emotion, string> = {
  normal: "neutral and clear",
  happy: "warm, positive, and energetic",
  sad: "gentle, calm, and softer",
  angry: "firm and intense without shouting",
  romantic: "soft, intimate, and expressive"
};

function buildPrompt(text: string, emotion: Emotion): string {
  return [
    "Speak the following script in Khmer.",
    "Keep pronunciation natural for Khmer native listeners.",
    `Style: ${emotionStyles[emotion]}.`,
    "Script:",
    text
  ].join("\n");
}

function mapVoiceNameToOpenAi(name: string): string {
  const normalized = name.trim().toLowerCase();

  if (!normalized || normalized === "khmer male" || normalized === "khmer female") {
    return "alloy";
  }

  const supportedVoices = new Set([
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "onyx",
    "nova",
    "sage",
    "shimmer"
  ]);

  return supportedVoices.has(normalized) ? normalized : "alloy";
}

export async function synthesizeKhmerVoice(
  text: string,
  outputBasePath: string,
  options: VoiceOptions,
  openaiApiKey?: string
): Promise<SynthesizedVoiceResult> {
  console.log(`[TTS] Start | outputBasePath=${outputBasePath}`);

  const openAiResult = await synthesizeWithOpenAi(text, outputBasePath, options, openaiApiKey).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown OpenAI TTS error";
    console.error(`[TTS] OpenAI generation failed: ${message}`);
    throw new Error(`OpenAI TTS failed: ${message}`);
  });

  if (openAiResult && (await isPlayableAudio(openAiResult.filePath))) {
    return openAiResult;
  }

  throw new Error("OpenAI TTS failed: generated audio is empty or invalid.");
}

export async function synthesizeKhmerVoiceForSubtitles(
  subtitles: SubtitleCue[],
  outputDir: string,
  options: VoiceOptions,
  openaiApiKey?: string
): Promise<SynthesizedSubtitleSegment[]> {
  fs.mkdirSync(outputDir, { recursive: true });

  const validSubtitles = subtitles
    .map((subtitle, index) => ({ subtitle, index }))
    .filter(({ subtitle }) => subtitle.end > subtitle.start && subtitle.text.trim().length > 0);

  const synthesizedSegments: SynthesizedSubtitleSegment[] = [];

  for (const { subtitle, index } of validSubtitles) {
    const basePath = path.join(outputDir, `segment-${String(index).padStart(4, "0")}`);
    const voice = await synthesizeKhmerVoice(subtitle.text, basePath, options, openaiApiKey);

    synthesizedSegments.push({
      index,
      start: subtitle.start,
      end: subtitle.end,
      text: subtitle.text,
      voice
    });
  }

  return synthesizedSegments;
}

async function synthesizeWithOpenAi(
  text: string,
  outputBasePath: string,
  options: VoiceOptions,
  openaiApiKey?: string
): Promise<SynthesizedVoiceResult> {
  if (!openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY for voice generation.");
  }

  const client = new OpenAI({ apiKey: openaiApiKey });
  const mappedVoice = mapVoiceNameToOpenAi(options.name);
  const instructions = `Speak naturally in Khmer. Style: ${emotionStyles[options.emotion]}.`;

  console.log(`[TTS] Starting OpenAI TTS | voice=${mappedVoice} emotion=${options.emotion} textLength=${text.length}`);

  const response = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: mappedVoice,
    input: text,
    response_format: "mp3",
    instructions
  });

  const outputPath = `${outputBasePath}.mp3`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const audioBuffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, audioBuffer);

  const fileSize = fs.statSync(outputPath).size;

  console.log(`[TTS] Audio ready | outputMime=audio/mpeg bytes=${fileSize} file=${outputPath}`);

  return {
    filePath: outputPath,
    mimeType: "audio/mpeg",
    byteLength: fileSize
  };
}

async function isPlayableAudio(filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const size = fs.statSync(filePath).size;
  if (!size) {
    return false;
  }

  const duration = await getMediaDuration(filePath).catch(() => 0);
  console.log(`[TTS] Validation | file=${filePath} size=${size} duration=${duration}`);
  return duration > 0;
}
