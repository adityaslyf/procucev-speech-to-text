export type Transcription = {
  id: number;
  title: string;
  text: string;
  language: string;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  list: (q = "") => request<Transcription[]>(`/api/transcriptions${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  create: (input: { title: string; text: string; language: string; durationMs: number }) =>
    request<Transcription>("/api/transcriptions", { method: "POST", body: JSON.stringify(input) }),
  update: (id: number, patch: { title?: string; text?: string }) =>
    request<Transcription>(`/api/transcriptions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => request<void>(`/api/transcriptions/${id}`, { method: "DELETE" }),
};
