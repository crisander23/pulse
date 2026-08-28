"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Question = { id: number; type: "open"; prompt: string; options: string[]; position: number };
type PollData = {
  room: { code: string; title: string; activeQuestion: number; ended: number };
  questions: Question[];
  responses: { id: number; questionId: number; answer: string; participantId: string; displayName: string; createdAt: string }[];
};
type SessionSummary = {
  code: string;
  title: string;
  prompt: string;
  activeQuestion: number;
  ended: number;
  createdAt: string;
  responseCount: number;
};
const wordPalette = ["#ff7a45", "#b853eb", "#aebcff", "#ddff58", "#99e0d7", "#8bc2ff", "#e7c9c3", "#9bd400", "#ffadb5", "#ef91c5", "#42b8e8", "#ffd11a", "#a8c9a8"];
const anonymousAdjectives = ["Curious", "Bright", "Kind", "Thoughtful", "Creative", "Calm", "Bold", "Friendly"];
const anonymousNouns = ["Panda", "Comet", "Otter", "Maple", "Fox", "Sparrow", "River", "Star"];

function questionTypeLabel() { return "OPEN QUESTION"; }

function participantId() {
  const key = "pulse-participant";
  let value = localStorage.getItem(key);
  if (!value) {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      value = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
    } else {
      value = "participant-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }
    localStorage.setItem(key, value);
  }
  return value;
}

function Logo() {
  return <div className="logo" aria-label="Pulse"><span className="logo-mark"><i /><i /><i /></span><span>pulse</span></div>;
}

function anonymousDisplayName() {
  const key = "pulse-anonymous-name";
  let value = localStorage.getItem(key);
  if (!value) {
    const adjective = anonymousAdjectives[Math.floor(Math.random() * anonymousAdjectives.length)];
    const noun = anonymousNouns[Math.floor(Math.random() * anonymousNouns.length)];
    value = `${adjective} ${noun}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function publicOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
}

function publicHost() {
  try { return new URL(publicOrigin()).host; } catch { return typeof window !== "undefined" ? window.location.host : "localhost:3000"; }
}

function formatSessionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatRoomCode(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadResultsCsv(data: PollData) {
  const rows: (string | number)[][] = [["Room code", "Session title", "Question", "Participant ID", "Participant name", "Answer", "Submitted at"]];
  data.responses.forEach((response) => {
    const question = data.questions.find((item) => item.id === response.questionId);
    rows.push([data.room.code, data.room.title, question?.prompt || "", response.participantId, response.displayName || "Anonymous participant", response.answer, response.createdAt]);
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `pulse-${data.room.code}-results.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function presenterFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase authentication is not configured yet.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in as the presenter first.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}

function AuthPanel({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const supabase = getSupabaseBrowserClient();
  const [signUp, setSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) { setError("Supabase authentication is not configured yet."); return; }
    setBusy(true);
    setError("");
    setMessage("");
    const result = signUp
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) setError(result.error.message);
    else if (signUp && !result.data.session) setMessage("Check your email to confirm your account, then sign in.");
    else { setMessage(signUp ? "Account created." : "Signed in."); onSuccess(); }
    setBusy(false);
  }

  return <main className="auth-shell"><section className="auth-card"><Logo /><span className="question-kicker">PRESENTER ACCOUNT</span><h1>{signUp ? "Create your Pulse account" : "Sign in to Pulse"}</h1><p className="auth-description">Your account protects session management. Audience members can still join and respond without signing up.</p><form onSubmit={submit} className="auth-form"><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={signUp ? "new-password" : "current-password"} minLength={6} required /></label><button className="composer-submit" disabled={busy}>{busy ? "Please wait..." : signUp ? "Create account" : "Sign in"}</button></form>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}<div className="auth-links"><button type="button" onClick={() => { setSignUp(!signUp); setError(""); setMessage(""); }}>{signUp ? "Already have an account? Sign in" : "Need an account? Sign up"}</button><button type="button" onClick={onBack}>Back to Pulse</button></div></section></main>;
}

