import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { buildSetupMessage, GEMINI_WS_URL, LANGUAGE_PRESETS, parseGeminiMessage, type ClientEvent } from "./gemini.js";

export { buildSetupMessage, LANGUAGE_PRESETS, parseGeminiMessage };

/**
 * Browser <-> server <-> Gemini Live relay.
 *
 * The browser streams raw 16 kHz mono PCM16 frames as binary WebSocket messages.
 * We forward them to the Gemini Live API (model: gemini-3.5-transcribe-live) and
 * relay back interim and final transcriptions. The API key never reaches the browser.
 */

function send(ws: WebSocket, event: ClientEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}

function handleClient(client: WebSocket, req: IncomingMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-transcribe-live";
  if (!apiKey) {
    send(client, { type: "error", message: "Server is missing GEMINI_API_KEY" });
    client.close();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const languageCodes = LANGUAGE_PRESETS[url.searchParams.get("lang") ?? "auto"] ?? [];

  const upstream = new WebSocket(`${process.env.GEMINI_WS_URL || GEMINI_WS_URL}?key=${encodeURIComponent(apiKey)}`);
  const pending: Buffer[] = []; // audio captured before Gemini finished setup
  let ready = false;
  let stopping = false;

  const forwardAudio = (chunk: Buffer) => {
    upstream.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: chunk.toString("base64"), mimeType: "audio/pcm;rate=16000" },
        },
      }),
    );
  };

  upstream.on("open", () => {
    upstream.send(JSON.stringify(buildSetupMessage(model, languageCodes)));
  });

  upstream.on("message", (data: RawData) => {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    for (const event of parseGeminiMessage(msg)) {
      if (event.type === "ready") {
        ready = true;
        for (const chunk of pending.splice(0)) forwardAudio(chunk);
      }
      send(client, event);
    }
  });

  upstream.on("error", (err) => {
    send(client, { type: "error", message: `Transcription service error: ${err.message}` });
  });

  upstream.on("close", (code, reason) => {
    if (!stopping && code !== 1000) {
      send(client, {
        type: "error",
        message: `Transcription service closed (${code}) ${reason.toString()}`.trim(),
      });
    }
    send(client, { type: "closed" });
    client.close();
  });

  client.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (ready && upstream.readyState === WebSocket.OPEN) forwardAudio(chunk);
      else if (pending.length < 100) pending.push(chunk); // ~10 s cap
      return;
    }
    let msg: { type?: string } = {};
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "stop" && !stopping) {
      stopping = true;
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      }
      // Give Gemini a moment to flush the last final transcript, then close.
      setTimeout(() => upstream.close(1000), 1500);
    }
  });

  client.on("close", () => {
    stopping = true;
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close(1000);
    }
  });
}

export function attachLiveRelay(server: import("node:http").Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws/transcribe")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleClient(ws, req));
  });
}
