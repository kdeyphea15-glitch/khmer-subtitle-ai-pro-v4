import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Emotion, VoiceOptions } from "../types/workflow.js";
import { getMediaDuration, normalizeToMp3 } from "./ffmpeg.service.js";

const execFileAsync = promisify(execFile);

interface GeminiAudioPart {
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
}

interface GeminiAudioCandidate {
  content?: {
    parts?: GeminiAudioPart[];
  };
}

interface GeminiAudioResponse {
  candidates?: GeminiAudioCandidate[];
}

export interface SynthesizedVoiceResult {
  filePath: string;
  mimeType: string;
  byteLength: number;
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

function mapVoiceName(name: string): string {
  const normalized = name.trim();
  if (normalized === "Khmer Male") {
    return "Puck";
  }
  if (normalized === "Khmer Female") {
    return "Kore";
  }
  return normalized;
}

function buildWavFromPcmS16le(pcmBuffer: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function parseSampleRateFromMimeType(mimeType: string): number {
  const match = mimeType.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : 24000;
}

export async function synthesizeKhmerVoice(
  text: string,
  outputBasePath: string,
  options: VoiceOptions,
  geminiApiKey?: string
): Promise<SynthesizedVoiceResult> {
  console.log(`[TTS] Start | outputBasePath=${outputBasePath}`);

  const geminiResult = await synthesizeWithGemini(text, outputBasePath, options, geminiApiKey).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown Gemini TTS error";
    console.error(`[TTS] Gemini generation failed: ${message}`);
    return null;
  });

  if (geminiResult && (await isPlayableAudio(geminiResult.filePath))) {
    return geminiResult;
  }

  console.warn("[TTS] Gemini audio missing or invalid, attempting free fallback provider.");
  const fallbackResult = await synthesizeWithMacSay(text, outputBasePath).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown fallback TTS error";
    console.error(`[TTS] Fallback generation failed: ${message}`);
    return null;
  });

  if (fallbackResult && (await isPlayableAudio(fallbackResult.filePath))) {
    return fallbackResult;
  }

  throw new Error("TTS audio was not generated");
}

async function synthesizeWithGemini(
  text: string,
  outputBasePath: string,
  options: VoiceOptions,
  geminiApiKey?: string
): Promise<SynthesizedVoiceResult> {
  if (!geminiApiKey) {
    throw new Error("Missing Gemini API key for voice generation.");
  }

  console.log(`[TTS] Starting Gemini TTS | voice=${options.name} emotion=${options.emotion} textLength=${text.length}`);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildPrompt(text, options.emotion)
              }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: mapVoiceName(options.name)
              }
            }
          }
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[TTS] Gemini API failed | status=${response.status} body=${errorText}`);
    throw new Error(`Gemini TTS failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as GeminiAudioResponse;
  const inlineAudio = payload.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  const base64Audio = inlineAudio?.data;
  const sourceMimeType = inlineAudio?.mimeType || "audio/L16;rate=24000";

  if (!base64Audio) {
    console.error("[TTS] Gemini response did not include inline audio data.");
    throw new Error("Gemini TTS response did not contain audio data.");
  }

  const rawAudioBuffer = Buffer.from(base64Audio, "base64");
  let outputBuffer: Uint8Array = rawAudioBuffer;
  let outputMimeType = sourceMimeType;
  let outputExtension = "mp3";

  if (/audio\/mpeg|audio\/mp3/i.test(sourceMimeType)) {
    outputExtension = "mp3";
    outputMimeType = "audio/mpeg";
  } else if (/audio\/wav|audio\/x-wav/i.test(sourceMimeType)) {
    outputExtension = "wav";
    outputMimeType = "audio/wav";
  } else if (/audio\/l16/i.test(sourceMimeType)) {
    const sampleRate = parseSampleRateFromMimeType(sourceMimeType);
    outputBuffer = buildWavFromPcmS16le(rawAudioBuffer, sampleRate, 1);
    outputExtension = "wav";
    outputMimeType = "audio/wav";
  } else {
    outputExtension = "wav";
    outputMimeType = "audio/wav";
  }

  const outputPath = `${outputBasePath}.${outputExtension}`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputBuffer);

  const fileSize = fs.statSync(outputPath).size;

  console.log(
    `[TTS] Audio ready | sourceMime=${sourceMimeType} outputMime=${outputMimeType} bytes=${fileSize} file=${outputPath}`
  );

  return {
    filePath: outputPath,
    mimeType: outputMimeType,
    byteLength: fileSize
  };
}

async function synthesizeWithMacSay(text: string, outputBasePath: string): Promise<SynthesizedVoiceResult> {
  if (process.platform !== "darwin") {
    throw new Error("macOS say fallback is only available on darwin.");
  }

  const aiffPath = `${outputBasePath}.aiff`;
  const mp3Path = `${outputBasePath}.mp3`;

  console.log("[TTS] Fallback start | provider=macOS-say");
  await execFileAsync("say", ["-o", aiffPath, text]);
  await normalizeToMp3(aiffPath, mp3Path);

  if (fs.existsSync(aiffPath)) {
    fs.rmSync(aiffPath, { force: true });
  }

  const fileSize = fs.existsSync(mp3Path) ? fs.statSync(mp3Path).size : 0;
  console.log(`[TTS] Fallback audio ready | file=${mp3Path} bytes=${fileSize}`);

  return {
    filePath: mp3Path,
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