function Results({ question, responses, wallTitle, frameless = false, hideWallHeader = false }: { question: Question; responses: PollData["responses"]; wallTitle?: string; frameless?: boolean; hideWallHeader?: boolean }) {
  const answers = responses.filter((response) => response.questionId === question.id);
  const messages = [...answers].reverse();
  return <section className={"response-wall open-response-wall" + (frameless ? " frameless-wall" : "")}>
    {!hideWallHeader && <header><span>Live responses</span><h2>{wallTitle || "Open responses"}</h2><p>{answers.length} submissions</p></header>}
    <div className="wall-grid">
      {messages.length ? messages.map((response, index) => <article className="wall-card" key={response.id} style={{ borderTopColor: wordPalette[index % wordPalette.length] }}><small className="response-name">{response.displayName || "Anonymous participant"}</small><p>{response.answer}</p></article>) : <p className="empty">Responses will appear here as they arrive.</p>}
    </div>
  </section>;
}

function DisplayResponseBoard({ question, responses }: { question: Question; responses: PollData["responses"] }) {
  const answers = responses.filter((response) => response.questionId === question.id);
  const pageSize = 9;
  const boardRef = useRef<HTMLDivElement>(null);
  const [followingLatest, setFollowingLatest] = useState(true);
  const [atTop, setAtTop] = useState(true);
  const [focusedResponse, setFocusedResponse] = useState<PollData["responses"][number] | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [responseLayout, setResponseLayout] = useState<"grid" | "list">("grid");
  const pageCount = Math.max(1, Math.ceil(answers.length / pageSize));
  const pageStart = currentPage * pageSize;
  const visibleAnswers = answers.slice(pageStart, pageStart + pageSize);
  const firstVisible = answers.length ? pageStart + 1 : 0;
  const lastVisible = Math.min(pageStart + pageSize, answers.length);

  const goToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const board = boardRef.current;
    if (!board) return;
    setFollowingLatest(true);
    setCurrentPage(pageCount - 1);
    board.scrollTo({ top: board.scrollHeight, behavior });
  }, [pageCount]);

  useEffect(() => {
    if (followingLatest) goToLatest(answers.length > 9 ? "smooth" : "auto");
  }, [answers.length, followingLatest, goToLatest]);

  useEffect(() => {
    if (currentPage >= pageCount) setCurrentPage(pageCount - 1);
  }, [currentPage, pageCount]);

  function changePage(nextPage: number) {
    const page = Math.max(0, Math.min(nextPage, pageCount - 1));
    setCurrentPage(page);
    setFollowingLatest(page === pageCount - 1);
    boardRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function trackScroll() {
    const board = boardRef.current;
    if (!board) return;
    setAtTop(board.scrollTop < 8);
    setFollowingLatest(board.scrollHeight - board.scrollTop - board.clientHeight < 18);
  }

  return <section className="display-response-board">
    <header><span>Live responses</span><div className="response-board-tools"><p>{answers.length} submissions</p><div className="response-layout-toggle" role="group" aria-label="Response layout"><button type="button" className={responseLayout === "grid" ? "active" : ""} aria-pressed={responseLayout === "grid"} onClick={() => setResponseLayout("grid")}>Grid</button><button type="button" className={responseLayout === "list" ? "active" : ""} aria-pressed={responseLayout === "list"} onClick={() => setResponseLayout("list")}>List</button></div><button type="button" onClick={() => goToLatest()} disabled={followingLatest}>Latest</button></div></header>
    <div ref={boardRef} onScroll={trackScroll} className={"display-board-grid response-" + responseLayout + "-layout" + (!atTop ? " fading-top" : "")}>
      {answers.length ? visibleAnswers.map((response, index) => <button type="button" className="display-response-card" key={response.id} onClick={() => setFocusedResponse(response)} style={{ borderTopColor: wordPalette[(pageStart + index) % wordPalette.length] }}><small className="response-name">{response.displayName || "Anonymous participant"}</small><p>{response.answer}</p></button>) : <p className="empty">Responses will appear here as they arrive.</p>}
    </div>
    <nav className="response-pagination" aria-label="Response pages"><span className="pagination-range">{firstVisible}–{lastVisible} of {answers.length} submissions</span><span className="pagination-page">Page {currentPage + 1} of {pageCount}</span><div className="pagination-actions"><button type="button" onClick={() => changePage(currentPage - 1)} disabled={currentPage === 0}>← Previous</button><button type="button" onClick={() => changePage(currentPage + 1)} disabled={currentPage === pageCount - 1}>Next →</button></div></nav>
    {focusedResponse && <div className="response-focus-backdrop" role="presentation" onMouseDown={() => setFocusedResponse(null)}>
      <section className="response-focus-modal" role="dialog" aria-modal="true" aria-label="Audience response" onMouseDown={(event) => event.stopPropagation()}>
        <button className="response-focus-close" onClick={() => setFocusedResponse(null)} aria-label="Close response">x</button>
        <span>{focusedResponse.displayName || "Anonymous participant"}</span>
        <p>{focusedResponse.answer}</p>
      </section>
    </div>}
  </section>;
}
function SessionReport({ data, compact = false }: { data: PollData; compact?: boolean }) {
  const participants = new Set(data.responses.map((response) => response.participantId)).size;
  return <section className={"session-report" + (compact ? " compact-report" : "")}>
    <div className="report-heading"><div><span className="question-type">SESSION COMPLETE</span><h1>{data.room.title}</h1><h2 className="report-subtitle">Consolidated report</h2><p>Every submitted response is included in this summary.</p></div><button className="report-export-button" onClick={() => downloadResultsCsv(data)}>Export results</button>
      <div className="report-metrics"><div><strong>{data.responses.length}</strong><span>Total responses</span></div><div><strong>{participants}</strong><span>Participants</span></div><div><strong>{data.questions.length}</strong><span>Questions</span></div></div>
    </div>
    <div className="report-questions">{data.questions.map((question, index) => {
      const responses = data.responses.filter((response) => response.questionId === question.id);
      return <article className="report-question" key={question.id}><div className="report-question-title"><span>{String(index + 1).padStart(2, "0")}</span><div><small>{questionTypeLabel()}</small><h2>{question.prompt}</h2><p>{responses.length} responses</p></div></div><Results question={question} responses={data.responses} frameless hideWallHeader /></article>;
    })}</div>
  </section>;
}

