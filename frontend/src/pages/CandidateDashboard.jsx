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
  mcq_in_progress: "In progress",
  mcq_passed: "Passed the multiple-choice round",
  rejected: "Below 60%, Reject",
};

export default function CandidateDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ role: "", level: "mid", count: 10 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null); // null while loading
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    api("/api/interview/history")
      .then((d) => setHistory(d.interviews))
      .catch(() => { setHistory([]); setHistoryError(true); });
  }, []);

  async function start(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const s = await api("/api/interview/start", { method: "POST", body: { ...form, count: Number(form.count) } });
      navigate(`/interview/${s.id}/mcq`);
    } catch (err) {
      if (err.body?.interviewId) return navigate(`/interview/${err.body.interviewId}/mcq`); // already running: carry on with it
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight">Hello, {user.name}</h1>
      <p className="mt-1 text-muted">Practice interviews start with a timed multiple-choice round.</p>

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
              <label htmlFor="count" className="mb-1 block text-sm font-medium">Number of questions</label>
              <select id="count" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                {COUNTS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <p className="text-sm text-muted">
            Each question is timed, and when time runs out the next question appears. Score 60% or more to move on to the voice interview.
            Below 60% the interview ends.
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
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">{h.role} <span className="text-muted">({h.level})</span></p>
                  <p className="text-sm text-muted">
                    {new Date(h.createdAt).toLocaleString()} · {STATUS[h.status]}
                    {h.status !== "mcq_in_progress" && ` · ${h.correctCount} of ${h.total} (${h.percent}%)`}
                  </p>
                </div>
                <Link to={`/interview/${h.id}/mcq`} className="text-sm text-brand underline">
                  {h.status === "mcq_in_progress" ? "Continue" : "View result"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
