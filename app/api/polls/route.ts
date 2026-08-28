import { getAuthenticatedSupabase, getPublicSupabase, requireOwnedSession } from "@/lib/supabase-server";

type RoomRow = { code: string; title: string; activeQuestion: number; ended: number; createdAt: string };
type SessionSummary = RoomRow & { prompt: string; responseCount: number };
type QuestionRow = { id: number; roomCode?: string; type: string; prompt: string; options: string[]; position: number };
type ResponseRow = { id: number; roomCode?: string; questionId: number; participantId: string; displayName: string; answer: string; createdAt: string };

function databaseError(error: unknown) {
  console.error("[polls] Supabase request failed", error);
  const message = process.env.NODE_ENV === "development" && error instanceof Error ? error.message : "The poll database is unavailable. Check the Supabase configuration and try again.";
  return Response.json({ error: message }, { status: 500 });
}

function presenterError(message: string, status = 401) {
  return Response.json({ error: message }, { status });
}

function normalizeRoom(row: Record<string, unknown>): RoomRow {
  return { code: String(row.code || ""), title: String(row.title || "Untitled live session"), activeQuestion: Number(row.active_question || 0), ended: Number(row.ended || 0), createdAt: String(row.created_at || "") };
}

function normalizeQuestion(row: Record<string, unknown>): QuestionRow {
  const rawOptions = row.options;
  return { id: Number(row.id), roomCode: String(row.room_code || ""), type: String(row.type || "open"), prompt: String(row.prompt || ""), options: Array.isArray(rawOptions) ? rawOptions.map(String) : [], position: Number(row.position || 0) };
}

function normalizeResponse(row: Record<string, unknown>): ResponseRow {
  return { id: Number(row.id), roomCode: String(row.room_code || ""), questionId: Number(row.question_id), participantId: String(row.participant_id || ""), displayName: String(row.display_name || "Anonymous participant"), answer: String(row.answer || ""), createdAt: String(row.created_at || "") };
}

async function readRoom(code: string) {
  const client = getPublicSupabase();
  const [roomResult, questionsResult, responsesResult] = await Promise.all([
    client.from("rooms").select("code,title,active_question,ended,created_at").eq("code", code).maybeSingle(),
    client.from("questions").select("id,room_code,type,prompt,options,position").eq("room_code", code).order("position"),
    client.from("responses").select("id,room_code,question_id,participant_id,display_name,answer,created_at").eq("room_code", code).order("id"),
  ]);
  if (roomResult.error) throw roomResult.error;
  if (questionsResult.error) throw questionsResult.error;
  if (responsesResult.error) throw responsesResult.error;
  if (!roomResult.data) return null;
  return { room: normalizeRoom(roomResult.data as Record<string, unknown>), questions: (questionsResult.data || []).map((row) => normalizeQuestion(row as Record<string, unknown>)), responses: (responsesResult.data || []).map((row) => normalizeResponse(row as Record<string, unknown>)) };
}

