import { ensureSchema, getDb } from "@/db";
import { getAuthenticatedSupabase, requireOwnedSession } from "@/lib/supabase-server";

type RoomRow = {
  code: string;
  title: string;
  activeQuestion: number;
  ended: number;
  createdAt: string;
};

type SessionSummary = RoomRow & {
  prompt: string;
  responseCount: number;
};

type QuestionRow = {
  id: number;
  type: string;
  prompt: string;
  options: string;
  position: number;
};

type ResponseRow = {
  id: number;
  questionId: number;
  participantId: string;
  displayName: string;
  answer: string;
  createdAt: string;
};

function databaseError(error: unknown) {
  console.error("[polls] database request failed", error);
  const message = process.env.NODE_ENV === "development" && error instanceof Error
    ? error.message
    : "The poll database is unavailable. Check DATABASE_URL and try again.";
  return Response.json({ error: message }, { status: 500 });
}

const googleSheetsUrl = process.env.GOOGLE_APPS_SCRIPT_URL?.trim();
const googleSheetsSecret = process.env.GOOGLE_APPS_SCRIPT_SECRET?.trim();

function sheetsConfigError() {
  return Response.json({ error: "Google Sheets is selected, but GOOGLE_APPS_SCRIPT_SECRET is not configured." }, { status: 500 });
}

function presenterError(message: string, status = 401) {
  return Response.json({ error: message }, { status });
}

async function ownedSessionCodes(request: Request) {
  const auth = await getAuthenticatedSupabase(request);
  if (!auth) return { response: presenterError("Presenter sign-in is required for this action.") };
  const { data, error } = await auth.client.from("presenter_sessions").select("code");
  if (error) {
    console.error("[polls] presenter session list failed", error);
    return { response: presenterError("Presenter session ownership is not configured yet.", 500) };
  }
  return { auth, codes: new Set((data || []).map((row) => row.code)) };
}

async function rememberSession(auth: Awaited<ReturnType<typeof getAuthenticatedSupabase>>, code: string) {
  if (!auth) return false;
  const { error } = await auth.client.from("presenter_sessions").insert({ code, owner_id: auth.user.id });
  if (error) {
    console.error("[polls] presenter session ownership insert failed", error);
    return false;
  }
  return true;
}

async function proxySheetsPost(body: Record<string, unknown>) {
  if (!googleSheetsUrl || !googleSheetsSecret) return sheetsConfigError();
  try {
    const response = await fetch(googleSheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, secret: googleSheetsSecret }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({ error: "The Google Sheets backend returned an invalid response." }));
    const status = typeof result.status === "number" ? result.status : response.ok ? 200 : response.status;
    return Response.json(result, { status });
  } catch (error) {
    return databaseError(error);
  }
}

async function proxySheetsGet(code: string) {
  if (!googleSheetsUrl || !googleSheetsSecret) return sheetsConfigError();
  try {
    const url = new URL(googleSheetsUrl);
    if (code) url.searchParams.set("code", code);
    else url.searchParams.set("action", "list");
    url.searchParams.set("secret", googleSheetsSecret);
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json().catch(() => ({ error: "The Google Sheets backend returned an invalid response." }));
    const status = typeof result.status === "number" ? result.status : response.ok ? 200 : response.status;
    return Response.json(result, { status });
  } catch (error) {
    return databaseError(error);
  }
}

async function listRooms() {
  const sql = getDb();
  return (await sql`
    SELECT r.code, r.title, r.active_question AS "activeQuestion", r.ended,
      r.created_at AS "createdAt", COALESCE(q.prompt, '') AS prompt,
      COUNT(response.id)::int AS "responseCount"
    FROM rooms r
    LEFT JOIN questions q ON q.room_code = r.code
    LEFT JOIN responses response ON response.room_code = r.code
    GROUP BY r.code, r.title, r.active_question, r.ended, r.created_at, q.prompt
    ORDER BY r.created_at DESC
  `) as SessionSummary[];
}

