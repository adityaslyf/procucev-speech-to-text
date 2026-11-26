import pg from "pg";

export type Transcription = {
  id: number;
  title: string;
  text: string;
  language: string;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
};

export type NewTranscription = {
  title: string;
  text: string;
  language: string;
  durationMs: number;
};

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

// Without a listener, a dropped idle connection would crash the process.
pool.on("error", (err) => console.error("Postgres pool error", err.message));

const COLUMNS = `id, title, text, language,
  duration_ms AS "durationMs", created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id          SERIAL PRIMARY KEY,
      title       TEXT        NOT NULL,
      text        TEXT        NOT NULL,
      language    TEXT        NOT NULL DEFAULT 'auto',
      duration_ms INTEGER     NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS transcriptions_created_at_idx
      ON transcriptions (created_at DESC);
  `);
}

export async function listTranscriptions(search?: string): Promise<Transcription[]> {
  if (search) {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM transcriptions
       WHERE title ILIKE $1 OR text ILIKE $1
       ORDER BY created_at DESC LIMIT 200`,
      [`%${search}%`],
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM transcriptions ORDER BY created_at DESC LIMIT 200`,
  );
  return rows;
}

export async function getTranscription(id: number): Promise<Transcription | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM transcriptions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createTranscription(input: NewTranscription): Promise<Transcription> {
  const { rows } = await pool.query(
    `INSERT INTO transcriptions (title, text, language, duration_ms)
     VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [input.title, input.text, input.language, input.durationMs],
  );
  return rows[0];
}

export async function updateTranscription(
  id: number,
  patch: Partial<Pick<NewTranscription, "title" | "text">>,
): Promise<Transcription | null> {
  const { rows } = await pool.query(
    `UPDATE transcriptions
     SET title = COALESCE($2, title), text = COALESCE($3, text), updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, patch.title ?? null, patch.text ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteTranscription(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM transcriptions WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
