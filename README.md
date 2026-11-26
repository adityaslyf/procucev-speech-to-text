# Speech to Text: real-time multilingual transcription

A web app where you speak, Hindi, English or a mix of both in the same sentence, and see the words appear live as you talk. Finished transcriptions are saved in a SQL database (PostgreSQL locally, Cloudflare D1 in the live deployment) and managed from a history dashboard with full CRUD, search and read-aloud playback.

Built for the Procucev AI Tech Hiring Assignment (Assignment 1: Real-time Transcription).

**Live demo:** https://procucev-speech-to-text.aditya-varshneymail.workers.dev
(deployed on Cloudflare Workers with a D1 database; allow microphone access and click "Start speaking")

## Features

- **Live transcription while you speak**, with greyed interim words that get replaced by the final text when you pause
- **Multilingual and code-switching**: auto-detect mode handles Hinglish like "Mera naam Aditya hai and I build web apps". You can also bias it to Hindi, English (India) or Hindi plus English.
- **History dashboard backed by Postgres**: create (save), read (list and search), update (edit title or text) and delete
- **Text to speech**: "Read aloud" and "Play" use the browser's built-in Web Speech API. It runs on device, needs no key, and picks a Hindi voice for Devanagari text.
- **API key stays on the server**: the browser never talks to Gemini directly
- Mic level meter, connection states and error messages in the UI

## Architecture

```
Browser (React)                                   Node server (Express + ws)                  Gemini Live API
--------------------------------------------      ------------------------------------         -------------------------
mic -> AudioWorklet -> 16 kHz PCM16, 100 ms  -->  /ws/transcribe relay (adds API key)   -->    gemini-3.5-transcribe-live
live transcript UI                           <--  {interim | final | error} JSON       <--    interim / final transcription
history dashboard  --REST /api/transcriptions-->  zod validation -> pg -> PostgreSQL
```

- `client/public/pcm-worklet.js`: resamples the mic stream (44.1 or 48 kHz Float32) to 16 kHz 16-bit PCM in 100 ms chunks, which is the format the Live API expects
- `server/liveRelay.ts`: one upstream Gemini Live session per browser connection. It sends the setup message, buffers audio until `setupComplete`, forwards audio as `realtimeInput.audio`, and relays `interimInputTranscription` and `inputTranscription`. On stop it sends `audioStreamEnd` and waits briefly for the last final transcript.
- `server/routes.ts` and `server/db.ts`: REST CRUD with input validation and parameterised SQL. The table is created on startup.

### Why Gemini Live transcription

The assignment suggests the Gemini Live free API. `gemini-3.5-transcribe-live` is Google's dedicated low-latency speech recognition model on the Live API. It supports automatic language detection, including code-switching, and lists `hi-IN` and `en-IN`. The model name is configurable through `GEMINI_MODEL`, so it can be swapped without code changes.

### How the browser reaches Gemini without seeing the API key

The browser first calls `POST /api/live-token`. The server uses the real key to mint a **single-use ephemeral token** that expires in 30 minutes (Gemini `auth_tokens` API). The browser then opens the Gemini Live WebSocket directly with that token. This is Google's recommended pattern for web clients: the key never leaves the server, and audio takes the shortest path.

If token minting is unavailable, the client falls back to the server's own `/ws/transcribe` relay, which forwards audio with the key attached. The Node server supports both paths.

## API

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/transcriptions?q=` | | List, newest first, optional search on title or text |
| GET | `/api/transcriptions/:id` | | Read one |
| POST | `/api/transcriptions` | `{ title, text, language?, durationMs? }` | Create |
| PATCH | `/api/transcriptions/:id` | `{ title?, text? }` | Update |
| DELETE | `/api/transcriptions/:id` | | Delete, returns 204 |
| POST | `/api/live-token?lang=auto\|hi-en\|hi\|en` | | Single-use Gemini Live token for the browser |
| WS | `/ws/transcribe?lang=auto\|hi-en\|hi\|en` | binary PCM16 frames, then `{"type":"stop"}` | Server relay (fallback) |

## Run locally

Requirements: Node 20+, Docker (for Postgres) and a free Gemini API key from https://aistudio.google.com/apikey

```bash
cp .env.example .env          # add GEMINI_API_KEY
docker compose up -d          # Postgres on :5432
npm install
npm run dev                   # client on http://localhost:5173, API on :3000
```

Open http://localhost:5173, allow the microphone and click **Start speaking**.

Production build: `npm run build && npm start`, which serves everything on `PORT`.

## Tests

```bash
npm test        # unit tests: Gemini message parsing, setup message, PCM resampler
npm run typecheck
```

## Deploy

### Cloudflare Workers (live deployment)

`worker/index.ts` runs the same app on Cloudflare:

- the React build is served from Workers Static Assets
- REST CRUD runs on **Cloudflare D1**, Cloudflare's SQL database, with schema in `migrations/`
- `/api/live-token` mints the single-use Gemini token for the browser, and `/ws/transcribe` is the relay fallback

The Worker and the Node server share request validation (`server/validation.ts`) and the Gemini protocol code (`server/gemini.ts`), so behaviour is identical. Only the storage driver differs: D1 on Cloudflare, PostgreSQL locally or self-hosted.

```bash
npx wrangler d1 migrations apply procucev-speech-to-text --remote
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

### Node + PostgreSQL anywhere

`render.yaml` deploys the Node server with a free Postgres on Render. A `Dockerfile` is included for any container host such as Railway, Fly.io or Cloud Run.

## Limitations and next steps

- One Gemini Live session lasts up to 10 minutes. Longer recordings would need session resumption.
- Text to speech uses the browser's voices, so quality depends on the OS. Swapping in an open-source model such as Piper or Coqui XTTS on the server would give consistent voices.
- No auth: every visitor sees the same history. Adding users would be the next step for a real deployment.
