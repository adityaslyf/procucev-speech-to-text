import { useCallback, useEffect, useState } from "react";
import { api, type Transcription } from "./api";
import { useLiveTranscription } from "./useLiveTranscription";
import { speak, stopSpeaking } from "./speak";

const LANGUAGES = [
  { value: "auto", label: "Auto detect (mixed)" },
  { value: "hi-en", label: "Hindi + English" },
  { value: "hi", label: "Hindi" },
  { value: "en", label: "English (India)" },
];

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function defaultTitle(text: string) {
  const words = text.trim().split(/\s+/).slice(0, 6).join(" ");
  return words.length ? words : `Recording ${new Date().toLocaleString()}`;
}

export default function App() {
  const live = useLiveTranscription();
  const [lang, setLang] = useState("auto");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Transcription[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; title: string; text: string } | null>(null);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    try {
      setItems(await api.list(q));
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(query), 250);
    return () => clearTimeout(t);
  }, [query, load]);

  const recording = live.status === "listening" || live.status === "connecting";
  const transcript = live.finalText;

  async function save() {
    if (!transcript.trim()) return;
    try {
      const created = await api.create({
        title: title.trim() || defaultTitle(transcript),
        text: transcript.trim(),
        language: lang,
        durationMs: live.durationMs,
      });
      setItems((prev) => [created, ...prev]);
      live.setFinalText("");
      setTitle("");
      setMessage("Saved to history");
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      const updated = await api.update(editing.id, { title: editing.title, text: editing.text });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setEditing(null);
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this transcription?")) return;
    try {
      await api.remove(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header>
        <h1>Speech to Text</h1>
        <p className="muted">Real time, multilingual transcription. Speak Hindi, English or both in one sentence.</p>
      </header>

      <section className="card">
        <div className="row">
          <label>
            Language
            <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={recording}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          {recording ? (
            <button className="btn danger" onClick={live.stop}>
              Stop
            </button>
          ) : (
            <button className="btn primary" onClick={() => live.start(lang)} disabled={live.status === "stopping"}>
              {live.status === "stopping" ? "Finishing…" : "Start speaking"}
            </button>
          )}
          <span className={`status ${live.status}`}>
            {live.status === "connecting" && "Connecting…"}
            {live.status === "listening" && "Listening"}
            {live.status === "stopping" && "Finalising transcript…"}
            {live.status === "idle" && "Idle"}
            {live.status === "error" && "Error"}
          </span>
          <div className="meter" aria-hidden>
            <div style={{ width: `${Math.min(100, live.level * 300)}%` }} />
          </div>
        </div>

        {live.error && <p className="error">{live.error}</p>}

        <div className="transcript" aria-live="polite">
          {transcript || live.interim ? (
            <>
              <span>{transcript}</span> <span className="interim">{live.interim}</span>
            </>
          ) : (
            <span className="muted">Your words will appear here as you speak…</span>
          )}
        </div>

        <div className="row">
          <input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={recording}
          />
          <button className="btn" onClick={save} disabled={recording || !transcript.trim()}>
            Save to history
          </button>
          <button className="btn" onClick={() => speak(transcript)} disabled={!transcript.trim()}>
            Read aloud
          </button>
          <button className="btn ghost" onClick={() => live.setFinalText("")} disabled={recording || !transcript}>
            Clear
          </button>
        </div>
      </section>

      {message && (
        <p className="toast" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}

      <section className="card">
        <div className="row spread">
          <h2>History</h2>
          <input
            className="search"
            placeholder="Search transcriptions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading && <p className="muted">Loading…</p>}
        {!loading && items.length === 0 && <p className="muted">No transcriptions yet.</p>}

        <ul className="history">
          {items.map((item) =>
            editing?.id === item.id ? (
              <li key={item.id} className="item editing">
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                <textarea
                  rows={4}
                  value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                />
                <div className="row">
                  <button className="btn primary" onClick={saveEdit}>
                    Save
                  </button>
                  <button className="btn ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li key={item.id} className="item">
                <div className="row spread">
                  <strong>{item.title}</strong>
                  <span className="muted small">
                    {new Date(item.createdAt).toLocaleString()} · {formatDuration(item.durationMs)} ·{" "}
                    {LANGUAGES.find((l) => l.value === item.language)?.label ?? item.language}
                  </span>
                </div>
                <p>{item.text}</p>
                <div className="row">
                  <button className="btn small" onClick={() => speak(item.text)}>
                    Play
                  </button>
                  <button className="btn small ghost" onClick={stopSpeaking}>
                    Stop audio
                  </button>
                  <button
                    className="btn small"
                    onClick={() => setEditing({ id: item.id, title: item.title, text: item.text })}
                  >
                    Edit
                  </button>
                  <button className="btn small danger" onClick={() => remove(item.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      </section>
    </div>
  );
}
