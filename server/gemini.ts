/** Gemini Live transcription protocol helpers, shared by the Node server and the Cloudflare Worker. */

export const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export const LANGUAGE_PRESETS: Record<string, string[]> = {
  auto: [], // automatic detection, handles code switching
  "hi-en": ["hi-IN", "en-IN"],
  hi: ["hi-IN"],
  en: ["en-IN"],
};

export type ClientEvent =
  | { type: "ready" }
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string }
  | { type: "closed" };

/** Pulls interim/final transcription text out of a Gemini Live server message. */
export function parseGeminiMessage(msg: any): ClientEvent[] {
  const events: ClientEvent[] = [];
  if (msg?.setupComplete) events.push({ type: "ready" });
  const content = msg?.serverContent;
  const interim = content?.interimInputTranscription?.text;
  if (typeof interim === "string" && interim.length) events.push({ type: "interim", text: interim });
  const final = content?.inputTranscription?.text;
  if (typeof final === "string" && final.length) events.push({ type: "final", text: final });
  return events;
}

export function buildSetupMessage(model: string, languageCodes: string[]) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities: ["TEXT"] },
      inputAudioTranscription: { languageCodes },
    },
  };
}

/** Browser-facing WebSocket endpoint that accepts an ephemeral token instead of an API key. */
export const GEMINI_TOKEN_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export type LiveToken = { token: string; model: string; languageCodes: string[]; wsUrl: string };

/**
 * Mints a short-lived, single-use Gemini token so the browser can stream to the
 * Live API directly without ever seeing the real API key.
 */
export async function createLiveToken(apiKey: string, model: string, lang: string): Promise<LiveToken> {
  const languageCodes = LANGUAGE_PRESETS[lang] ?? [];
  const now = Date.now();
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
  if (!res.ok || !body.name) {
    throw new Error(body.error?.message ?? `Token request failed (${res.status})`);
  }
  return { token: body.name, model, languageCodes, wsUrl: GEMINI_TOKEN_WS_URL };
}
