"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type Question = { id: number; type: "choice" | "rating" | "word"; prompt: string; options: string[]; position: number };
type PollData = {
  room: { code: string; title: string; activeQuestion: number; ended: number };
  questions: Question[];
  responses: { id: number; questionId: number; answer: string; participantId: string; createdAt: string }[];
};
const palette = ["#6255f6", "#ff6b8a", "#19b9a1", "#f5a524", "#4588ff"];
const wordPalette = ["#ff7a45", "#b853eb", "#aebcff", "#ddff58", "#99e0d7", "#8bc2ff", "#e7c9c3", "#9bd400", "#ffadb5", "#ef91c5", "#42b8e8", "#ffd11a", "#a8c9a8"];

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

function Results({ question, responses, wordView = "cloud", wallTitle, frameless = false, hideWallHeader = false }: { question: Question; responses: PollData["responses"]; wordView?: "cloud" | "messages"; wallTitle?: string; frameless?: boolean; hideWallHeader?: boolean }) {
  const answers = responses.filter((response) => response.questionId === question.id);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    answers.forEach(({ answer }) => map.set(answer, (map.get(answer) || 0) + 1));
    return map;
  }, [answers]);

  if (question.type === "word") {
    const words = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const maxCount = Math.max(1, ...words.map(([, count]) => count));
    if (wordView === "messages") {
      const messages = [...answers].reverse();
      return <section className={"response-wall" + (frameless ? " frameless-wall" : "")}>
        {!hideWallHeader && <header><span>Live responses</span><h2>{wallTitle || "Wall of responses"}</h2><p>{answers.length} submissions</p></header>}
        <div className="wall-grid">
          {messages.length ? messages.map((response, index) => <article className="wall-card" key={response.id} style={{ borderTopColor: wordPalette[index % wordPalette.length] }}><p>{response.answer}</p></article>) : <p className="empty">Responses will appear here as they arrive.</p>}
        </div>
      </section>;
    }
    const offsets = [-14, 8, -4, 14, -8, 4, -12, 10, -2, 13, -10, 6];
    return <div className="word-cloud cloud-pills" aria-label="Live word cloud">
      {words.length ? words.map(([word, count], index) => {
        const weight = count / maxCount;
        return <span key={word} style={{
          background: wordPalette[index % wordPalette.length],
          fontSize: (0.95 + weight * 0.55) + "rem",
          padding: (9 + weight * 5) + "px " + (16 + weight * 10) + "px",
          transform: "translateY(" + offsets[index % offsets.length] + "px)",
          zIndex: Math.round(weight * 10),
        }}><i />{word}<b>{count > 1 ? count : ""}</b></span>;
      }) : <p className="empty">Words will appear here as people answer.</p>}
    </div>;
  }

  const labels = question.type === "rating" ? ["1", "2", "3", "4", "5"] : question.options;
  const max = Math.max(1, ...labels.map((label) => counts.get(label) || 0));
  return <div className="bars">{labels.map((label, index) => {
    const count = counts.get(label) || 0;
    return <div className="bar-row" key={label}><div className="bar-label"><span>{label}</span><strong>{count}</strong></div><div className="bar-track"><div className="bar-fill" style={{ width: (count ? Math.max(8, count / max * 100) : 0) + "%", background: palette[index % palette.length] }} /></div></div>;
  })}</div>;
}

