import fs from "node:fs";
import OpenAI from "openai";
import type { SubtitleCue } from "../types/workflow.js";

interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
}

interface WhisperVerboseResponse {
  text?: string;
  segments?: WhisperSegment[];
}

export interface TranscriptionResult {
  transcript: string;
  subtitles: SubtitleCue[];
}

export async function transcribeAudio(audioPath: string, groqApiKey: string): Promise<TranscriptionResult> {
  const client = new OpenAI({
    apiKey: groqApiKey,
    baseURL: "https://api.groq.com/openai/v1"
  });

  const response = (await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-large-v3-turbo",
    response_format: "verbose_json"
  })) as WhisperVerboseResponse;

  const transcript = response.text?.trim() ?? "";

  const subtitles: SubtitleCue[] = (response.segments ?? [])
    .filter((segment) => typeof segment.start === "number" && typeof segment.end === "number" && segment.text)
    .map((segment) => ({
      start: segment.start as number,
      end: segment.end as number,
      text: (segment.text as string).trim()
    }));

  return {
    transcript,
    subtitles: subtitles.length ? subtitles : [{ start: 0, end: 0, text: transcript }]
  };
}