function SessionManagement({ onCreate, onBack, onOpen }: { onCreate: () => void; onBack: () => void; onOpen: (code: string, view: "present" | "screen") => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await presenterFetch("/api/polls?list=1", { cache: "no-store" });
      const result = await response.json().catch(() => ({ error: "The server returned an invalid response." }));
      if (!response.ok) throw new Error(result.error || "Could not load session history.");
      setSessions(Array.isArray(result.sessions) ? result.sessions : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load session history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  return <main className="session-management">
    <header className="management-header">
      <div><Logo /><span className="management-kicker">SESSION HISTORY</span><h1>Your previous sessions</h1><p>Reopen a live room or review a completed response report.</p></div>
      <div className="management-actions"><button className="management-secondary" onClick={onBack}>Back to Pulse</button><button className="management-primary" onClick={onCreate}>Start new session <span>→</span></button></div>
    </header>
    <section className="management-content">
      <div className="management-toolbar"><div><strong>{sessions.length}</strong> saved {sessions.length === 1 ? "session" : "sessions"}</div><button onClick={loadSessions} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button></div>
      {loading ? <div className="management-empty"><div className="loader" /><p>Loading your sessions...</p></div>
        : error ? <div className="management-empty"><strong>Could not load sessions</strong><p>{error}</p><button onClick={loadSessions}>Try again</button></div>
          : sessions.length ? <div className="session-history-grid">{sessions.map((session) => <article className="session-history-card" key={session.code}>
            <header><span className={`session-status ${session.ended ? "ended" : "live"}`}>{session.ended ? "ENDED" : "LIVE"}</span><time dateTime={session.createdAt}>{formatSessionDate(session.createdAt)}</time></header>
            <div className="session-history-code">ROOM {formatRoomCode(session.code)}</div>
            <h2>{session.title || "Untitled live session"}</h2>
            <p className={session.prompt ? "session-history-prompt" : "session-history-prompt muted"}>{session.prompt || "Question not added yet"}</p>
            <footer><span><b>{session.responseCount}</b> responses</span><div><button onClick={() => onOpen(session.code, "present")}>{session.ended ? "Open report" : "Open session"}</button><button className="session-display-button" onClick={() => onOpen(session.code, "screen")}>Display</button></div></footer>
          </article>)}</div>
            : <div className="management-empty"><strong>No sessions yet</strong><p>Start your first open-ended session to see it here.</p><button onClick={onCreate}>Start a session</button></div>}
    </section>
  </main>;
}

function PresentationScreen({ code }: { code: string }) {
  const [data, setData] = useState<PollData | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/polls?code=" + code, { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }, [code]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 1000); return () => clearInterval(timer); }, [refresh]);
  if (!data) return <main className="screen-view center"><div className="loader" /><p>Loading presentation...</p></main>;
  const active = data.questions.find((question) => question.id === data.room.activeQuestion) || data.questions[0];
  const activeResponses = active ? data.responses.filter((response) => response.questionId === active.id) : [];
  return <main className="screen-view compact-presentation">
    <header className="screen-header compact-screen-header"><Logo /><button onClick={() => document.documentElement.requestFullscreen?.()}>Full screen</button></header>
    {data.room.ended ? <SessionReport data={data} compact /> : active ? <section className="screen-stage"><div className="screen-question-lock"><div className="question-type">{questionTypeLabel()}</div></div><h1 className="screen-question">{active.prompt}</h1><DisplayResponseBoard question={active} responses={data.responses} /><footer><b>{activeResponses.length}</b> live responses</footer></section>
      : <section className="screen-stage screen-waiting"><div className="loader" /><h1>Waiting for the first question</h1><p>Room {code.slice(0, 3)} {code.slice(3)}</p></section>}
  </main>;
}

function Presenter({ code, initial, onManage }: { code: string; initial: PollData | null; onManage: () => void }) {
  const [data, setData] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initial?.room.title || "");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/polls?code=" + code, { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }, [code]);

  useEffect(() => { refresh(); const timer = setInterval(refresh, 1200); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { setTitleDraft(data?.room.title || ""); }, [data?.room.code]);
  useEffect(() => {
    if (!showQr) return;
    QRCode.toDataURL(publicOrigin() + "/?room=" + code, {
      width: 360,
      margin: 2,
      color: { dark: "#17152d", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [showQr, code]);

  if (!data) return <main className="center"><div className="loader" /><p>Opening your room...</p></main>;

  const active = data.questions.find((question) => question.id === data.room.activeQuestion) || data.questions[0];
  const participants = new Set(data.responses.map((response) => response.participantId)).size;

  async function saveTitle() {
    if (!data) return;
    const title = titleDraft.trim();
    if (!title) { setTitleDraft(data.room.title); return; }
    if (title === data.room.title) return;
    const response = await presenterFetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateTitle", code, title }) });
    if (response.ok) setData(await response.json());
  }

  async function copyLink() {
    await navigator.clipboard.writeText(publicOrigin() + "/?room=" + code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function openPresentation() {
    window.open(publicOrigin() + "/?screen=" + code, "_blank", "noopener,noreferrer");
  }

  async function endSession() {
    if (!confirm("End this session and generate the consolidated report?")) return;
    const response = await presenterFetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "end", code }) });
    if (response.ok) setData(await response.json());
  }

  async function addQuestion(event: FormEvent) {
    event.preventDefault();
    if (!data || !draftPrompt.trim() || data.questions.length) return;
    setSaving(true);
    const response = await presenterFetch("/api/polls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addQuestion", code, type: "open", prompt: draftPrompt.trim(), options: [] }),
    });
    setSaving(false);
    if (response.ok) {
      setDraftPrompt("");
      setShowComposer(false);
      refresh();
    }
  }

  return <main className="presenter-shell">
    <aside className="sidebar"><Logo /><button className="session-nav" onClick={onManage}>← Session history</button><div className="deck-title"><span>SESSION TITLE</span><input className="session-title-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={saveTitle} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="Name this session" maxLength={80} aria-label="Session title" /></div>
      <nav className="question-list" aria-label="Question">{data.questions.map((question, index) => <div key={question.id} className="single-question"><span className="slide-number">{index + 1}</span><span className="mini-card"><small>{questionTypeLabel()}</small>{question.prompt}</span></div>)}</nav>
      {!data.questions.length && <button className="add-question" disabled={Boolean(data.room.ended)} onClick={() => setShowComposer(true)}>+ Add your question</button>}
    </aside>
    <section className="stage-wrap">
      <header className="topbar"><div className="live-pill"><span /> {data.room.ended ? "ENDED" : "LIVE"}</div><div className="room-share"><span>Join at <b>{publicHost()}</b></span><strong>{code.slice(0, 3)} {code.slice(3)}</strong><button onClick={() => setShowQr(true)}>Show QR</button><button onClick={copyLink}>{copied ? "Copied!" : "Copy link"}</button><button onClick={() => downloadResultsCsv(data)}>Export results</button><button className="present-button" onClick={openPresentation}>Open display</button>{!data.room.ended && <button className="end-button" onClick={endSession}>End session</button>}</div></header>
      {data.room.ended ? <SessionReport data={data} /> : data.questions.length ? <section className="stage admin-live-stage">
        <header className="admin-report-heading"><span>LIVE SESSION REPORT</span><h1>{data.room.title}</h1><p>Every question and response updates here as your audience submits.</p></header>
        <div className="admin-question-stack">{data.questions.map((question, index) => {
          const questionResponses = data.responses.filter((response) => response.questionId === question.id);
          const isActive = active?.id === question.id;
          return <article id={"admin-question-" + question.id} className={"admin-question-card" + (isActive ? " active" : "")} key={question.id}>
            <header><div className="admin-question-title"><span>{String(index + 1).padStart(2, "0")}</span><div><small>{questionTypeLabel()}</small><h2>{question.prompt}</h2></div></div><span className="on-display">On display</span></header>
            <Results question={question} responses={data.responses} frameless hideWallHeader />
            <footer><b>{questionResponses.length}</b> responses <span>Live updating</span></footer>
          </article>;
        })}</div>
      </section> : <section className="stage empty-deck"><span className="empty-mark">01</span><div className="question-type">BLANK SESSION</div><h1>Start with your first question.</h1><p>This room is fresh. Nothing is pre-filled or visible to participants until you add a question.</p><button onClick={() => setShowComposer(true)}>Add first question</button></section>}
      <footer className="stage-footer"><span className="response-count"><b>{data.responses.length}</b> total responses</span><span><b>{participants}</b> participants</span><span className="pulse-dot" /><span>Report updates live</span></footer>

      {showComposer && <div className="qr-backdrop" role="presentation" onMouseDown={() => setShowComposer(false)}>
        <form className="composer-dialog" onSubmit={addQuestion} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="qr-close" onClick={() => setShowComposer(false)} aria-label="Close question form">x</button>
          <span className="question-kicker">ONE OPEN QUESTION</span>
          <h2>Ask your audience</h2>
          <p className="composer-description">Write one prompt. Participants can answer in their own words.</p>
          <label>Your question<input autoFocus value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} placeholder="What would you like to ask?" maxLength={160} /></label>
          <button className="composer-submit" disabled={saving || !draftPrompt.trim()}>{saving ? "Starting..." : "Start question"}</button>
        </form>
      </div>}

      {showQr && <div className="qr-backdrop" role="presentation" onMouseDown={() => setShowQr(false)}>
        <section className="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="qr-close" onClick={() => setShowQr(false)} aria-label="Close QR code">x</button>
          <span className="question-kicker">SCAN TO JOIN</span>
          <h2 id="qr-title">Join the live conversation</h2>
          <p>Point your phone camera at the QR code. You will go straight to room <b>{code.slice(0, 3)} {code.slice(3)}</b>.</p>
          <div className="qr-frame">{qrDataUrl ? <img src={qrDataUrl} alt={"QR code to join room " + code} /> : <div className="loader" />}</div>
          <strong className="qr-url">{publicHost()}/?room={code}</strong>
          {publicHost() !== location.host && <p className="local-hint">Share this network address with participants on the same Wi-Fi.</p>}
        </section>
      </div>}
    </section>
  </main>;
}

