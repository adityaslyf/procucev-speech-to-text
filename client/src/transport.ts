import { buildSetupMessage, parseGeminiMessage, type ClientEvent, type LiveToken } from "../../server/gemini";

export type Transport = {
  sendAudio: (pcm: ArrayBuffer) => void;
  /** Flush the last words, then close. */
  stop: () => void;
  close: () => void;
};

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Preferred path: ask our server for a single-use ephemeral token and stream straight
 * to the Gemini Live API. The real API key stays on the server.
 */
async function connectDirect(lang: string, onEvent: (e: ClientEvent) => void): Promise<Transport> {
  const res = await fetch(`/api/live-token?lang=${encodeURIComponent(lang)}`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Token request failed (${res.status})`);
  const t = (await res.json()) as LiveToken;

  const ws = new WebSocket(`${t.wsUrl}?access_token=${encodeURIComponent(t.token)}`);
  let stopping = false;
  ws.onopen = () => ws.send(JSON.stringify(buildSetupMessage(t.model, t.languageCodes)));
  ws.onmessage = async (e) => {
    const raw = typeof e.data === "string" ? e.data : await (e.data as Blob).text();
    try {
      parseGeminiMessage(JSON.parse(raw)).forEach(onEvent);
    } catch {
      /* ignore non JSON frames */
    }
  };
  ws.onerror = () => onEvent({ type: "error", message: "Could not reach the transcription service" });
  ws.onclose = (e) => {
    if (!stopping && e.code !== 1000) {
      onEvent({ type: "error", message: `Transcription service closed (${e.code}) ${e.reason}`.trim() });
    }
    onEvent({ type: "closed" });
  };

  return {
    sendAudio: (pcm) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(pcm), mimeType: "audio/pcm;rate=16000" } } }));
    },
    stop: () => {
      stopping = true;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      setTimeout(() => ws.close(1000), 1500);
    },
    close: () => {
      stopping = true;
      ws.close(1000);
    },
  };
}

/** Fallback path: stream through our own /ws/transcribe relay (used by the Node server). */
function connectRelay(lang: string, onEvent: (e: ClientEvent) => void): Transport {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/transcribe?lang=${encodeURIComponent(lang)}`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (e) => onEvent(JSON.parse(e.data as string) as ClientEvent);
  ws.onerror = () => onEvent({ type: "error", message: "Could not reach the transcription server" });
  ws.onclose = () => onEvent({ type: "closed" });
  return {
    sendAudio: (pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
    },
    stop: () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
    },
    close: () => ws.close(),
  };
}

export async function connect(lang: string, onEvent: (e: ClientEvent) => void): Promise<Transport> {
  try {
    return await connectDirect(lang, onEvent);
  } catch (err) {
    console.warn("Direct Gemini connection unavailable, using server relay:", (err as Error).message);
    return connectRelay(lang, onEvent);
  }
}
