/**
 * Cloudflare Worker deployment of the same app:
 * - static React build served from Workers Static Assets
 * - REST CRUD on Cloudflare D1 (SQL)
 * - WebSocket relay from the browser to the Gemini Live API
 *
 * The Node server in /server is the local/self-hosted variant (Express + PostgreSQL).
 * Both share request validation (server/validation.ts) and the Gemini protocol (server/gemini.ts).
 */
import { buildSetupMessage, createLiveToken, GEMINI_WS_URL, LANGUAGE_PRESETS, parseGeminiMessage, type ClientEvent } from "../server/gemini";
import { createSchema, idSchema, updateSchema } from "../server/validation";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
}

const COLUMNS = `id, title, text, language, duration_ms AS durationMs, created_at AS createdAt, updated_at AS updatedAt`;
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Same schema as migrations/0001. Run once per isolate so a fresh D1 works without a migration step.
let schemaReady: Promise<unknown> | null = null;
function ensureSchema(db: D1Database) {
  schemaReady ??= db
    .batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS transcriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'auto',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (${NOW}),
        updated_at TEXT NOT NULL DEFAULT (${NOW})
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS transcriptions_created_at_idx ON transcriptions (created_at DESC)`),
    ])
    .catch((err) => {
      schemaReady = null;
      throw err;
    });
  return schemaReady;
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/health") return json({ ok: true });
  if (url.pathname === "/api/live-token" && req.method === "POST") {
    if (!env.GEMINI_API_KEY) return json({ error: "Server is missing GEMINI_API_KEY" }, 500);
    const lang = url.searchParams.get("lang") ?? "auto";
    try {
      return json(await createLiveToken(env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-3.5-transcribe-live", lang));
    } catch (err) {
      return json({ error: (err as Error).message }, 502);
    }
  }
  await ensureSchema(env.DB);

  const match = url.pathname.match(/^\/api\/transcriptions(?:\/([^/]+))?\/?$/);
  if (!match) return json({ error: "Not found" }, 404);
  const rawId = match[1];

  if (!rawId) {
    if (req.method === "GET") {
      const q = url.searchParams.get("q")?.trim();
      const stmt = q
        ? env.DB.prepare(
            `SELECT ${COLUMNS} FROM transcriptions WHERE title LIKE ?1 OR text LIKE ?1 ORDER BY created_at DESC LIMIT 200`,
          ).bind(`%${q}%`)
        : env.DB.prepare(`SELECT ${COLUMNS} FROM transcriptions ORDER BY created_at DESC LIMIT 200`);
      const { results } = await stmt.all();
      return json(results);
    }
    if (req.method === "POST") {
      const body = createSchema.safeParse(await readJson(req));
      if (!body.success) return json({ error: body.error.issues[0]?.message }, 400);
      const { title, text, language, durationMs } = body.data;
      const row = await env.DB.prepare(
        `INSERT INTO transcriptions (title, text, language, duration_ms) VALUES (?1, ?2, ?3, ?4) RETURNING ${COLUMNS}`,
      )
        .bind(title, text, language, durationMs)
        .first();
      return json(row, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const id = idSchema.safeParse(rawId);
  if (!id.success) return json({ error: "Invalid id" }, 400);

  if (req.method === "GET") {
    const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM transcriptions WHERE id = ?1`).bind(id.data).first();
    return row ? json(row) : json({ error: "Not found" }, 404);
  }
  if (req.method === "PATCH") {
    const body = updateSchema.safeParse(await readJson(req));
    if (!body.success) return json({ error: body.error.issues[0]?.message }, 400);
    const row = await env.DB.prepare(
      `UPDATE transcriptions SET title = COALESCE(?2, title), text = COALESCE(?3, text), updated_at = ${NOW}
       WHERE id = ?1 RETURNING ${COLUMNS}`,
    )
      .bind(id.data, body.data.title ?? null, body.data.text ?? null)
      .first();
    return row ? json(row) : json({ error: "Not found" }, 404);
  }
  if (req.method === "DELETE") {
    const res = await env.DB.prepare(`DELETE FROM transcriptions WHERE id = ?1`).bind(id.data).run();
    return res.meta.changes ? new Response(null, { status: 204 }) : json({ error: "Not found" }, 404);
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleTranscribe(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  const pair = new WebSocketPair();
  const [clientSide, client] = [pair[0], pair[1]];
  client.accept();

  const send = (event: ClientEvent) => {
    try {
      client.send(JSON.stringify(event));
    } catch {
      /* client already gone */
    }
  };

  if (!env.GEMINI_API_KEY) {
    send({ type: "error", message: "Server is missing GEMINI_API_KEY" });
    client.close(1011, "missing key");
    return new Response(null, { status: 101, webSocket: clientSide });
  }

  const languageCodes = LANGUAGE_PRESETS[url.searchParams.get("lang") ?? "auto"] ?? [];
  // ?debug=1 relays raw upstream traffic to the client for troubleshooting.
  const debug = url.searchParams.get("debug") === "1";
  const dbg = (message: string) => {
    if (debug) client.send(JSON.stringify({ type: "debug", message }));
  };
  const model = env.GEMINI_MODEL || "gemini-3.5-transcribe-live";

  // Workers open outbound WebSockets with fetch + Upgrade header over https.
  const upstreamUrl = `${GEMINI_WS_URL.replace(/^wss:/, "https:")}?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const upstreamRes = await fetch(upstreamUrl, { headers: { Upgrade: "websocket" } });
  const upstream = upstreamRes.webSocket;
  if (!upstream) {
    send({ type: "error", message: `Transcription service refused the connection (${upstreamRes.status})` });
    client.close(1011, "upstream failed");
    return new Response(null, { status: 101, webSocket: clientSide });
  }
  upstream.accept();
  dbg(`upstream connected (${upstreamRes.status}), model ${model}`);

  const pending: ArrayBuffer[] = [];
  let ready = false;
  let stopping = false;

  const bytesToBase64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  };
  const forwardAudio = (buf: ArrayBuffer) =>
    upstream.send(
      JSON.stringify({ realtimeInput: { audio: { data: bytesToBase64(buf), mimeType: "audio/pcm;rate=16000" } } }),
    );

  upstream.addEventListener("message", async (ev) => {
    const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
    dbg(`upstream: ${raw.slice(0, 300)}`);
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    for (const event of parseGeminiMessage(msg)) {
      if (event.type === "ready") {
        ready = true;
        for (const chunk of pending.splice(0)) forwardAudio(chunk);
      }
      send(event);
    }
  });

  upstream.addEventListener("close", (ev) => {
    dbg(`upstream closed ${ev.code} ${ev.reason}`);
    if (!stopping && ev.code !== 1000) {
      send({ type: "error", message: `Transcription service closed (${ev.code}) ${ev.reason}`.trim() });
    }
    send({ type: "closed" });
    try {
      client.close(1000, "done");
    } catch {
      /* already closed */
    }
  });
  upstream.addEventListener("error", (ev) => {
    dbg(`upstream error ${(ev as ErrorEvent).message ?? ""}`);
    send({ type: "error", message: "Transcription service error" });
  });

  client.addEventListener("message", (ev) => {
    if (typeof ev.data !== "string") {
      const buf = ev.data as ArrayBuffer;
      if (ready) forwardAudio(buf);
      else if (pending.length < 100) pending.push(buf);
      return;
    }
    let msg: { type?: string } = {};
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "stop" && !stopping) {
      stopping = true;
      upstream.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      setTimeout(() => {
        try {
          upstream.close(1000, "stop");
        } catch {
          /* already closed */
        }
      }, 1500);
    }
  });

  client.addEventListener("close", () => {
    stopping = true;
    try {
      upstream.close(1000, "client left");
    } catch {
      /* already closed */
    }
  });

  // Send setup only after every listener is attached.
  const setup = JSON.stringify(buildSetupMessage(model, languageCodes));
  upstream.send(setup);
  dbg(`setup sent (${setup.length} bytes)`);

  return new Response(null, { status: 101, webSocket: clientSide });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, env, url);
      if (url.pathname.startsWith("/ws/transcribe")) return await handleTranscribe(req, env, url);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal server error" }, 500);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