function DisplayResponseBoard({ question, responses }: { question: Question; responses: PollData["responses"] }) {
  const answers = responses.filter((response) => response.questionId === question.id);
  const boardRef = useRef<HTMLDivElement>(null);
  const [followingLatest, setFollowingLatest] = useState(true);
  const [atTop, setAtTop] = useState(true);

  const goToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const board = boardRef.current;
    if (!board) return;
    setFollowingLatest(true);
    board.scrollTo({ top: board.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (followingLatest) goToLatest(answers.length > 9 ? "smooth" : "auto");
  }, [answers.length, followingLatest, goToLatest]);

  function trackScroll() {
    const board = boardRef.current;
    if (!board) return;
    setAtTop(board.scrollTop < 8);
    setFollowingLatest(board.scrollHeight - board.scrollTop - board.clientHeight < 18);
  }

  return <section className="display-response-board">
    <header><span>Live responses</span><h2>{question.prompt}</h2><div><p>{answers.length} submissions</p><button onClick={() => goToLatest()} disabled={followingLatest}>Latest</button></div></header>
    <div ref={boardRef} onScroll={trackScroll} className={"display-board-grid" + (!atTop ? " fading-top" : "")}>
      {answers.length ? answers.map((response, index) => <article className="display-response-card" key={response.id} style={{ borderTopColor: wordPalette[index % wordPalette.length] }}><p>{response.answer}</p></article>) : <p className="empty">Responses will appear here as they arrive.</p>}
    </div>
  </section>;
}
function SessionReport({ data, compact = false }: { data: PollData; compact?: boolean }) {
  const participants = new Set(data.responses.map((response) => response.participantId)).size;
  return <section className={"session-report" + (compact ? " compact-report" : "")}>
    <div className="report-heading"><div><span className="question-type">SESSION COMPLETE</span><h1>{data.room.title}</h1><h2 className="report-subtitle">Consolidated report</h2><p>Every submitted response is included in this summary.</p></div>
      <div className="report-metrics"><div><strong>{data.responses.length}</strong><span>Total responses</span></div><div><strong>{participants}</strong><span>Participants</span></div><div><strong>{data.questions.length}</strong><span>Questions</span></div></div>
    </div>
    <div className="report-questions">{data.questions.map((question, index) => {
      const responses = data.responses.filter((response) => response.questionId === question.id);
      return <article className="report-question" key={question.id}><div className="report-question-title"><span>{String(index + 1).padStart(2, "0")}</span><div><small>{question.type}</small><h2>{question.prompt}</h2><p>{responses.length} responses</p></div></div><Results question={question} responses={data.responses} wordView="messages" frameless hideWallHeader /></article>;
    })}</div>
  </section>;
}

function PresentationScreen({ code }: { code: string }) {
  const [data, setData] = useState<PollData | null>(null);
  const [wordDisplay, setWordDisplay] = useState<"wall" | "cloud">("wall");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/polls?code=" + code, { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }, [code]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 1000); return () => clearInterval(timer); }, [refresh]);
  function exitDisplay() { if (window.opener) window.close(); else location.href = "/"; }
  if (!data) return <main className="screen-view center"><div className="loader" /><p>Loading presentation...</p></main>;
  const active = data.questions.find((question) => question.id === data.room.activeQuestion) || data.questions[0];
  const activeResponses = active ? data.responses.filter((response) => response.questionId === active.id) : [];
  return <main className="screen-view">
    <header className="screen-header"><Logo /><div className="screen-session-title">{data.room.title}</div><div className="screen-join"><span>Join at <b>{location.host}</b></span><strong>{code.slice(0, 3)} {code.slice(3)}</strong></div>{active?.type === "word" && <button onClick={() => setWordDisplay(wordDisplay === "wall" ? "cloud" : "wall")}>{wordDisplay === "wall" ? "Cloud view" : "Wall view"}</button>}<button onClick={() => document.documentElement.requestFullscreen?.()}>Full screen</button><button onClick={exitDisplay}>Exit display</button></header>
    {data.room.ended ? <SessionReport data={data} compact /> : active ? <section className="screen-stage">{!(active.type === "word" && wordDisplay === "wall") && <><div className="question-type">{active.type === "choice" ? "MULTIPLE CHOICE" : active.type === "rating" ? "RATING SCALE" : "WORD CLOUD"}</div><h1>{active.prompt}</h1></>}{active.type === "word" && wordDisplay === "wall" ? <DisplayResponseBoard question={active} responses={data.responses} /> : <Results question={active} responses={data.responses} wordView="cloud" />}<footer><b>{activeResponses.length}</b> live responses</footer></section>
      : <section className="screen-stage screen-waiting"><div className="loader" /><h1>Waiting for the first question</h1><p>Room {code.slice(0, 3)} {code.slice(3)}</p></section>}
  </main>;
}