async function listRooms(userId: string) {
  const client = getPublicSupabase();
  const roomsResult = await client.from("rooms").select("code,title,active_question,ended,created_at").eq("owner_id", userId).order("created_at", { ascending: false });
  if (roomsResult.error) throw roomsResult.error;
  const rooms = roomsResult.data || [];
  const codes = rooms.map((room) => String(room.code));
  if (!codes.length) return [] as SessionSummary[];
  const [questionsResult, responsesResult] = await Promise.all([
    client.from("questions").select("room_code,prompt").in("room_code", codes).order("position"),
    client.from("responses").select("room_code,id").in("room_code", codes),
  ]);
  if (questionsResult.error) throw questionsResult.error;
  if (responsesResult.error) throw responsesResult.error;
  const prompts = new Map<string, string>();
  (questionsResult.data || []).forEach((row) => { if (!prompts.has(String(row.room_code))) prompts.set(String(row.room_code), String(row.prompt || "")); });
  const counts = new Map<string, number>();
  (responsesResult.data || []).forEach((row) => { const roomCode = String(row.room_code); counts.set(roomCode, (counts.get(roomCode) || 0) + 1); });
  return rooms.map((room) => ({ ...normalizeRoom(room as Record<string, unknown>), prompt: prompts.get(String(room.code)) || "", responseCount: counts.get(String(room.code)) || 0 }));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code")?.replace(/\D/g, "").slice(0, 6) || "";
  try {
    if (params.get("list") === "1") {
      const auth = await getAuthenticatedSupabase(request);
      if (!auth) return presenterError("Presenter sign-in is required for this action.");
      return Response.json({ sessions: await listRooms(auth.user.id) });
    }
    if (code.length !== 6) return Response.json({ error: "A valid room code is required." }, { status: 400 });
    const room = await readRoom(code);
    return room ? Response.json(room) : Response.json({ error: "Room not found." }, { status: 404 });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "A valid JSON request body is required." }, { status: 400 }); }
  const action = String(body.action || "");
  const presenterActions = new Set(["create", "updateTitle", "addQuestion", "activate", "end"]);
  const auth = presenterActions.has(action) ? await getAuthenticatedSupabase(request) : null;
  if (presenterActions.has(action) && !auth) return presenterError("Presenter sign-in is required for this action.");

  try {
    const client = getPublicSupabase();
    if (action === "create") {
      let code = "";
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = String(Math.floor(100000 + Math.random() * 900000));
        const existing = await client.from("rooms").select("code").eq("code", candidate).maybeSingle();
        if (existing.error) throw existing.error;
        if (!existing.data) { code = candidate; break; }
      }
      if (!code || !auth) return presenterError("Could not create a unique room code.", 503);
      const created = await auth.client.from("rooms").insert({ code, title: "Untitled live session", active_question: 0, ended: 0, owner_id: auth.user.id }).select("code").single();
      if (created.error) throw created.error;
      return Response.json(await readRoom(code), { status: 201 });
    }

    const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
    const questionId = Number(body.questionId);
    if (presenterActions.has(action)) {
      const owned = await requireOwnedSession(request, code);
      if (!owned.auth) return presenterError(owned.error, owned.error.includes("another presenter") ? 403 : 500);
    }

    if (action === "updateTitle") {
      const title = String(body.title || "").trim().slice(0, 80);
      if (!title) return Response.json({ error: "A session title is required." }, { status: 400 });
      const updated = await auth?.client.from("rooms").update({ title }).eq("code", code).eq("owner_id", auth.user.id).select("code").maybeSingle();
      if (updated?.error) throw updated.error;
      if (!updated?.data) return Response.json({ error: "Room not found." }, { status: 404 });
      return Response.json(await readRoom(code));
    }

    if (action === "addQuestion") {
      const roomResult = await auth?.client.from("rooms").select("code,active_question,ended").eq("code", code).eq("owner_id", auth.user.id).maybeSingle();
      if (roomResult?.error) throw roomResult.error;
      if (!roomResult?.data) return Response.json({ error: "Room not found." }, { status: 404 });
      if (roomResult.data.ended) return Response.json({ error: "This session has ended." }, { status: 409 });
      const existing = await client.from("questions").select("id").eq("room_code", code).limit(1);
      if (existing.error) throw existing.error;
      if (existing.data?.length) return Response.json({ error: "This session already has its one open question." }, { status: 409 });
      const prompt = String(body.prompt || "").trim().slice(0, 160);
      if (String(body.type || "") !== "open" || !prompt) return Response.json({ error: "A valid question is required." }, { status: 400 });
      const inserted = await auth?.client.from("questions").insert({ room_code: code, type: "open", prompt, options: [], position: 0 }).select("id").single();
      if (inserted?.error) throw inserted.error;
      const activated = await auth?.client.from("rooms").update({ active_question: inserted?.data?.id || 0 }).eq("code", code).eq("owner_id", auth.user.id);
      if (activated?.error) throw activated.error;
      return Response.json(await readRoom(code), { status: 201 });
    }

    if (action === "activate") {
      const valid = await client.from("questions").select("id").eq("id", questionId).eq("room_code", code).maybeSingle();
      if (valid.error) throw valid.error;
      if (!valid.data) return Response.json({ error: "Question not found." }, { status: 404 });
      const updated = await auth?.client.from("rooms").update({ active_question: questionId }).eq("code", code).eq("owner_id", auth.user.id).select("code").maybeSingle();
      if (updated?.error) throw updated.error;
      return Response.json({ ok: true });
    }

    if (action === "vote") {
      const participantId = String(body.participantId || "").slice(0, 80);
      const displayName = String(body.displayName || body.name || "").trim().slice(0, 60) || "Anonymous participant";
      const answer = String(body.answer || "").trim().slice(0, 500);
      if (!participantId || !answer) return Response.json({ error: "An answer is required." }, { status: 400 });
      const room = await client.from("rooms").select("code,ended,active_question").eq("code", code).maybeSingle();
      if (room.error) throw room.error;
      if (!room.data) return Response.json({ error: "Room not found." }, { status: 404 });
      if (room.data.ended) return Response.json({ error: "This session has ended." }, { status: 409 });
      const question = await client.from("questions").select("id,type").eq("id", questionId).eq("room_code", code).maybeSingle();
      if (question.error) throw question.error;
      if (!question.data) return Response.json({ error: "Question not found." }, { status: 404 });
      const inserted = await client.from("responses").insert({ room_code: code, question_id: questionId, participant_id: participantId, display_name: displayName, answer }).select("id").single();
      if (inserted.error) throw inserted.error;
      return Response.json({ ok: true });
    }

    if (action === "end") {
      const updated = await auth?.client.from("rooms").update({ ended: 1 }).eq("code", code).eq("owner_id", auth.user.id).select("code").maybeSingle();
      if (updated?.error) throw updated.error;
      if (!updated?.data) return Response.json({ error: "Room not found." }, { status: 404 });
      return Response.json(await readRoom(code));
    }
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return databaseError(error);
  }
}
