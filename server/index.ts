import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { migrate } from "./db.js";
import { transcriptionsRouter } from "./routes.js";
import { attachLiveRelay } from "./liveRelay.js";
import { createLiveToken } from "./gemini.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/transcriptions", transcriptionsRouter);
app.post("/api/live-token", async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
  const lang = typeof req.query.lang === "string" ? req.query.lang : "auto";
  try {
    res.json(await createLiveToken(key, process.env.GEMINI_MODEL || "gemini-3.5-transcribe-live", lang));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Serve the built React app in production.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, "../dist-client");
app.use(express.static(clientDir));
app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(clientDir, "index.html")));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = http.createServer(app);
attachLiveRelay(server);

const port = Number(process.env.PORT) || 3000;

server.listen(port, () => console.log(`Listening on http://localhost:${port}`));

// Live transcription does not need the database, so keep serving even if Postgres is down.
migrate()
  .then(() => console.log("Database ready"))
  .catch((err) => {
    console.error(
      `Database not reachable at DATABASE_URL (${err.code ?? err.message}). ` +
        "History will fail until Postgres is up: run `docker compose up -d` and restart.",
    );
  });