function Presenter({ code, initial }: { code: string; initial: PollData | null }) {
  const [data, setData] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [draftType, setDraftType] = useState<Question["type"]>("choice");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftOptions, setDraftOptions] = useState("");
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
    QRCode.toDataURL(location.origin + "/?room=" + code, {
      width: 360,
      margin: 2,
      color: { dark: "#17152d", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [showQr, code]);

  if (!data) return <main className="center"><div className="loader" /><p>Opening your room...</p></main>;

  const active = data.questions.find((question) => question.id === data.room.activeQuestion) || data.questions[0];
  const activeResponses = active ? data.responses.filter((response) => response.questionId === active.id) : [];
  const participants = new Set(data.responses.map((response) => response.participantId)).size;

  async function activate(id: number) {
    await fetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", code, questionId: id }) });
    await refresh();
    document.getElementById("admin-question-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveTitle() {
    const title = titleDraft.trim();
    if (!title) { setTitleDraft(data.room.title); return; }
    if (title === data.room.title) return;
    const response = await fetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateTitle", code, title }) });
    if (response.ok) setData(await response.json());
  }

  async function copyLink() {
    await navigator.clipboard.writeText(location.origin + "/?room=" + code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function openPresentation() {
    window.open(location.origin + "/?screen=" + code, "_blank", "noopener,noreferrer");
  }

  async function endSession() {
    if (!confirm("End this session and generate the consolidated report?")) return;
    const response = await fetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "end", code }) });
    if (response.ok) setData(await response.json());
  }

  async function addQuestion(event: FormEvent) {
    event.preventDefault();
    const options = draftType === "choice" ? draftOptions.split("\n").map((option) => option.trim()).filter(Boolean) : [];
    if (!draftPrompt.trim() || (draftType === "choice" && options.length < 2)) return;
    setSaving(true);
    const response = await fetch("/api/polls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addQuestion", code, type: draftType, prompt: draftPrompt.trim(), options }),
    });
    setSaving(false);
    if (response.ok) {
      setDraftPrompt("");
      setDraftOptions("");
      setShowComposer(false);
      refresh();
    }
  }

  return <main className="presenter-shell">
    <aside className="sidebar"><Logo /><div className="deck-title"><span>SESSION TITLE</span><input className="session-title-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={saveTitle} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="Name this session" maxLength={80} aria-label="Session title" /></div>
      <nav className="question-list" aria-label="Questions">{data.questions.map((question, index) => <button key={question.id} className={active?.id === question.id ? "active" : ""} onClick={() => activate(question.id)}><span className="slide-number">{index + 1}</span><span className="mini-card"><small>{question.type}</small>{question.prompt}</span></button>)}</nav>
      <button className="add-question" disabled={Boolean(data.room.ended)} onClick={() => setShowComposer(true)}>+ Add question</button>
    </aside>
    <section className="stage-wrap">
      <header className="topbar"><div className="live-pill"><span /> {data.room.ended ? "ENDED" : "LIVE"}</div><div className="room-share"><span>Join at <b>{location.host}</b></span><strong>{code.slice(0, 3)} {code.slice(3)}</strong><button onClick={() => setShowQr(true)}>Show QR</button><button onClick={copyLink}>{copied ? "Copied!" : "Copy link"}</button><button className="present-button" onClick={openPresentation}>Open display</button>{!data.room.ended && <button className="end-button" onClick={endSession}>End session</button>}</div></header>
      {data.room.ended ? <SessionReport data={data} /> : data.questions.length ? <section className="stage admin-live-stage">
        <header className="admin-report-heading"><span>LIVE SESSION REPORT</span><h1>{data.room.title}</h1><p>Every question and response updates here as your audience submits.</p></header>
        <div className="admin-question-stack">{data.questions.map((question, index) => {
          const questionResponses = data.responses.filter((response) => response.questionId === question.id);
          const isActive = active?.id === question.id;
          return <article id={"admin-question-" + question.id} className={"admin-question-card" + (isActive ? " active" : "")} key={question.id}>
            <header><div className="admin-question-title"><span>{String(index + 1).padStart(2, "0")}</span><div><small>{question.type}</small><h2>{question.prompt}</h2></div></div><button onClick={() => activate(question.id)} disabled={isActive}>{isActive ? "On display" : "Present this"}</button></header>
            <Results question={question} responses={data.responses} wordView="messages" frameless hideWallHeader />
            <footer><b>{questionResponses.length}</b> responses <span>Live updating</span></footer>
          </article>;
        })}</div>
      </section> : <section className="stage empty-deck"><span className="empty-mark">01</span><div className="question-type">BLANK SESSION</div><h1>Start with your first question.</h1><p>This room is fresh. Nothing is pre-filled or visible to participants until you add a question.</p><button onClick={() => setShowComposer(true)}>Add first question</button></section>}
      <footer className="stage-footer"><span className="response-count"><b>{data.responses.length}</b> total responses</span><span><b>{participants}</b> participants</span><span className="pulse-dot" /><span>Report updates live</span></footer>

      {showComposer && <div className="qr-backdrop" role="presentation" onMouseDown={() => setShowComposer(false)}>
        <form className="composer-dialog" onSubmit={addQuestion} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="qr-close" onClick={() => setShowComposer(false)} aria-label="Close question form">x</button>
          <span className="question-kicker">NEW QUESTION</span>
          <h2>Create a question</h2>
          <label>Question type<select value={draftType} onChange={(event) => setDraftType(event.target.value as Question["type"])}><option value="choice">Multiple choice</option><option value="word">Word cloud</option><option value="rating">Rating scale</option></select></label>
          <label>Your question<input autoFocus value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} placeholder="What would you like to ask?" maxLength={160} /></label>
          {draftType === "choice" && <label>Answer choices<textarea value={draftOptions} onChange={(event) => setDraftOptions(event.target.value)} placeholder={"First choice\nSecond choice\nThird choice"} rows={4} /><small>Enter one choice per line. Add at least two.</small></label>}
          <button className="composer-submit" disabled={saving || !draftPrompt.trim() || (draftType === "choice" && draftOptions.split("\n").filter((option) => option.trim()).length < 2)}>{saving ? "Adding..." : "Add to live deck"}</button>
        </form>
      </div>}

      {showQr && <div className="qr-backdrop" role="presentation" onMouseDown={() => setShowQr(false)}>
        <section className="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="qr-close" onClick={() => setShowQr(false)} aria-label="Close QR code">x</button>
          <span className="question-kicker">SCAN TO JOIN</span>
          <h2 id="qr-title">Join the live conversation</h2>
          <p>Point your phone camera at the QR code. You will go straight to room <b>{code.slice(0, 3)} {code.slice(3)}</b>.</p>
          <div className="qr-frame">{qrDataUrl ? <img src={qrDataUrl} alt={"QR code to join room " + code} /> : <div className="loader" />}</div>
          <strong className="qr-url">{location.host}/?room={code}</strong>
          {(location.hostname === "localhost" || location.hostname === "127.0.0.1") && <p className="local-hint">For phone scanning, open this presenter page using your computer's Wi-Fi address first.</p>}
        </section>
      </div>}
    </section>
  </main>;
}

