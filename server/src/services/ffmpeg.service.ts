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
