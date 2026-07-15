import { env } from "cloudflare:workers";

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, title TEXT NOT NULL, active_question INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, type TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, question_id INTEGER NOT NULL, participant_id TEXT NOT NULL, answer TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("DROP INDEX IF EXISTS one_response_per_question"),
    db.prepare("CREATE INDEX IF NOT EXISTS questions_room_idx ON questions(room_code, position)"),
    db.prepare("CREATE INDEX IF NOT EXISTS responses_room_idx ON responses(room_code, question_id)"),
  ]);
  const columns = await db.prepare("PRAGMA table_info(rooms)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "ended")) {
    await db.prepare("ALTER TABLE rooms ADD COLUMN ended INTEGER NOT NULL DEFAULT 0").run();
  }
}

async function readRoom(db: D1Database, code: string) {
  const room = await db.prepare("SELECT code, title, active_question AS activeQuestion, ended FROM rooms WHERE code = ?").bind(code).first();
  if (!room) return null;
  const questions = await db.prepare("SELECT id, type, prompt, options, position FROM questions WHERE room_code = ? ORDER BY position").bind(code).all();
  const responses = await db.prepare("SELECT id, question_id AS questionId, participant_id AS participantId, answer, created_at AS createdAt FROM responses WHERE room_code = ? ORDER BY id").bind(code).all();
  return {
    room,
    questions: questions.results.map((question) => ({ ...question, options: JSON.parse(String(question.options || "[]")) })),
    responses: responses.results,
  };
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
    while (await env.DB.prepare("SELECT code FROM rooms WHERE code = ?").bind(code).first()) {
      code = String(Math.floor(100000 + Math.random() * 900000));
    }
    await env.DB.prepare("INSERT INTO rooms (code, title, active_question, ended, created_at) VALUES (?, ?, 0, 0, ?)")
      .bind(code, "Untitled live session", new Date().toISOString()).run();
    return Response.json(await readRoom(env.DB, code), { status: 201 });
  }

  const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
  const questionId = Number(body.questionId);

  if (action === "updateTitle") {
    const title = String(body.title || "").trim().slice(0, 80);
    if (!title) return Response.json({ error: "A session title is required." }, { status: 400 });
    const room = await env.DB.prepare("SELECT code FROM rooms WHERE code = ?").bind(code).first();
    if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
    await env.DB.prepare("UPDATE rooms SET title = ? WHERE code = ?").bind(title, code).run();
    return Response.json(await readRoom(env.DB, code));
  }
  if (action === "addQuestion") {
    const room = await env.DB.prepare("SELECT code, active_question AS activeQuestion, ended FROM rooms WHERE code = ?").bind(code).first<{ code: string; activeQuestion: number; ended: number }>();
    if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
    if (room.ended) return Response.json({ error: "This session has ended." }, { status: 409 });

    const type = String(body.type || "");
    const prompt = String(body.prompt || "").trim().slice(0, 160);
    const options = Array.isArray(body.options) ? body.options.map((option) => String(option).trim().slice(0, 80)).filter(Boolean).slice(0, 10) : [];
    if (!["choice", "word", "rating"].includes(type) || !prompt) return Response.json({ error: "A valid question is required." }, { status: 400 });
    if (type === "choice" && options.length < 2) return Response.json({ error: "Multiple choice needs at least two answers." }, { status: 400 });

    const positionRow = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM questions WHERE room_code = ?").bind(code).first<{ position: number }>();
    await env.DB.prepare("INSERT INTO questions (room_code, type, prompt, options, position) VALUES (?, ?, ?, ?, ?)")
      .bind(code, type, prompt, JSON.stringify(options), positionRow?.position ?? 0).run();
    const question = await env.DB.prepare("SELECT id FROM questions WHERE room_code = ? ORDER BY id DESC LIMIT 1").bind(code).first<{ id: number }>();
    if (!room.activeQuestion && question?.id) await env.DB.prepare("UPDATE rooms SET active_question = ? WHERE code = ?").bind(question.id, code).run();
    return Response.json(await readRoom(env.DB, code), { status: 201 });
  }

  if (action === "activate") {
    const room = await env.DB.prepare("SELECT ended FROM rooms WHERE code = ?").bind(code).first<{ ended: number }>();
    if (room?.ended) return Response.json({ error: "This session has ended." }, { status: 409 });
    const valid = await env.DB.prepare("SELECT id FROM questions WHERE id = ? AND room_code = ?").bind(questionId, code).first();
    if (!valid) return Response.json({ error: "Question not found." }, { status: 404 });
    await env.DB.prepare("UPDATE rooms SET active_question = ? WHERE code = ?").bind(questionId, code).run();
    return Response.json({ ok: true });
  }

  if (action === "vote") {
    const id = String(body.participantId || "").slice(0, 80);
    const answer = String(body.answer || "").trim().slice(0, 48);
    const room = await env.DB.prepare("SELECT ended FROM rooms WHERE code = ?").bind(code).first<{ ended: number }>();
    if (room?.ended) return Response.json({ error: "This session has ended." }, { status: 409 });
    if (!id || !answer) return Response.json({ error: "An answer is required." }, { status: 400 });
    const valid = await env.DB.prepare("SELECT id FROM questions WHERE id = ? AND room_code = ?").bind(questionId, code).first();
    if (!valid) return Response.json({ error: "Question not found." }, { status: 404 });
    await env.DB.prepare("INSERT INTO responses (room_code, question_id, participant_id, answer, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(code, questionId, id, answer, new Date().toISOString()).run();
    return Response.json({ ok: true });
  }

  if (action === "end") {
    const room = await env.DB.prepare("SELECT code FROM rooms WHERE code = ?").bind(code).first();
    if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
    await env.DB.prepare("UPDATE rooms SET ended = 1 WHERE code = ?").bind(code).run();
    return Response.json(await readRoom(env.DB, code));
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
