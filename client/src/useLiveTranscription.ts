import { useCallback, useRef, useState } from "react";
import type { ClientEvent } from "../../server/gemini";
import { connect, type Transport } from "./transport";

export type Status = "idle" | "connecting" | "listening" | "stopping" | "error";

function joinText(a: string, b: string) {
  if (!a) return b.trim();
  if (!b.trim()) return a;
  return `${a} ${b.trim()}`.replace(/\s+/g, " ");
}

/** Streams the microphone to the server relay and exposes live transcript state. */
export function useLiveTranscription() {
  const [status, setStatus] = useState<Status>("idle");
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const transportRef = useRef<Transport | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const teardownAudio = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(
    async (lang: string) => {
      setError(null);
      setFinalText("");
      setInterim("");
      setDurationMs(0);
      setStatus("connecting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;

        const ctx = new AudioContext();
        ctxRef.current = ctx;
        await ctx.audioWorklet.addModule("/pcm-worklet.js");
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "pcm-processor");
        source.connect(node);

        let transport: Transport | null = null;
        const onEvent = (event: ClientEvent) => {
          switch (event.type) {
            case "ready":
              setStatus("listening");
              setStartedAt(Date.now());
              break;
            case "interim":
              setInterim(event.text);
              break;
            case "final":
              setFinalText((prev) => joinText(prev, event.text));
              setInterim("");
              break;
            case "error":
              setError(event.message);
              setStatus("error");
              break;
            case "closed":
              teardownAudio();
              transportRef.current = null;
              setInterim("");
              setStatus((s) => (s === "error" ? s : "idle"));
              break;
          }
        };
        transport = await connect(lang, onEvent);
        transportRef.current = transport;

        node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
          setLevel(e.data.level);
          transport?.sendAudio(e.data.pcm);
        };
      } catch (err) {
        teardownAudio();
        setError(err instanceof Error ? err.message : "Microphone access failed");
        setStatus("error");
      }
    },
    [teardownAudio],
  );

  const stop = useCallback(() => {
    const transport = transportRef.current;
    if (startedAt) setDurationMs(Date.now() - startedAt);
    teardownAudio();
    if (transport) {
      setStatus("stopping");
      transport.stop();
    } else {
      setStatus("idle");
    }
  }, [teardownAudio, startedAt]);

  return { status, finalText, setFinalText, interim, error, level, start, stop, durationMs, startedAt };
}
