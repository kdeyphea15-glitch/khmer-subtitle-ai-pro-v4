import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { runDubbingWorkflow } from "../services/workflow.service.js";
import { synthesizeKhmerVoice } from "../services/tts.service.js";

const requestSchema = z.object({
  sourceLanguage: z.string().min(2).default("auto"),
  removeOriginalVoices: z.coerce.boolean().default(false),
  originalVocalVolumePercent: z.coerce.number().min(0).max(30).default(0),
  backgroundAudioVolumePercent: z.coerce.number().min(50).max(120).default(100),
  aiVoiceVolumePercent: z.coerce.number().min(50).max(150).default(100),
  voiceName: z.string().min(3).default("alloy"),
  voiceSpeed: z.coerce.number().min(0.5).max(1.8).default(1),
  voiceVolume: z.coerce.number().min(-12).max(12).default(0),
  emotion: z.enum(["normal", "happy", "sad", "angry", "romantic"]).optional().default("normal"),
  geminiApiKey: z.string().optional(),
  groqApiKey: z.string().optional(),
  openaiApiKey: z.string().optional()
});

const previewSchema = z.object({
  text: z.string().min(1),
  voiceName: z.string().min(3),
  voiceSpeed: z.coerce.number().min(0.5).max(1.8).default(1),
  voiceVolume: z.coerce.number().min(-12).max(12).default(0),
  emotion: z.enum(["normal", "happy", "sad", "angry", "romantic"]).default("normal"),
  geminiApiKey: z.string().optional()
});

export async function runDubbing(req: Request, res: Response): Promise<void> {
  try {
    const uploadedFile = req.file;

    if (!uploadedFile) {
      const error = new Error("Video file is required.");
      console.error("[runDubbing][400] Missing video file");
      console.error("[runDubbing][400] req.body:", req.body);
      console.error("[runDubbing][400] req.files:", (req as Request & { files?: unknown }).files);
      console.error("[runDubbing][400] validation result:", { success: false, reason: "missing video file" });
      console.error("[runDubbing][400] stack:", error.stack);
      res.status(400).json({ success: false, error: error.message });
      return;
    }

    const parsed = requestSchema.safeParse(req.body);

    if (!parsed.success) {
      const error = new Error("Invalid request body.");
      console.error("[runDubbing][400] Request body validation failed");
      console.error("[runDubbing][400] req.body:", req.body);
      console.error("[runDubbing][400] req.files:", (req as Request & { files?: unknown }).files);
      console.error("[runDubbing][400] validation result:", parsed.error.flatten());
      console.error("[runDubbing][400] stack:", error.stack);
      res.status(400).json({ success: false, error: error.message });
      return;
    }

    const payload = parsed.data;

    const result = await runDubbingWorkflow({
      sourceVideoPath: uploadedFile.path,
      sourceFileName: uploadedFile.originalname,
      settings: {
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: "km",
        removeOriginalVoices: payload.removeOriginalVoices,
        originalVocalVolumePercent: payload.originalVocalVolumePercent,
        backgroundAudioVolumePercent: payload.backgroundAudioVolumePercent,
        aiVoiceVolumePercent: payload.aiVoiceVolumePercent,
        geminiApiKey: payload.geminiApiKey || env.GEMINI_API_KEY,
        groqApiKey: payload.groqApiKey || env.GROQ_API_KEY,
        openaiApiKey: payload.openaiApiKey || env.OPENAI_API_KEY
      },
      voice: {
        name: payload.voiceName,
        speed: payload.voiceSpeed,
        volumeGainDb: payload.voiceVolume,
        emotion: payload.emotion
      }
    });

    if (result.status === "failed") {
      res.status(500).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown runDubbing error";
    console.error("[runDubbing][catch] Unhandled error:", error);
    if (error instanceof Error) {
      console.error("[runDubbing][catch] stack:", error.stack);
    }
    res.status(500).json({ success: false, error: message });
  } finally {
    const uploadedFile = req.file;
    if (uploadedFile?.path && fs.existsSync(uploadedFile.path)) {
      fs.rmSync(uploadedFile.path, { force: true });
    }
  }
}

export async function previewVoice(req: Request, res: Response): Promise<void> {
  const parsed = previewSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid preview payload.", details: parsed.error.flatten() });
    return;
  }

  const payload = parsed.data;
  const previewName = `preview-${Date.now()}`;
  const rootDir = path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd();
  const outputBasePath = path.join(rootDir, "exports", previewName);

  console.log(
    `[PreviewVoice] Request received | textLength=${payload.text.length} voice=${payload.voiceName} emotion=${payload.emotion}`
  );

  const synthesized = await synthesizeKhmerVoice(
    payload.text,
    outputBasePath,
    {
      name: payload.voiceName,
      speed: payload.voiceSpeed,
      volumeGainDb: payload.voiceVolume,
      emotion: payload.emotion
    },
    env.OPENAI_API_KEY
  );

  const audioFileName = path.basename(synthesized.filePath);
  const audioUrl = `/exports/${audioFileName}`;

  console.log(
    `[PreviewVoice] Audio generated | file=${audioFileName} mime=${synthesized.mimeType} bytes=${synthesized.byteLength} url=${audioUrl}`
  );

  res.json({ audioUrl });
}
