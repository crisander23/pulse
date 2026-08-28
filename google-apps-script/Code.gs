/**
 * Pulse one-question backend for Google Sheets.
 *
 * Before deploying, replace the two placeholders below:
 * - spreadsheetId: the ID from your Google Sheet URL
 * - sharedSecret: a long private value shared with .env.local
 */
const CONFIG = {
  spreadsheetId: "PASTE_YOUR_GOOGLE_SHEET_ID_HERE",
  sharedSecret: "PASTE_A_LONG_PRIVATE_SECRET_HERE",
  roomsSheet: "Rooms",
  responsesSheet: "Responses",
};

const ROOMS_HEADERS = ["code", "title", "prompt", "questionId", "activeQuestion", "ended", "createdAt"];
const RESPONSES_HEADERS = ["id", "roomCode", "questionId", "participantId", "answer", "createdAt", "displayName"];

function setup() {
  const spreadsheet = getSpreadsheet();
  ensureSheet(spreadsheet, CONFIG.roomsSheet, ROOMS_HEADERS);
  ensureSheet(spreadsheet, CONFIG.responsesSheet, RESPONSES_HEADERS);
  return json({ ok: true, message: "Pulse Sheets backend is ready." });
}

function doGet(event) {
  try {
    authorize(event.parameter.secret);
    if (String(event.parameter.action || "") === "list") return json(listRooms());
    const code = normalizeCode(event.parameter.code);
    if (code.length !== 6) throw new Error("A valid room code is required.");
    return json(readRoom(code));
  } catch (error) {
    return errorResponse(error);
  }
}

function listRooms() {
  const roomsSheet = getSheet(CONFIG.roomsSheet);
  const roomValues = roomsSheet.getDataRange().getValues();
  const responseCounts = {};
  const responsesSheet = getSheet(CONFIG.responsesSheet);
  responsesSheet.getDataRange().getValues().slice(1).forEach((row) => {
    const code = String(row[1] || "");
    if (code) responseCounts[code] = (responseCounts[code] || 0) + 1;
  });

  const sessions = roomValues.slice(1)
    .filter((row) => String(row[0] || "").trim())
    .map((row) => {
      const code = String(row[0]);
      return {
        code: code,
        title: String(row[1] || "Untitled live session"),
        prompt: String(row[2] || ""),
        activeQuestion: Number(row[4] || 0),
        ended: Number(row[5] || 0),
        createdAt: String(row[6] || ""),
        responseCount: responseCounts[code] || 0,
      };
    })
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return { sessions: sessions };
}

function doPost(event) {
  try {
    const body = JSON.parse((event.postData && event.postData.contents) || "{}");
    authorize(body.secret || event.parameter.secret);
    return json(handleAction(body));
  } catch (error) {
    return errorResponse(error);
  }
}

function handleAction(body) {
  const action = String(body.action || "");
  if (action === "create") return createRoom();

  const code = normalizeCode(body.code);
  if (code.length !== 6) throw new Error("A valid room code is required.");

  if (action === "updateTitle") {
    const room = findRoom(code);
    if (!room) throw new HttpError("Room not found.", 404);
    const title = String(body.title || "").trim().slice(0, 80);
    if (!title) throw new HttpError("A session title is required.", 400);
    room.sheet.getRange(room.row, 2).setValue(title);
    return readRoom(code);
  }

  if (action === "addQuestion") {
    const room = findRoom(code);
    if (!room) throw new HttpError("Room not found.", 404);
    if (room.ended) throw new HttpError("This session has ended.", 409);
    if (String(body.type || "") !== "open") throw new HttpError("Only open questions are supported.", 400);
    if (room.prompt) throw new HttpError("This session already has its one open question.", 409);
    const prompt = String(body.prompt || "").trim().slice(0, 160);
    if (!prompt) throw new HttpError("A valid question is required.", 400);
    room.sheet.getRange(room.row, 3, 1, 3).setValues([[prompt, 1, 1]]);
    return readRoom(code);
  }

  if (action === "activate") {
    const room = findRoom(code);
    if (!room) throw new HttpError("Room not found.", 404);
    if (room.ended) throw new HttpError("This session has ended.", 409);
    if (Number(body.questionId) !== 1 || !room.prompt) throw new HttpError("Question not found.", 404);
    room.sheet.getRange(room.row, 5).setValue(1);
    return { ok: true };
  }

  if (action === "vote") return addResponse(code, body);

  if (action === "end") {
    const room = findRoom(code);
    if (!room) throw new HttpError("Room not found.", 404);
    room.sheet.getRange(room.row, 6).setValue(1);
    return readRoom(code);
  }

  throw new HttpError("Unknown action.", 400);
}