async function readRoom(code: string) {
  const sql = getDb();
  const roomRows = (await sql`
    SELECT code, title, active_question AS "activeQuestion", ended, created_at AS "createdAt"
    FROM rooms WHERE code = ${code}
  `) as RoomRow[];
  const room = roomRows[0];
  if (!room) return null;

  const questions = (await sql`
    SELECT id, type, prompt, options, position
    FROM questions WHERE room_code = ${code} ORDER BY position
  `) as QuestionRow[];
  const responses = (await sql`
    SELECT id, question_id AS "questionId", participant_id AS "participantId", display_name AS "displayName", answer, created_at AS "createdAt"
    FROM responses WHERE room_code = ${code} ORDER BY id
  `) as ResponseRow[];

  return {
    room,
    questions: questions.map((question) => ({
      ...question,
      options: JSON.parse(question.options || "[]") as string[],
    })),
    responses,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code")?.replace(/\D/g, "").slice(0, 6) || "";
  if (params.get("list") === "1") {
    const ownership = await ownedSessionCodes(request);
    if ("response" in ownership) return ownership.response;
    if (googleSheetsUrl) {
      const response = await proxySheetsGet("");
      const result = await response.json().catch(() => ({ error: "The Google Sheets backend returned an invalid response." })) as { sessions?: SessionSummary[]; error?: string };
      if (!response.ok) return Response.json(result, { status: response.status });
      return Response.json({ ...result, sessions: Array.isArray(result.sessions) ? result.sessions.filter((session: SessionSummary) => ownership.codes.has(session.code)) : [] });
    }
    try {
      await ensureSchema();
      return Response.json({ sessions: (await listRooms()).filter((session) => ownership.codes.has(session.code)) });
    } catch (error) {
      return databaseError(error);
    }
  }
  if (code.length !== 6) return Response.json({ error: "A valid room code is required." }, { status: 400 });
  if (googleSheetsUrl) return proxySheetsGet(code);
  try {
    await ensureSchema();
  } catch (error) {
    return databaseError(error);
  }
  const room = await readRoom(code);
  return room ? Response.json(room) : Response.json({ error: "Room not found." }, { status: 404 });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const action = String(body.action || "");
  const presenterActions = new Set(["create", "updateTitle", "addQuestion", "activate", "end"]);
  const presenterAuth = presenterActions.has(action) ? await getAuthenticatedSupabase(request) : null;
  if (presenterActions.has(action) && !presenterAuth) return presenterError("Presenter sign-in is required for this action.");
  if (action !== "create" && presenterActions.has(action)) {
    const owned = await requireOwnedSession(request, String(body.code || "").replace(/\D/g, "").slice(0, 6));
    if (!owned.auth) return presenterError(owned.error, owned.error.includes("another presenter") ? 403 : 500);
  }
  if (googleSheetsUrl) {
    const response = await proxySheetsPost(body);
    if (action === "create" && response.ok && presenterAuth) {
      const result = await response.json().catch(() => null) as { room?: { code?: string } } | null;
      const createdCode = result?.room?.code;
      if (!createdCode || !await rememberSession(presenterAuth, createdCode)) {
        return presenterError("The session was created, but ownership could not be saved. Please contact the administrator.", 500);
      }
      return Response.json(result, { status: response.status });
    }
    return response;
  }
  try {
    await ensureSchema();
  } catch (error) {
    return databaseError(error);
  }
  const sql = getDb();
  if (action === "create") {
    let code = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = String(Math.floor(100000 + Math.random() * 900000));
      const existing = (await sql`SELECT code FROM rooms WHERE code = ${candidate}`) as { code: string }[];
      if (!existing.length) {
        code = candidate;
        break;
      }
    }
    if (!code) return Response.json({ error: "Could not create a unique room code." }, { status: 503 });

    await sql`
      INSERT INTO rooms (code, title, active_question, ended, created_at)
      VALUES (${code}, ${"Untitled live session"}, 0, 0, ${new Date().toISOString()})
    `;
    if (!presenterAuth || !await rememberSession(presenterAuth, code)) {
      return presenterError("The session was created, but ownership could not be saved. Please contact the administrator.", 500);
    }
    return Response.json(await readRoom(code), { status: 201 });
  }

  const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
  const questionId = Number(body.questionId);

  if (action === "updateTitle") {
    const title = String(body.title || "").trim().slice(0, 80);
    if (!title) return Response.json({ error: "A session title is required." }, { status: 400 });
    const room = (await sql`SELECT code FROM rooms WHERE code = ${code}`) as { code: string }[];
    if (!room.length) return Response.json({ error: "Room not found." }, { status: 404 });
    await sql`UPDATE rooms SET title = ${title} WHERE code = ${code}`;
    return Response.json(await readRoom(code));
  }

  if (action === "addQuestion") {
    const roomRows = (await sql`
      SELECT code, active_question AS "activeQuestion", ended
      FROM rooms WHERE code = ${code}
    `) as { code: string; activeQuestion: number; ended: number }[];
    const room = roomRows[0];
    if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
    if (room.ended) return Response.json({ error: "This session has ended." }, { status: 409 });
    const existing = (await sql`SELECT id FROM questions WHERE room_code = ${code} LIMIT 1`) as { id: number }[];
    if (existing.length) return Response.json({ error: "This session already has its one open question." }, { status: 409 });

    const type = String(body.type || "");
    const prompt = String(body.prompt || "").trim().slice(0, 160);
    const options = Array.isArray(body.options)
      ? body.options.map((option) => String(option).trim().slice(0, 80)).filter(Boolean).slice(0, 10)
      : [];
    if (type !== "open" || !prompt) {
      return Response.json({ error: "A valid question is required." }, { status: 400 });
    }

    const positionRows = (await sql`
      SELECT COALESCE(MAX(position), -1) + 1 AS position
      FROM questions WHERE room_code = ${code}
    `) as { position: number }[];
    const position = positionRows[0]?.position ?? 0;
    const inserted = (await sql`
      INSERT INTO questions (room_code, type, prompt, options, position)
      VALUES (${code}, ${type}, ${prompt}, ${JSON.stringify(options)}, ${position})
      RETURNING id
    `) as { id: number }[];
    const insertedId = inserted[0]?.id;
    if (!room.activeQuestion && insertedId) {
      await sql`UPDATE rooms SET active_question = ${insertedId} WHERE code = ${code}`;
    }
    return Response.json(await readRoom(code), { status: 201 });
  }

  if (action === "activate") {
    const roomRows = (await sql`SELECT ended FROM rooms WHERE code = ${code}`) as { ended: number }[];
    if (roomRows[0]?.ended) return Response.json({ error: "This session has ended." }, { status: 409 });
    const valid = (await sql`SELECT id FROM questions WHERE id = ${questionId} AND room_code = ${code}`) as { id: number }[];
    if (!valid.length) return Response.json({ error: "Question not found." }, { status: 404 });
    await sql`UPDATE rooms SET active_question = ${questionId} WHERE code = ${code}`;
    return Response.json({ ok: true });
  }

  if (action === "vote") {
    const participantId = String(body.participantId || "").slice(0, 80);
    const displayName = String(body.displayName || body.name || "").trim().slice(0, 60) || "Anonymous participant";
    const roomRows = (await sql`SELECT ended FROM rooms WHERE code = ${code}`) as { ended: number }[];
    if (roomRows[0]?.ended) return Response.json({ error: "This session has ended." }, { status: 409 });
    const answerQuestion = (await sql`SELECT id, type FROM questions WHERE id = ${questionId} AND room_code = ${code}`) as { id: number; type: string }[];
    const maxAnswerLength = answerQuestion[0]?.type === "open" ? 500 : 48;
    const answer = String(body.answer || "").trim().slice(0, maxAnswerLength);
    if (!participantId || !answer) return Response.json({ error: "An answer is required." }, { status: 400 });
    if (!answerQuestion.length) return Response.json({ error: "Question not found." }, { status: 404 });
    await sql`
      INSERT INTO responses (room_code, question_id, participant_id, display_name, answer, created_at)
      VALUES (${code}, ${questionId}, ${participantId}, ${displayName}, ${answer}, ${new Date().toISOString()})
    `;
    return Response.json({ ok: true });
  }

  if (action === "end") {
    const room = (await sql`SELECT code FROM rooms WHERE code = ${code}`) as { code: string }[];
    if (!room.length) return Response.json({ error: "Room not found." }, { status: 404 });
    await sql`UPDATE rooms SET ended = 1 WHERE code = ${code}`;
    return Response.json(await readRoom(code));
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
