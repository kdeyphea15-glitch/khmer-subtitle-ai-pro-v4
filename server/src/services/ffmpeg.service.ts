import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import fs from "node:fs";
import path from "node:path";

export function configureFfmpeg(): void {
  const staticPath = typeof ffmpegStatic === "string" ? ffmpegStatic : undefined;
  const resolvedPath = staticPath || process.env.FFMPEG_PATH;

  if (resolvedPath && fs.existsSync(resolvedPath)) {
    ffmpeg.setFfmpegPath(resolvedPath);
  }
}

export function runFfmpeg(command: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    command
      .on("start", (commandLine) => {
        console.log(`[FFmpeg] ${commandLine}`);
      })
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

export async function extractAudioFromVideo(videoPath: string, outputAudioPath: string): Promise<void> {
  await runFfmpeg(
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("pcm_s16le")
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .output(outputAudioPath)
  );
}

export async function mergeVoiceWithVideo(
  inputVideoPath: string,
  dubbedAudioPath: string,
  outputVideoPath: string,
  instrumentalAudioPath?: string
): Promise<void> {
  const command = ffmpeg().input(inputVideoPath);

  if (instrumentalAudioPath) {
    await runFfmpeg(
      command
        .input(instrumentalAudioPath)
        .input(dubbedAudioPath)
        .outputOptions([
          "-filter_complex [1:a:0]volume=1.0[instrumental];[2:a:0]volume=1.0[khmer];[instrumental][khmer]amix=inputs=2:duration=first:dropout_transition=2[mixed]",
          "-map 0:v:0",
          "-map [mixed]",
          "-c:v copy",
          "-c:a aac",
          "-shortest",
          "-movflags +faststart"
        ])
        .output(outputVideoPath)
    );
    return;
  }

  await runFfmpeg(
    command
      .input(dubbedAudioPath)
      .outputOptions([
        "-filter_complex [0:a:0]volume=0.35[orig];[1:a:0]volume=1.0[khmer];[orig][khmer]amix=inputs=2:duration=first:dropout_transition=2[mixed]",
        "-map 0:v:0",
        "-map [mixed]",
        "-c:v copy",
        "-c:a aac",
        "-shortest",
        "-movflags +faststart"
      ])
      .output(outputVideoPath)
  );
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(metadata.format.duration ?? 0);
    });
  });
}

export async function getMediaDuration(mediaPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(mediaPath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(metadata.format.duration ?? 0);
    });
  });
}

export async function normalizeToMp3(inputAudioPath: string, outputAudioPath: string): Promise<void> {
  const outputDir = path.dirname(outputAudioPath);
  fs.mkdirSync(outputDir, { recursive: true });

  await runFfmpeg(
    ffmpeg(inputAudioPath)
      .audioCodec("libmp3lame")
      .audioBitrate("192k")
      .output(outputAudioPath)
  );
}

export interface TempoFitResult {
  requestedTempo: number;
  appliedTempo: number;
  targetDuration: number;
  outputDuration: number;
}

export interface TimelineSegmentInput {
  start: number;
  end: number;
  audioPath: string;
}

