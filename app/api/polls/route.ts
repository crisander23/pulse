import { env } from "cloudflare:workers";

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, title TEXT NOT NULL, active_question INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, type TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, question_id INTEGER NOT NULL, participant_id TEXT NOT NULL, answer TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS one_response_per_question ON responses(question_id, participant_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS questions_room_idx ON questions(room_code, position)"),
    db.prepare("CREATE INDEX IF NOT EXISTS responses_room_idx ON responses(room_code, question_id)"),
  ]);
}
async function readRoom(db: D1Database, code: string) {
  const room = await db.prepare("SELECT code, title, active_question AS activeQuestion FROM rooms WHERE code = ?").bind(code).first();
  if (!room) return null;
  const questions = await db.prepare("SELECT id, type, prompt, options, position FROM questions WHERE room_code = ? ORDER BY position").bind(code).all();
  const responses = await db.prepare("SELECT question_id AS questionId, participant_id AS participantId, answer FROM responses WHERE room_code = ? ORDER BY id").bind(code).all();
  return { room, questions: questions.results.map((question) => ({ ...question, options: JSON.parse(String(question.options || "[]")) })), responses: responses.results };
}
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.replace(/\D/g, "").slice(0, 6) || "";
  if (code.length !== 6) return Response.json({ error: "A valid room code is required." }, { status: 400 });
  await ensureSchema(env.DB);
  const room = await readRoom(env.DB, code);
  return room ? Response.json(room) : Response.json({ error: "Room not found." }, { status: 404 });
}
export async function POST(request: Request) {
  await ensureSchema(env.DB);
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action || "");
  if (action === "create") {
    let code = String(Math.floor(100000 + Math.random() * 900000));
    while (await env.DB.prepare("SELECT code FROM rooms WHERE code = ?").bind(code).first()) code = String(Math.floor(100000 + Math.random() * 900000));
    await env.DB.prepare("INSERT INTO rooms (code, title, active_question, created_at) VALUES (?, ?, 0, ?)").bind(code, "Team pulse check", new Date().toISOString()).run();
    const rows: [string, string, string, number][] = [
      ["choice", "What should we prioritize next?", JSON.stringify(["Customer experience", "Smarter workflows", "Team growth", "New markets"]), 0],
      ["word", "What makes a great team?", "[]", 1],
      ["rating", "How energized are you by this direction?", "[]", 2],
    ];
    for (const [type, prompt, options, position] of rows) await env.DB.prepare("INSERT INTO questions (room_code, type, prompt, options, position) VALUES (?, ?, ?, ?, ?)").bind(code, type, prompt, options, position).run();
    const first = await env.DB.prepare("SELECT id FROM questions WHERE room_code = ? ORDER BY position LIMIT 1").bind(code).first<{ id: number }>();
    await env.DB.prepare("UPDATE rooms SET active_question = ? WHERE code = ?").bind(first?.id || 0, code).run();
    return Response.json(await readRoom(env.DB, code), { status: 201 });
  }
  const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
  const questionId = Number(body.questionId);
  if (action === "activate") {
    const valid = await env.DB.prepare("SELECT id FROM questions WHERE id = ? AND room_code = ?").bind(questionId, code).first();
    if (!valid) return Response.json({ error: "Question not found." }, { status: 404 });
    await env.DB.prepare("UPDATE rooms SET active_question = ? WHERE code = ?").bind(questionId, code).run();
    return Response.json({ ok: true });
  }
  if (action === "vote") {
    const participantId = String(body.participantId || "").slice(0, 80);
    const answer = String(body.answer || "").trim().slice(0, 48);
    if (!participantId || !answer) return Response.json({ error: "An answer is required." }, { status: 400 });
    const valid = await env.DB.prepare("SELECT id FROM questions WHERE id = ? AND room_code = ?").bind(questionId, code).first();
    if (!valid) return Response.json({ error: "Question not found." }, { status: 404 });
    await env.DB.prepare("INSERT INTO responses (room_code, question_id, participant_id, answer, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(question_id, participant_id) DO UPDATE SET answer = excluded.answer, created_at = excluded.created_at").bind(code, questionId, participantId, answer, new Date().toISOString()).run();
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Unknown action." }, { status: 400 });
}