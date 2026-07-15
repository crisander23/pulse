"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Question = { id: number; type: "choice" | "rating" | "word"; prompt: string; options: string[]; position: number };
type PollData = {
  room: { code: string; title: string; activeQuestion: number };
  questions: Question[];
  responses: { questionId: number; answer: string; participantId: string }[];
};
const palette = ["#6255f6", "#ff6b8a", "#19b9a1", "#f5a524", "#4588ff"];

function participantId() {
  const key = "pulse-participant";
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
function Logo() {
  return <div className="logo" aria-label="Pulse"><span className="logo-mark"><i /><i /><i /></span><span>pulse</span></div>;
}
function Results({ question, responses }: { question: Question; responses: PollData["responses"] }) {
  const answers = responses.filter((response) => response.questionId === question.id);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    answers.forEach(({ answer }) => map.set(answer, (map.get(answer) || 0) + 1));
    return map;
  }, [answers]);
  if (question.type === "word") {
    const words = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return <div className="word-cloud" aria-label="Live word cloud">
      {words.length ? words.map(([word, count], index) => <span key={word} style={{ color: palette[index % palette.length], fontSize: Math.min(2.9, 1.05 + count * .34) + "rem" }}>{word}</span>) : <p className="empty">Words will bloom here as people answer.</p>}
    </div>;
  }
  const labels = question.type === "rating" ? ["1", "2", "3", "4", "5"] : question.options;
  const max = Math.max(1, ...labels.map((label) => counts.get(label) || 0));
  return <div className="bars">{labels.map((label, index) => {
    const count = counts.get(label) || 0;
    return <div className="bar-row" key={label}><div className="bar-label"><span>{label}</span><strong>{count}</strong></div><div className="bar-track"><div className="bar-fill" style={{ width: (count ? Math.max(8, count / max * 100) : 0) + "%", background: palette[index % palette.length] }} /></div></div>;
  })}</div>;
}
function Presenter({ code, initial }: { code: string; initial: PollData | null }) {
  const [data, setData] = useState(initial);
  const [copied, setCopied] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/polls?code=" + code, { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }, [code]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 1200); return () => clearInterval(timer); }, [refresh]);
  if (!data) return <main className="center"><div className="loader" /><p>Opening your room…</p></main>;
  const active = data.questions.find((question) => question.id === data.room.activeQuestion) || data.questions[0];
  const activeResponses = data.responses.filter((response) => response.questionId === active.id);
  const participants = new Set(data.responses.map((response) => response.participantId)).size;
  async function activate(id: number) {
    await fetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", code, questionId: id }) });
    refresh();
  }
  async function copyLink() {
    await navigator.clipboard.writeText(location.origin + "/?room=" + code);
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  }
  return <main className="presenter-shell">
    <aside className="sidebar"><Logo /><div className="deck-title"><span>LIVE DECK</span><strong>{data.room.title}</strong></div>
      <nav className="question-list" aria-label="Questions">{data.questions.map((question, index) => <button key={question.id} className={active.id === question.id ? "active" : ""} onClick={() => activate(question.id)}><span className="slide-number">{index + 1}</span><span className="mini-card"><small>{question.type}</small>{question.prompt}</span></button>)}</nav>
      <button className="add-question" onClick={() => alert("Your first deck includes three ready-to-run question formats.")}>＋ Add question</button>
    </aside>
    <section className="stage-wrap"><header className="topbar"><div className="live-pill"><span /> LIVE</div><div className="room-share"><span>Join at <b>{location.host}</b></span><strong>{code.slice(0, 3)} {code.slice(3)}</strong><button onClick={copyLink}>{copied ? "Copied!" : "Copy link"}</button></div><div className="avatar">PD</div></header>
      <section className="stage"><div className="question-type">{active.type === "choice" ? "MULTIPLE CHOICE" : active.type === "rating" ? "RATING SCALE" : "WORD CLOUD"}</div><h1>{active.prompt}</h1><Results question={active} responses={data.responses} /></section>
      <footer className="stage-footer"><span className="response-count"><b>{activeResponses.length}</b> responses</span><span><b>{participants}</b> participants</span><span className="pulse-dot" /><span>Results update live</span></footer>
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
    if (response.ok) setData(await response.json()); else setError("That room isn’t live yet.");
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
  if (!active || !data) return <main className="center"><div className="loader" /><p>Joining room {code}…</p></main>;
  const alreadySent = sentFor === active.id || data.responses.some((r) => r.questionId === active.id && typeof window !== "undefined" && r.participantId === participantId());
  return <main className="audience-bg"><header className="audience-header"><Logo /><span>Room <b>{code}</b></span></header><section className="phone-card">
    <span className="question-kicker">Question {active.position + 1} of {data.questions.length}</span><h1>{active.prompt}</h1>
    {alreadySent ? <div className="thanks"><div>✓</div><h2>Your response is in!</h2><p>Watch the shared screen for live results.</p><button onClick={() => setSentFor(null)}>Change response</button></div>
      : active.type === "choice" ? <div className="answer-options">{active.options.map((option, index) => <button key={option} onClick={() => submit(option)}><i style={{ background: palette[index % palette.length] }}>{String.fromCharCode(65 + index)}</i>{option}<span>›</span></button>)}</div>
      : active.type === "rating" ? <div className="rating"><div>{[1, 2, 3, 4, 5].map((value) => <button key={value} onClick={() => submit(String(value))}>{value}</button>)}</div><p><span>Not at all</span><span>Extremely</span></p></div>
      : <form className="word-form" onSubmit={(event: FormEvent) => { event.preventDefault(); submit(answer); }}><input autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type one word…" maxLength={48} /><button disabled={!answer.trim()}>Send response</button></form>}
  </section><p className="audience-note">Responses are anonymous</p></main>;
}
export default function Home() {
  const [mode, setMode] = useState<"landing" | "present" | "audience">("landing");
  const [code, setCode] = useState("");
  const [data, setData] = useState<PollData | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.search); const present = params.get("present"); const room = params.get("room");
    if (present) { setCode(present); setMode("present"); } else if (room) { setCode(room); setMode("audience"); }
  }, []);
  async function createRoom() {
    setCreating(true);
    const response = await fetch("/api/polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
    const result = await response.json(); history.pushState({}, "", "?present=" + result.room.code); setCode(result.room.code); setData(result); setMode("present");
  }
  function join(event: FormEvent) {
    event.preventDefault(); const clean = joinCode.replace(/\D/g, "").slice(0, 6);
    if (clean.length === 6) { history.pushState({}, "", "?room=" + clean); setCode(clean); setMode("audience"); }
  }
  if (mode === "present") return <Presenter code={code} initial={data} />;
  if (mode === "audience") return <Audience code={code} />;
  return <main className="landing"><nav><Logo /><div><a href="#how">How it works</a><a href="#formats">Formats</a><button onClick={createRoom}>{creating ? "Creating…" : "Create a poll"}</button></div></nav>
    <section className="hero"><div className="hero-copy"><span className="eyebrow">THE ROOM IS YOURS</span><h1>Turn every audience into a <em>conversation.</em></h1><p>Ask better questions. Watch ideas gather in real time. Give every voice a place on screen.</p><div className="hero-actions"><button onClick={createRoom} disabled={creating}>{creating ? "Opening your room…" : "Start a live session"}<span>→</span></button><small>No sign-up needed</small></div></div>
      <div className="hero-visual" aria-label="Live poll preview"><div className="float-badge badge-one">● 42 live</div><div className="float-badge badge-two">✦ Instant insights</div><div className="preview-card"><div className="preview-top"><span>LIVE QUESTION</span><i>•••</i></div><h2>What makes a great team?</h2><div className="preview-cloud"><b>Trust</b><span>Curiosity</span><strong>Kindness</strong><i>Clarity</i><em>Momentum</em><small>Listening</small></div><div className="preview-foot"><span>42 responses</span><span>↗ updating live</span></div></div></div>
    </section>
    <section className="join-strip" id="how"><div><strong>Already in the room?</strong><span>Enter the 6-digit code from the screen.</span></div><form onSubmit={join}><input inputMode="numeric" placeholder="000 000" value={joinCode} onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="Room code" /><button>Join room →</button></form></section>
    <section className="format-row" id="formats"><span>Built for participation</span><div><b>▥</b> Live polls</div><div><b>✦</b> Word clouds</div><div><b>◉</b> Rating scales</div><div><b>↗</b> Consolidated results</div></section>
  </main>;
}