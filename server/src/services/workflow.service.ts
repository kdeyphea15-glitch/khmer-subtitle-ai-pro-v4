import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { DubbingResult, DubbingSettings, ProcessingStep, VoiceOptions } from "../types/workflow.js";
import {
  buildTimelineAudioTrack,
  extractAudioFromVideo,
  fitAudioToDurationWithAtempo,
  getVideoDuration,
  mergeVoiceWithVideo
} from "./ffmpeg.service.js";
import { DemucsError, separateVocalsWithDemucs } from "./demucs.service.js";
import { transcribeAudio } from "./transcription.service.js";
import { translateToKhmer } from "./translation.service.js";
import { synthesizeKhmerVoiceForSubtitles } from "./tts.service.js";

const ROOT_DIR = path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd();
const TEMP_DIR = path.join(ROOT_DIR, "temp");
const VOICES_DIR = path.join(ROOT_DIR, "voices");
const EXPORT_DIR = path.join(ROOT_DIR, "exports");

function createSteps(): ProcessingStep[] {
  return [
    { key: "upload", label: "Upload", status: "completed" },
    { key: "extract-audio", label: "Extract Audio", status: "pending" },
    { key: "separate-vocals", label: "AI Vocal Separation (Demucs)", status: "pending" },
    { key: "transcribe", label: "Transcribe", status: "pending" },
    { key: "translate", label: "Translate", status: "pending" },
    { key: "generate-voice", label: "Generate Khmer Voice", status: "pending" },
    { key: "replace-audio", label: "Replace Audio", status: "pending" },
    { key: "export", label: "Export MP4", status: "pending" }
  ];
}

function setStepStatus(
  steps: ProcessingStep[],
  key: ProcessingStep["key"],
  status: ProcessingStep["status"],
  message?: string
): void {
  const step = steps.find((item) => item.key === key);
  if (!step) {
    return;
  }

  step.status = status;
  if (message) {
    step.message = message;
  }
}

export interface WorkflowInput {
  sourceVideoPath: string;
  sourceFileName: string;
  settings: DubbingSettings;
  voice: VoiceOptions;
}