function createRoom() {
  const sheet = getSheet(CONFIG.roomsSheet);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let code = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = String(Math.floor(100000 + Math.random() * 900000));
      if (!findRoom(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new HttpError("Could not create a unique room code.", 503);
    sheet.appendRow([code, "Untitled live session", "", 1, 0, 0, new Date().toISOString()]);
    return readRoom(code);
  } finally {
    lock.releaseLock();
  }
}

function addResponse(code, body) {
  const room = findRoom(code);
  if (!room) throw new HttpError("Room not found.", 404);
  if (room.ended) throw new HttpError("This session has ended.", 409);
  if (Number(body.questionId) !== 1 || !room.prompt) throw new HttpError("Question not found.", 404);

  const participantId = String(body.participantId || "").slice(0, 80);
  const displayName = String(body.displayName || body.name || "").trim().slice(0, 60) || anonymousDisplayName();
  const answer = String(body.answer || "").trim().slice(0, 500);
  if (!participantId || !answer) throw new HttpError("An answer is required.", 400);

  const sheet = getSheet(CONFIG.responsesSheet);
  const nextId = nextResponseId(sheet);
  sheet.appendRow([nextId, code, 1, participantId, answer, new Date().toISOString(), displayName]);
  return { ok: true };
}

function readRoom(code) {
  const room = findRoom(code);
  if (!room) throw new HttpError("Room not found.", 404);

  const questions = room.prompt ? [{ id: 1, type: "open", prompt: room.prompt, options: [], position: 0 }] : [];
  const responsesSheet = getSheet(CONFIG.responsesSheet);
  const values = responsesSheet.getDataRange().getValues();
  const responses = values.slice(1)
    .filter((row) => String(row[1]) === code)
    .map((row) => ({
      id: Number(row[0]),
      questionId: Number(row[2]),
      participantId: String(row[3]),
      answer: String(row[4]),
      createdAt: String(row[5]),
      displayName: String(row[6] || "Anonymous participant"),
    }));

  return {
    room: {
      code: room.code,
      title: room.title,
      activeQuestion: room.activeQuestion,
      ended: room.ended,
      createdAt: room.createdAt,
    },
    questions: questions,
    responses: responses,
  };
}

function findRoom(code) {
  const sheet = getSheet(CONFIG.roomsSheet);
  const values = sheet.getDataRange().getValues();
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (String(row[0]) === code) {
      return {
        sheet: sheet,
        row: index + 1,
        code: String(row[0]),
        title: String(row[1] || "Untitled live session"),
        prompt: String(row[2] || ""),
        questionId: Number(row[3] || 1),
        activeQuestion: Number(row[4] || 0),
        ended: Number(row[5] || 0),
        createdAt: String(row[6] || ""),
      };
    }
  }
  return null;
}

function nextResponseId(sheet) {
  const values = sheet.getDataRange().getValues();
  let max = 0;
  values.slice(1).forEach((row) => { max = Math.max(max, Number(row[0]) || 0); });
  return max + 1;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function getSpreadsheet() {
  if (!CONFIG.spreadsheetId || CONFIG.spreadsheetId.indexOf("PASTE_") === 0) {
    throw new Error("Set CONFIG.spreadsheetId in Code.gs first.");
  }
  return SpreadsheetApp.openById(CONFIG.spreadsheetId);
}

function getSheet(name) {
  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet: " + name + ". Run setup() first.");
  return sheet;
}

function ensureSheet(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  else {
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    headers.forEach((header) => {
      if (!existingHeaders.includes(header)) sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    });
  }
  return sheet;
}

function anonymousDisplayName() {
  const adjectives = ["Curious", "Bright", "Kind", "Thoughtful", "Creative", "Calm", "Bold", "Friendly"];
  const nouns = ["Panda", "Comet", "Otter", "Maple", "Fox", "Sparrow", "River", "Star"];
  return adjectives[Math.floor(Math.random() * adjectives.length)] + " " + nouns[Math.floor(Math.random() * nouns.length)];
}

function authorize(secret) {
  if (!CONFIG.sharedSecret || CONFIG.sharedSecret.indexOf("PASTE_") === 0) {
    throw new Error("Set CONFIG.sharedSecret in Code.gs first.");
  }
  if (String(secret || "") !== CONFIG.sharedSecret) throw new HttpError("Unauthorized.", 401);
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(error) {
  const status = error && error.status ? error.status : 500;
  return json({ error: error && error.message ? error.message : "Google Sheets backend error.", status: status });
}

function HttpError(message, status) {
  this.name = "HttpError";
  this.message = message;
  this.status = status;
}