export async function fitAudioToDurationWithAtempo(
  inputAudioPath: string,
  outputAudioPath: string,
  targetDurationSeconds: number,
  options?: {
    minTempo?: number;
    maxTempo?: number;
    volumeGainDb?: number;
    speedMultiplier?: number;
  }
): Promise<TempoFitResult> {
  const targetDuration = Math.max(0.01, targetDurationSeconds);
  const minTempo = options?.minTempo ?? 0.85;
  const maxTempo = options?.maxTempo ?? 1.25;
  const volumeGainDb = options?.volumeGainDb ?? 0;
  const speedMultiplier = Math.max(0.5, options?.speedMultiplier ?? 1);

  const inputDuration = await getMediaDuration(inputAudioPath);
  if (inputDuration <= 0) {
    throw new Error(`Cannot fit audio with invalid duration: ${inputAudioPath}`);
  }

  const requestedTempo = (inputDuration / targetDuration) * speedMultiplier;
  const appliedTempo = Math.min(maxTempo, Math.max(minTempo, requestedTempo));

  const filters: string[] = [
    `atempo=${appliedTempo.toFixed(5)}`,
    `volume=${volumeGainDb.toFixed(2)}dB`,
    `apad=pad_dur=${targetDuration.toFixed(5)}`,
    `atrim=duration=${targetDuration.toFixed(5)}`
  ];

  await runFfmpeg(
    ffmpeg(inputAudioPath)
      .audioChannels(1)
      .audioFrequency(24000)
      .audioCodec("pcm_s16le")
      .audioFilters(filters)
      .format("wav")
      .output(outputAudioPath)
  );

  const outputDuration = await getMediaDuration(outputAudioPath).catch(() => 0);

  return {
    requestedTempo,
    appliedTempo,
    targetDuration,
    outputDuration
  };
}

export async function generateSilenceAudio(outputAudioPath: string, durationSeconds: number): Promise<void> {
  const duration = Math.max(0.01, durationSeconds);
  fs.mkdirSync(path.dirname(outputAudioPath), { recursive: true });

  await runFfmpeg(
    ffmpeg()
      .input(`anullsrc=r=24000:cl=mono`)
      .inputFormat("lavfi")
      .duration(duration)
      .audioCodec("pcm_s16le")
      .audioChannels(1)
      .audioFrequency(24000)
      .format("wav")
      .output(outputAudioPath)
  );
}

export async function concatenateAudioFiles(inputAudioPaths: string[], outputAudioPath: string): Promise<void> {
  if (!inputAudioPaths.length) {
    throw new Error("Cannot concatenate audio without input files.");
  }

  fs.mkdirSync(path.dirname(outputAudioPath), { recursive: true });

  const concatFilePath = `${outputAudioPath}.concat.txt`;
  const concatContent = inputAudioPaths
    .map((audioPath) => `file '${audioPath.replace(/'/g, "'\\''")}'`)
    .join("\n");

  fs.writeFileSync(concatFilePath, concatContent, "utf8");

  try {
    await runFfmpeg(
      ffmpeg()
        .input(concatFilePath)
        .inputOptions(["-f concat", "-safe 0"])
        .audioCodec("libmp3lame")
        .audioBitrate("192k")
        .output(outputAudioPath)
    );
  } finally {
    if (fs.existsSync(concatFilePath)) {
      fs.rmSync(concatFilePath, { force: true });
    }
  }
}

export async function buildTimelineAudioTrack(
  segments: TimelineSegmentInput[],
  outputAudioPath: string,
  totalDurationSeconds: number,
  tempDir: string
): Promise<void> {
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
  const timelineParts: string[] = [];
  let cursor = 0;

  fs.mkdirSync(tempDir, { recursive: true });

  for (let index = 0; index < sortedSegments.length; index += 1) {
    const segment = sortedSegments[index];
    const gapDuration = Math.max(0, segment.start - cursor);

    if (gapDuration > 0.01) {
      const silencePath = path.join(tempDir, `silence-${index}.wav`);
      await generateSilenceAudio(silencePath, gapDuration);
      timelineParts.push(silencePath);
    }

    timelineParts.push(segment.audioPath);
    cursor = Math.max(cursor, segment.end);
  }

  const tailSilenceDuration = Math.max(0, totalDurationSeconds - cursor);
  if (tailSilenceDuration > 0.01) {
    const tailSilencePath = path.join(tempDir, "silence-tail.wav");
    await generateSilenceAudio(tailSilencePath, tailSilenceDuration);
    timelineParts.push(tailSilencePath);
  }

  if (!timelineParts.length) {
    const fullSilencePath = path.join(tempDir, "silence-full.wav");
    await generateSilenceAudio(fullSilencePath, Math.max(0.1, totalDurationSeconds));
    timelineParts.push(fullSilencePath);
  }

  await concatenateAudioFiles(timelineParts, outputAudioPath);
}