export async function runDubbingWorkflow(input: WorkflowInput): Promise<DubbingResult> {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(VOICES_DIR, { recursive: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const jobId = uuidv4();
  const steps = createSteps();

  const extractedAudioPath = path.join(TEMP_DIR, `${jobId}.wav`);
  const generatedVoiceSegmentsDir = path.join(TEMP_DIR, `${jobId}.segments`);
  const adjustedVoiceSegmentsDir = path.join(TEMP_DIR, `${jobId}.segments-adjusted`);
  const timelineTempDir = path.join(TEMP_DIR, `${jobId}.timeline`);
  const normalizedVoicePath = path.join(EXPORT_DIR, `${jobId}.voice.mp3`);
  const exportedVideoPath = path.join(EXPORT_DIR, `${jobId}.mp4`);
  const demucsTempDir = path.join(TEMP_DIR, `demucs-${jobId}`);
  let instrumentalAudioPath: string | undefined;
  let demucsFallbackWarning: string | undefined;

  try {
    console.log(
      `[Workflow:${jobId}] Starting dubbing | source=${input.sourceFileName} removeOriginalVoices=${input.settings.removeOriginalVoices}`
    );

    const sourceVideoDuration = await getVideoDuration(input.sourceVideoPath).catch(() => 0);

    setStepStatus(steps, "extract-audio", "running");
    await extractAudioFromVideo(input.sourceVideoPath, extractedAudioPath);
    setStepStatus(steps, "extract-audio", "completed");

    if (input.settings.removeOriginalVoices) {
      setStepStatus(steps, "separate-vocals", "running");
      try {
        const separation = await separateVocalsWithDemucs(extractedAudioPath, TEMP_DIR, jobId);
        instrumentalAudioPath = separation.instrumentalPath;
        console.log(
          `[Workflow:${jobId}] Demucs separation success | vocals discarded | instrumental=${separation.instrumentalPath}`
        );
        setStepStatus(steps, "separate-vocals", "completed", "Vocals removed. Using instrumental track.");
      } catch (error) {
        const message = error instanceof DemucsError ? error.message : "Unknown Demucs error";
        console.error(`[Workflow:${jobId}] Demucs separation failed: ${message}`);
        demucsFallbackWarning = `Demucs failed (${message}). Continuing export with original audio fallback volume.`;
        setStepStatus(
          steps,
          "separate-vocals",
          "failed",
          demucsFallbackWarning
        );
      }
    } else {
      setStepStatus(steps, "separate-vocals", "completed", "Skipped (Remove Original Voices is disabled).");
    }

    setStepStatus(steps, "transcribe", "running");
    if (!input.settings.groqApiKey) {
      throw new Error("Missing Groq API key.");
    }

    const transcription = await transcribeAudio(extractedAudioPath, input.settings.groqApiKey);
    setStepStatus(steps, "transcribe", "completed");

    setStepStatus(steps, "translate", "running");
    if (!input.settings.geminiApiKey) {
      throw new Error("Missing Gemini API key.");
    }

    const translated = await translateToKhmer(
      transcription.transcript,
      transcription.subtitles,
      input.settings.geminiApiKey
    );
    setStepStatus(steps, "translate", "completed");

    setStepStatus(steps, "generate-voice", "running");
    console.log(`[Workflow:${jobId}] Generating Khmer subtitle segments`);

    const synthesizedSegments = await synthesizeKhmerVoiceForSubtitles(
      translated.translatedSubtitles,
      generatedVoiceSegmentsDir,
      input.voice,
      input.settings.openaiApiKey
    );

    if (!synthesizedSegments.length) {
      throw new Error("No subtitle segments available for TTS generation.");
    }

    fs.mkdirSync(adjustedVoiceSegmentsDir, { recursive: true });
    const timelineSegments: Array<{ start: number; end: number; audioPath: string }> = [];

    for (const segment of synthesizedSegments) {
      const targetDuration = Math.max(0.01, segment.end - segment.start);
      const adjustedSegmentPath = path.join(adjustedVoiceSegmentsDir, `segment-${String(segment.index).padStart(4, "0")}.wav`);
      const fitResult = await fitAudioToDurationWithAtempo(segment.voice.filePath, adjustedSegmentPath, targetDuration, {
        minTempo: 0.85,
        maxTempo: 1.25,
        volumeGainDb: input.voice.volumeGainDb,
        speedMultiplier: input.voice.speed
      });

      console.log(
        `[Workflow:${jobId}] Segment ${segment.index} fit | start=${segment.start.toFixed(2)} end=${segment.end.toFixed(2)} requestedTempo=${fitResult.requestedTempo.toFixed(3)} appliedTempo=${fitResult.appliedTempo.toFixed(3)} outDuration=${fitResult.outputDuration.toFixed(3)}`
      );

      timelineSegments.push({
        start: segment.start,
        end: segment.end,
        audioPath: adjustedSegmentPath
      });
    }

    await buildTimelineAudioTrack(
      timelineSegments,
      normalizedVoicePath,
      sourceVideoDuration > 0 ? sourceVideoDuration : timelineSegments[timelineSegments.length - 1].end,
      timelineTempDir
    );

    console.log(`[Workflow:${jobId}] Voice normalized to ${normalizedVoicePath}`);
    setStepStatus(steps, "generate-voice", "completed");

    setStepStatus(steps, "replace-audio", "running");
    const originalVocalVolume =
      input.settings.removeOriginalVoices && !instrumentalAudioPath
        ? input.settings.originalVocalVolumePercent / 100
        : input.settings.removeOriginalVoices
          ? input.settings.originalVocalVolumePercent / 100
          : input.settings.backgroundAudioVolumePercent / 100;

    if (demucsFallbackWarning) {
      console.warn(`[Workflow:${jobId}] ${demucsFallbackWarning} originalVolume=${originalVocalVolume.toFixed(3)}`);
    }

    await mergeVoiceWithVideo(input.sourceVideoPath, normalizedVoicePath, exportedVideoPath, instrumentalAudioPath, {
      originalVocalVolume,
      backgroundAudioVolume: input.settings.backgroundAudioVolumePercent / 100,
      aiVoiceVolume: input.settings.aiVoiceVolumePercent / 100
    });
    setStepStatus(steps, "replace-audio", "completed");

    setStepStatus(steps, "export", "running");
    const durationSeconds = await getVideoDuration(exportedVideoPath);
    setStepStatus(steps, "export", "completed");

    const result: DubbingResult = {
      jobId,
      sourceFileName: input.sourceFileName,
      sourceLanguage: input.settings.sourceLanguage,
      targetLanguage: "Khmer",
      durationSeconds,
      estimatedSeconds: Math.max(45, Math.ceil(durationSeconds * 1.2)),
      status: "completed",
      steps,
      subtitles: translated.translatedSubtitles,
      transcript: transcription.transcript,
      translatedTranscript: translated.translatedTranscript,
      videoUrl: `/exports/${path.basename(exportedVideoPath)}`,
      voicePreviewUrl: `/exports/${path.basename(normalizedVoicePath)}`
    };

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown dubbing error";

    const runningStep = steps.find((step) => step.status === "running");
    if (runningStep) {
      runningStep.status = "failed";
      runningStep.message = message;
    }

    return {
      jobId,
      sourceFileName: input.sourceFileName,
      sourceLanguage: input.settings.sourceLanguage,
      targetLanguage: "Khmer",
      durationSeconds: 0,
      estimatedSeconds: 0,
      status: "failed",
      steps,
      subtitles: [],
      transcript: "",
      translatedTranscript: "",
      error: message
    };
  } finally {
    if (fs.existsSync(extractedAudioPath)) {
      fs.rmSync(extractedAudioPath, { force: true });
    }
    const cleanupPaths = [
      path.join(TEMP_DIR, `${jobId}.vocals.wav`),
      path.join(TEMP_DIR, `${jobId}.instrumental.wav`),
      demucsTempDir,
      generatedVoiceSegmentsDir,
      adjustedVoiceSegmentsDir,
      timelineTempDir
    ];
    for (const cleanupPath of cleanupPaths) {
      if (fs.existsSync(cleanupPath)) {
        fs.rmSync(cleanupPath, { force: true, recursive: true });
      }
    }
    if (fs.existsSync(TEMP_DIR)) {
      const generatedVoiceFiles = fs
        .readdirSync(TEMP_DIR)
        .filter((fileName) => fileName.startsWith(`${jobId}.tts.`) || fileName.startsWith(`${jobId}.segment.`));
      for (const fileName of generatedVoiceFiles) {
        fs.rmSync(path.join(TEMP_DIR, fileName), { force: true });
      }
    }
  }
}