function Audience({ code }: { code: string }) {
  const [data, setData] = useState<PollData | null>(null);
  const [answer, setAnswer] = useState("");
  const [sentFor, setSentFor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/polls?code=" + code, { cache: "no-store" });
    if (response.ok) setData(await response.json()); else setError("That room is not live yet.");
  }, [code]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 1500); return () => clearInterval(timer); }, [refresh]);
  const active = data?.questions.find((question) => question.id === data.room.activeQuestion);
  useEffect(() => { setAnswer(""); }, [active?.id]);

  async function submit(value: string) {
    if (!active || !value.trim()) return;
    const response = await fetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "vote", code, questionId: active.id, participantId: participantId(), answer: value.trim().slice(0, 48) }) });
    if (response.ok) { setSentFor(active.id); setAnswer(""); refresh(); }
  }

  if (error) return <main className="audience-bg"><div className="phone-card error-card"><Logo /><h1>Room not found</h1><p>{error}</p><a href="/">Try another code</a></div></main>;
  if (!data) return <main className="center"><div className="loader" /><p>Joining room {code}...</p></main>;
  if (data.room.ended) return <main className="audience-bg"><header className="audience-header"><Logo /><span>Room <b>{code}</b></span></header><section className="phone-card waiting-card"><div className="thanks"><div>OK</div><h2>Session complete</h2><p>Thanks for taking part. Your responses are included in the final report.</p></div></section></main>;
  if (!active) return <main className="audience-bg"><header className="audience-header"><Logo /><span>Room <b>{code}</b></span></header><section className="phone-card waiting-card"><div className="loader" /><h1>Waiting for the first question</h1><p>The presenter is setting up this fresh session.</p></section></main>;

  const alreadySent = sentFor === active.id;
  return <main className="audience-bg"><header className="audience-header"><Logo /><span>Room <b>{code}</b></span></header><section className="phone-card">
    <span className="question-kicker">Question {active.position + 1} of {data.questions.length}</span><h1>{active.prompt}</h1>
    {alreadySent ? <div className="thanks"><div>OK</div><h2>Your response is in!</h2><p>Watch the shared screen for live results.</p><button onClick={() => setSentFor(null)}>Submit another response</button></div>
      : active.type === "choice" ? <div className="answer-options">{active.options.map((option, index) => <button key={option} onClick={() => submit(option)}><i style={{ background: palette[index % palette.length] }}>{String.fromCharCode(65 + index)}</i>{option}<span>&gt;</span></button>)}</div>
      : active.type === "rating" ? <div className="rating"><div>{[1, 2, 3, 4, 5].map((value) => <button key={value} onClick={() => submit(String(value))}>{value}</button>)}</div><p><span>Not at all</span><span>Extremely</span></p></div>
      : <form className="word-form" onSubmit={(event: FormEvent) => { event.preventDefault(); submit(answer); }}><input autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type one word..." maxLength={48} /><button disabled={!answer.trim()}>Send response</button></form>}
  </section><p className="audience-note">Responses are anonymous</p></main>;
}

