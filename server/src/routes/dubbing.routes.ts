import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { previewVoice, runDubbing } from "../controllers/dubbing.controller.js";

const rootDir = path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd();
const uploadsDir = path.resolve(rootDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 1024 * 1024 * 1024
  },
  fileFilter: (_, file, callback) => {
    const allowedExtensions = [".mp4", ".mov", ".mkv", ".avi", ".webm"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      callback(new Error("Unsupported file format."));
      return;
    }

    callback(null, true);
  }
});

export const dubbingRouter = Router();

dubbingRouter.post("/run", upload.single("video"), runDubbing);
dubbingRouter.post("/preview-voice", previewVoice);
