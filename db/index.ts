import { neon } from "@neondatabase/serverless";

let client: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

export function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured. Add a Postgres connection string before using the poll API.");
  }

  client ??= neon(connectionString);
  return client;
}

export function ensureSchema() {
  schemaReady ??= (async () => {
    const sql = getDb();
    await sql`CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, title TEXT NOT NULL, active_question INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS questions (id SERIAL PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, type TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS responses (id SERIAL PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE, participant_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT 'Anonymous participant', answer TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)`;
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS ended INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE responses ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT 'Anonymous participant'`;
    await sql`CREATE INDEX IF NOT EXISTS questions_room_idx ON questions(room_code, position)`;
    await sql`CREATE INDEX IF NOT EXISTS responses_room_idx ON responses(room_code, question_id)`;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}