function Audience({ code }: { code: string }) {
  const [data, setData] = useState<PollData | null>(null);
  const [answer, setAnswer] = useState("");
  const [name, setName] = useState("");
  const [sentFor, setSentFor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/polls?code=" + code, { cache: "no-store" });
    if (response.ok) setData(await response.json()); else setError("That room is not live yet.");
  }, [code]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 1500); return () => clearInterval(timer); }, [refresh]);
  const active = data?.questions.find((question) => question.id === data.room.activeQuestion);
  useEffect(() => { setAnswer(""); }, [active?.id]);

  async function submit(value: string) {
    if (!active || !value.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "vote", code, questionId: active.id, participantId: participantId(), displayName: name.trim().slice(0, 60) || anonymousDisplayName(), answer: value.trim().slice(0, 500) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not send your response. Please try again.");
      setSentFor(active.id);
      setAnswer("");
      refresh();
    } catch (submitFailure) {
      setSubmitError(submitFailure instanceof Error ? submitFailure.message : "Could not send your response. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <main className="audience-bg"><div className="phone-card error-card"><Logo /><h1>Room not found</h1><p>{error}</p><Link href="/">Try another code</Link></div></main>;
  if (!data) return <main className="center"><div className="loader" /><p>Joining room {code}...</p></main>;
  if (data.room.ended) return <main className="audience-bg"><header className="audience-header"><Logo /><span>Room <b>{code}</b></span></header><section className="phone-card waiting-card"><div className="thanks"><div>OK</div><h2>Session complete</h2><p>Thanks for taking part. Your responses are included in the final report.</p></div></section></main>;
  if (!active) return <main className="audience-bg"><header className="audience-header"><Logo /><span>Room <b>{code}</b></span></header><section className="phone-card waiting-card"><div className="loader" /><h1>Waiting for the first question</h1><p>The presenter is setting up this fresh session.</p></section></main>;

  const alreadySent = sentFor === active.id;
  return <main className="audience-bg"><header className="audience-header"><Logo /><span>Room <b>{code}</b></span></header><section className="phone-card">
    <span className="question-kicker">Question {active.position + 1} of {data.questions.length}</span><h1>{active.prompt}</h1>
    {alreadySent ? <div className="thanks"><div>OK</div><h2>Your response is in!</h2><p>Watch the shared screen for live results.</p><button onClick={() => setSentFor(null)}>Submit another response</button></div>
      : <form className="open-form" onSubmit={(event: FormEvent) => { event.preventDefault(); submit(answer); }}><label className="audience-name-field"><span>Name <small>optional</small></span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} aria-label="Your name (optional)" /></label><textarea autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Share your thoughts..." maxLength={500} rows={6} /><div className="open-form-footer"><small>{answer.length}/500 characters</small><button type="submit" disabled={!answer.trim() || submitting} aria-busy={submitting}>{submitting && <span className="button-loader" aria-hidden="true" />}{submitting ? "Sending..." : "Send response"}</button></div>{submitError && <p className="audience-submit-error" role="alert">{submitError}</p>}</form>}
  </section><p className="audience-note">Responses are anonymous</p></main>;
}

export default function Home() {
  const [mode, setMode] = useState<"landing" | "present" | "audience" | "screen" | "manage" | "auth">("landing");
  const [code, setCode] = useState("");
  const [data, setData] = useState<PollData | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<{ email?: string } | null>(null);
  const [routeReady, setRouteReady] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setAuthUser(data.session?.user || null); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setAuthUser(session?.user || null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const present = params.get("present");
    const room = params.get("room");
    const screen = params.get("screen");
    const manage = params.get("manage");
    if (manage) setMode("manage");
    else if (screen) { setCode(screen); setMode("screen"); }
    else if (present) { setCode(present); setMode("present"); }
    else if (room) { setCode(room); setMode("audience"); }
    setRouteReady(true);
  }, []);

  async function createRoom() {
    if (!authUser) { setMode("auth"); return; }
    setCreating(true);
    setCreateError("");
    try {
      const response = await presenterFetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
      const result = await response.json().catch(() => ({ error: "The server returned an invalid response." }));
      if (!response.ok) throw new Error(result.error || "Could not create the poll.");
      history.pushState({}, "", "?present=" + result.room.code);
      setCode(result.room.code);
      setData(result);
      setMode("present");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create the poll.");
    } finally {
      setCreating(false);
    }
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const clean = joinCode.replace(/\D/g, "").slice(0, 6);
    if (clean.length === 6) { history.pushState({}, "", "?room=" + clean); setCode(clean); setMode("audience"); }
  }

  function openManagement() {
    if (!authUser) { setMode("auth"); return; }
    history.pushState({}, "", "?manage=1");
    setMode("manage");
  }

  function openSessionFromHistory(sessionCode: string, view: "present" | "screen") {
    history.pushState({}, "", `/?${view}=${sessionCode}`);
    setCode(sessionCode);
    setData(null);
    setMode(view);
  }

  if (!routeReady) return <main className="center"><div className="loader" /><p>Opening Pulse...</p></main>;
  if (mode === "screen") return <PresentationScreen code={code} />;
  if (mode === "auth") return <AuthPanel onBack={() => { history.pushState({}, "", "/"); setMode("landing"); }} onSuccess={() => { history.pushState({}, "", "/"); setMode("landing"); }} />;
  if (mode === "present") return <Presenter code={code} initial={data} onManage={openManagement} />;
  if (mode === "audience") return <Audience code={code} />;
  if (mode === "manage") return <SessionManagement onCreate={createRoom} onBack={() => { history.pushState({}, "", "/"); setMode("landing"); }} onOpen={openSessionFromHistory} />;
  return <main className="landing"><nav><Logo /><div><a href="#how">How it works</a><a href="#formats">The format</a><button className="history-link" onClick={openManagement}>Session history</button>{authReady && authUser ? <button onClick={() => getSupabaseBrowserClient()?.auth.signOut()}>Sign out</button> : <button onClick={() => setMode("auth")}>Presenter sign in</button>}<button onClick={createRoom}>{creating ? "Creating..." : "Create question"}</button></div></nav>
    <section className="hero"><div className="hero-copy"><span className="eyebrow">ONE QUESTION. EVERY VOICE.</span><h1>Turn every audience into a <em>conversation.</em></h1><p>Ask one open-ended question. Collect thoughtful answers. Watch the room respond in real time.</p><div className="hero-actions"><button onClick={createRoom} disabled={creating}>{creating ? "Opening your room..." : "Start an open question"}<span>-&gt;</span></button><small>No sign-up needed</small>{createError && <small role="alert">{createError}</small>}</div></div>
      <div className="hero-visual" aria-label="Open question preview"><div className="float-badge badge-one">42 live</div><div className="float-badge badge-two">Anonymous answers</div><div className="preview-card"><div className="preview-top"><span>OPEN QUESTION</span><i>...</i></div><h2>What would make this session better?</h2><div className="preview-cloud"><b>More examples</b><span>Time to discuss</span><strong>Clear goals</strong><i>Small groups</i><em>Real feedback</em><small>More practice</small></div><div className="preview-foot"><span>42 responses</span><span>updating live</span></div></div></div>
    </section>
    <section className="join-strip" id="how"><div><strong>Already in the room?</strong><span>Enter the 6-digit code from the screen.</span></div><form onSubmit={join}><input inputMode="numeric" placeholder="000 000" value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="Room code" /><button>Join room -&gt;</button></form></section>
    <section className="format-row" id="formats"><span>Built for participation</span><div><b>01</b> One open-ended question</div><div><b>02</b> Anonymous text responses</div><div><b>03</b> Live response wall</div></section>
  </main>;
}
