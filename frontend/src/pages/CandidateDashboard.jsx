import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api, errorMessage } from "../utils/api.js";
import { Field, primaryBtn } from "../components/AuthForm.jsx";

const LEVELS = [
  ["junior", "Junior"],
  ["mid", "Mid level"],
  ["senior", "Senior"],
];
const COUNTS = [5, 10, 15];
const STATUS = {
  mcq_in_progress: "Multiple-choice round in progress",
  mcq_passed: "Passed the multiple-choice round",
  rejected: "Below 60%, Reject",
  interview_in_progress: "Voice interview in progress",
  completed: "Completed",
  abandoned: "Voice interview left unfinished",
};

// Where each interview should open, and what the link says.
function linkFor(h) {
  switch (h.status) {
    case "mcq_in_progress": return [`/interview/${h.id}/mcq`, "Continue"];
    case "rejected": return [`/interview/${h.id}/mcq`, "View result"];
    case "mcq_passed": return [`/interview/${h.id}/voice`, "Continue to the voice interview"];
    case "interview_in_progress": return [`/interview/${h.id}/voice`, "Continue"];
    default: return [`/interview/${h.id}/voice`, "View result"];
  }
}

function scoreLine(h) {
  if (h.status === "mcq_in_progress") return "";
  const mcq = `Multiple-choice ${h.correctCount} of ${h.total} (${h.percent}%)`;
  if (h.status === "completed" && h.voice) return ` · ${mcq} · Voice interview ${h.voice.overall} out of 10`;
  if (h.status === "interview_in_progress" && h.voice) return ` · ${mcq} · Voice question ${h.voice.answered} of ${h.voice.total}`;
  return ` · ${mcq}`;
}

export default function CandidateDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ role: "", level: "mid", count: 10 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null); // null while loading
  const [historyError, setHistoryError] = useState(false);
  const [limit, setLimit] = useState(3); // how many warnings end an interview (set by the server)

  useEffect(() => {
    api("/api/interview/history")
      .then((d) => { setHistory(d.interviews); if (d.violationLimit) setLimit(d.violationLimit); })
      .catch(() => { setHistory([]); setHistoryError(true); });
  }, []);

  async function start(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const s = await api("/api/interview/start", { method: "POST", body: { ...form, count: Number(form.count) } });
      navigate(`/interview/${s.id}/mcq`);
    } catch (err) {
      if (err.body?.interviewId) return navigate(`/interview/${err.body.interviewId}/mcq`); // already running: carry on with it (the page redirects to the right phase)
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight">Hello, {user.name}</h1>
      <p className="mt-1 text-muted">A practice interview has two parts: a timed multiple-choice round, then a voice interview on camera.</p>

      <section className="mt-8 rounded-lg border border-line bg-surface p-5">
        <h2 className="font-display text-xl font-semibold">Start a practice interview</h2>
        <form onSubmit={start} className="mt-4 space-y-4">
          <Field id="role" label="Role you are practising for" placeholder="Backend developer" required minLength={2} maxLength={80}
            value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="level" className="mb-1 block text-sm font-medium">Level</label>
              <select id="level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="count" className="mb-1 block text-sm font-medium">Multiple-choice questions</label>
              <select id="count" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                {COUNTS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <p className="text-sm text-muted">
            Each multiple-choice question is timed, and when time runs out the next one appears. Score 60% or more to move on to the voice interview.
            Below 60% the interview ends.
          </p>
          <p className="text-sm text-muted">
            While an interview is running, switching to another tab or window, copying, cutting and pasting are recorded as warnings. After {limit} warnings the interview is submitted
            automatically and ends with a verdict of Reject. Right-click is turned off.
          </p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button disabled={busy} className={primaryBtn + " sm:w-auto sm:px-6"}>{busy ? "Preparing questions..." : "Start"}</button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Your interviews</h2>
        {history === null && <p className="mt-3 text-muted">Loading...</p>}
        {historyError && <p className="mt-3 text-sm text-danger">Could not load your history.</p>}
        {history && history.length === 0 && !historyError && <p className="mt-3 text-muted">Nothing yet. Start your first practice interview above.</p>}
        {history && history.length > 0 && (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {history.map((h) => {
              const [to, label] = linkFor(h);
              return (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium">{h.role} <span className="text-muted">({h.level})</span></p>
                    <p className="text-sm text-muted">
                      {new Date(h.createdAt).toLocaleString()} · {STATUS[h.status]}
                      {scoreLine(h)}
                    </p>
                  </div>
                  <Link to={to} className="text-sm text-brand underline">{label}</Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