export default function Home() {
  const [mode, setMode] = useState<"landing" | "present" | "audience" | "screen">("landing");
  const [code, setCode] = useState("");
  const [data, setData] = useState<PollData | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const present = params.get("present");
    const room = params.get("room");
    const screen = params.get("screen");
    if (screen) { setCode(screen); setMode("screen"); }
    else if (present) { setCode(present); setMode("present"); }
    else if (room) { setCode(room); setMode("audience"); }
  }, []);

  async function createRoom() {
    setCreating(true);
    const response = await fetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
    const result = await response.json();
    history.pushState({}, "", "?present=" + result.room.code);
    setCode(result.room.code);
    setData(result);
    setMode("present");
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const clean = joinCode.replace(/\D/g, "").slice(0, 6);
    if (clean.length === 6) { history.pushState({}, "", "?room=" + clean); setCode(clean); setMode("audience"); }
  }

  if (mode === "screen") return <PresentationScreen code={code} />;
  if (mode === "present") return <Presenter code={code} initial={data} />;
  if (mode === "audience") return <Audience code={code} />;
  return <main className="landing"><nav><Logo /><div><a href="#how">How it works</a><a href="#formats">Formats</a><button onClick={createRoom}>{creating ? "Creating..." : "Create a poll"}</button></div></nav>
    <section className="hero"><div className="hero-copy"><span className="eyebrow">THE ROOM IS YOURS</span><h1>Turn every audience into a <em>conversation.</em></h1><p>Ask better questions. Watch ideas gather in real time. Give every voice a place on screen.</p><div className="hero-actions"><button onClick={createRoom} disabled={creating}>{creating ? "Opening your room..." : "Start a live session"}<span>-&gt;</span></button><small>No sign-up needed</small></div></div>
      <div className="hero-visual" aria-label="Live poll preview"><div className="float-badge badge-one">42 live</div><div className="float-badge badge-two">Instant insights</div><div className="preview-card"><div className="preview-top"><span>LIVE QUESTION</span><i>...</i></div><h2>What makes a great team?</h2><div className="preview-cloud"><b>Trust</b><span>Curiosity</span><strong>Kindness</strong><i>Clarity</i><em>Momentum</em><small>Listening</small></div><div className="preview-foot"><span>42 responses</span><span>updating live</span></div></div></div>
    </section>
    <section className="join-strip" id="how"><div><strong>Already in the room?</strong><span>Enter the 6-digit code from the screen.</span></div><form onSubmit={join}><input inputMode="numeric" placeholder="000 000" value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="Room code" /><button>Join room -&gt;</button></form></section>
    <section className="format-row" id="formats"><span>Built for participation</span><div><b>01</b> Live polls</div><div><b>02</b> Word clouds</div><div><b>03</b> Rating scales</div><div><b>04</b> Consolidated results</div></section>
  </main>;
}
