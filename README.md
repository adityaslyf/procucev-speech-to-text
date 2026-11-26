# Speech to Text

Speak in Hindi, English or a mix of both and see the text appear live. Save transcriptions, then edit, search, delete or play them back.

**Live demo:** https://procucev-speech-to-text.aditya-varshneymail.workers.dev (allow the mic and click "Start speaking")

## Stack

- React + Vite frontend
- Gemini Live API (`gemini-3.5-transcribe-live`) for transcription
- Node/Express + PostgreSQL locally, Cloudflare Workers + D1 in the live deployment
- Browser Web Speech API for text to speech

The API key stays on the server. The browser gets a single-use token.

## Run locally

```bash
cp .env.example .env     # add GEMINI_API_KEY
docker compose up -d     # Postgres
npm install
npm run dev              # http://localhost:5173
```

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/transcriptions?q=` | List and search |
| GET | `/api/transcriptions/:id` | Read one |
| POST | `/api/transcriptions` | Create |
| PATCH | `/api/transcriptions/:id` | Update |
| DELETE | `/api/transcriptions/:id` | Delete |
| POST | `/api/live-token` | Single-use Gemini token |

## Tests

```bash
npm test
```
