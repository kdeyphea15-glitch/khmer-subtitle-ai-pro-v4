# Khmer Subtitle AI Pro V4
## AI Dubbing Studio for Khmer

Khmer Subtitle AI Pro V4 is a full-stack AI dubbing application that transforms uploaded video speech into Khmer voice-over and exports a final MP4.

## Core Workflow
1. Upload Video
2. Extract Audio (FFmpeg)
3. Speech Recognition (Groq Whisper)
4. Translate to Khmer (Google Gemini)
5. Generate Khmer AI Voice (Gemini TTS)
6. Replace Original Audio
7. Preview Result
8. Export MP4

## Tech Stack
- Frontend: React + Vite + TypeScript + TailwindCSS + Framer Motion
- Backend: Node.js + Express + TypeScript
- Video: FFmpeg
- AI: Google Gemini API, Groq Whisper API, Gemini TTS

## Project Structure
- client/
- server/
- uploads/
- exports/
- voices/
- assets/
- temp/

## Prerequisites
- Node.js 20+
- npm 10+
- Python 3.9+ (for Demucs vocal separation)
- API keys:
  - Gemini API key
  - Groq API key

## Environment Setup
1. Root optional env:
```bash
cp .env.example .env
```
2. Server env:
```bash
cp server/.env.example server/.env
```
3. Client env:
```bash
cp client/.env.example client/.env
```

Fill `server/.env` with your production keys.

Client runtime:
- `VITE_API_BASE_URL` should point to your deployed backend root or `/api` URL.

Server runtime:
- `PORT` is provided by Railway/Render automatically.
- `CLIENT_ORIGIN` or `CLIENT_ORIGINS` should contain your deployed frontend URL(s).

## Install
```bash
npm install
npm install --prefix client
npm install --prefix server
```

## AI Vocal Separation (Demucs)
- The server automatically checks for `.venv-demucs` in the project root.
- If Demucs exists in that virtual environment, it is used automatically.
- If Demucs is missing, the server logs a clear setup message and continues with fallback audio workflow.
- Enable `Remove Original Voices` in the app to run Demucs (`vocals.wav` + `instrumental.wav`).
- The export will mix `instrumental.wav` with Khmer AI voice while preserving the original video stream.
- If Demucs fails, the workflow logs a clear error and automatically falls back to the standard original-audio mix.

### macOS Demucs Setup (.venv-demucs)
```bash
python3 -m venv .venv-demucs
source .venv-demucs/bin/activate
python3 -m pip install --upgrade pip demucs
```
Restart the server after setup.

## Run Development
```bash
npm run dev
```
- Frontend: http://localhost:5173
- Backend: http://localhost:8080

## Build
```bash
npm run build
```

## Start Production Server
```bash
npm run start
```

## Deployment

### Frontend: Vercel
1. Import the `client/` directory as a Vercel project.
2. Set framework preset to Vite if Vercel does not detect it automatically.
3. Add environment variable:
  - `VITE_API_BASE_URL=https://your-backend-domain/api`
4. Build command:
  - `npm run build`
5. Output directory:
  - `dist`

### Backend: Render
1. Create a new Web Service from this repository.
2. Set root directory to `server`.
3. Build command:
  - `npm install && npm run build`
4. Start command:
  - `npm run start`
5. Add environment variables:
  - `NODE_ENV=production`
  - `CLIENT_ORIGINS=https://your-frontend-domain.vercel.app`
  - `GEMINI_API_KEY=...`
  - `GROQ_API_KEY=...`
6. Optional: include multiple frontend domains in `CLIENT_ORIGINS` using commas.

### Backend: Railway
1. Create a new Railway project from this repository.
2. Deploy the `server/` directory as the Node service.
3. Set environment variables:
  - `NODE_ENV=production`
  - `CLIENT_ORIGINS=https://your-frontend-domain.vercel.app`
  - `GEMINI_API_KEY=...`
  - `GROQ_API_KEY=...`
4. Railway injects `PORT` automatically.

### Deployment Notes
- Frontend and backend should be deployed separately.
- Uploaded/exported media is written to the server filesystem at runtime. On platforms with ephemeral disks, files persist only for the life of the running instance.
- The dubbing workflow, upload, transcription, translation, TTS, and MP4 export continue to use the same API routes and server-side processing in production.

## API Endpoints
- `GET /api/health`
- `POST /api/dubbing/run` (multipart form with `video`)
- `POST /api/dubbing/preview-voice`

## Notes
- Uploaded videos are stored in `uploads/`.
- Exported dubbed videos are stored in `exports/`.
- Generated voice files are stored in `voices/`.
- Temporary audio artifacts are stored in `temp/`.
