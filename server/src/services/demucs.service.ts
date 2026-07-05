import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface DemucsSeparationResult {
  vocalsPath: string;
  instrumentalPath: string;
}

export class DemucsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemucsError";
  }
}

function getRootDir(): string {
  return path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd();
}

function getDemucsVenvPythonPath(): string | undefined {
  const rootDir = getRootDir();
  const venvDir = path.join(rootDir, ".venv-demucs");
  const candidates = [path.join(venvDir, "bin", "python3"), path.join(venvDir, "bin", "python")];

  return candidates.find((candidatePath) => fs.existsSync(candidatePath));
}

function getMissingDemucsMessage(): string {
  return [
    "Demucs is unavailable: expected a Python virtual environment at .venv-demucs with Demucs installed.",
    "macOS setup:",
    "1) python3 -m venv .venv-demucs",
    "2) source .venv-demucs/bin/activate",
    "3) python3 -m pip install --upgrade pip demucs",
    "4) Restart the server"
  ].join(" ");
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(`[Demucs] ${String(chunk)}`);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[Demucs] ${String(chunk)}`);
    });

    child.on("error", (error) => {
      reject(new DemucsError(`Failed to start Demucs process: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new DemucsError(
          `Demucs exited with code ${code}. ${getMissingDemucsMessage()}`
        )
      );
    });
  });
}

function verifyDemucsImport(pythonPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ["-c", "import demucs"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new DemucsError(`Failed to run Python from .venv-demucs: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const details = stderr.trim();
      reject(
        new DemucsError(
          `Demucs module not found in .venv-demucs. ${getMissingDemucsMessage()}${details ? ` Details: ${details}` : ""}`
        )
      );
    });
  });
}

export async function separateVocalsWithDemucs(
  inputAudioPath: string,
  tempDir: string,
  jobId: string
): Promise<DemucsSeparationResult> {
  const demucsPythonPath = getDemucsVenvPythonPath();
  if (!demucsPythonPath) {
    throw new DemucsError(getMissingDemucsMessage());
  }

  await verifyDemucsImport(demucsPythonPath);

  const demucsOutputDir = path.join(tempDir, `demucs-${jobId}`);
  fs.mkdirSync(demucsOutputDir, { recursive: true });

  console.log(`[Demucs:${jobId}] Starting separation for ${inputAudioPath} using ${demucsPythonPath}`);

  await runCommand(demucsPythonPath, [
    "-m",
    "demucs.separate",
    "-n",
    "htdemucs",
    "--two-stems=vocals",
    "-o",
    demucsOutputDir,
    inputAudioPath
  ]);

  const inputBaseName = path.parse(inputAudioPath).name;
  const rawVocalsPath = path.join(demucsOutputDir, "htdemucs", inputBaseName, "vocals.wav");
  const rawInstrumentalPath = path.join(demucsOutputDir, "htdemucs", inputBaseName, "no_vocals.wav");

  if (!fs.existsSync(rawVocalsPath) || !fs.existsSync(rawInstrumentalPath)) {
    throw new DemucsError(
      "Demucs completed but expected output files were not found (vocals.wav / no_vocals.wav)."
    );
  }

  const vocalsPath = path.join(tempDir, `${jobId}.vocals.wav`);
  const instrumentalPath = path.join(tempDir, `${jobId}.instrumental.wav`);

  fs.copyFileSync(rawVocalsPath, vocalsPath);
  fs.copyFileSync(rawInstrumentalPath, instrumentalPath);

  console.log(
    `[Demucs:${jobId}] Separation completed | vocals=${vocalsPath} instrumental=${instrumentalPath}`
  );

  return {
    vocalsPath,
    instrumentalPath
  };
}
