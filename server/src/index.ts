import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import type { NextFunction, Request, Response } from "express";
import { env } from "./config/env.js";
import { dubbingRouter } from "./routes/dubbing.routes.js";
import { configureFfmpeg } from "./services/ffmpeg.service.js";

const app = express();

configureFfmpeg();

const rootDir = path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd();
const exportsDir = path.join(rootDir, "exports");
const voicesDir = path.join(rootDir, "voices");

fs.mkdirSync(exportsDir, { recursive: true });
fs.mkdirSync(voicesDir, { recursive: true });

app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = new Set([
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        ...env.clientOrigins
      ]);
      const localhostPortPattern = /^https?:\/\/localhost:\d+$/;

      if (!origin || allowedOrigins.has(origin) || localhostPortPattern.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true
  })
);

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
  });

  next();
});

app.use(express.json({ limit: "15mb" }));
app.use("/exports", express.static(exportsDir));
app.use("/voices", express.static(voicesDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Khmer Subtitle AI Pro V4 Server" });
});

app.use("/api/dubbing", dubbingRouter);

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`ERROR ${_req.method} ${_req.originalUrl}: ${error.message}`);
  res.status(500).json({ error: error.message });
});

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});
