import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../utils/api.js";
import { primaryBtn } from "../components/AuthForm.jsx";
import { useIntegrity } from "../hooks/useIntegrity.js";
import IntegrityBanner from "../components/IntegrityBanner.jsx";
import ViolationLog from "../components/ViolationLog.jsx";

const LETTERS = ["A", "B", "C", "D"];
const clock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

export default function McqInterview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [left, setLeft] = useState(0); // milliseconds left for the current question
  const deadline = useRef(0);
  const selectedRef = useRef(null);
  const sent = useRef(false); // an answer for this question is already on its way
  const autoTried = useRef(false); // the timer has already tried to send for this question

  // Show a new state from the server and restart the clock from the time the SERVER says is left.
  const apply = useCallback((s) => {
    if (s.status === "interview_in_progress" || s.status === "completed" || s.status === "abandoned") {
      navigate(`/interview/${s.id}/voice`, { replace: true }); // already past this round
      return;
    }
    setState(s);
    setSelected(null);
    selectedRef.current = null;
    sent.current = false;
    autoTried.current = false;
    setSubmitting(false);
    setError("");
    if (s.current) {
      deadline.current = performance.now() + s.current.remainingMs;
      setLeft(s.current.remainingMs);
    }
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    api(`/api/interview/${id}`)
      .then((s) => !cancelled && apply(s))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => { cancelled = true; };
  }, [id, apply]);

  const choose = useCallback((i) => {
    if (sent.current) return;
    selectedRef.current = i;
    setSelected(i);
  }, []);

  const submit = useCallback(async () => {
    if (sent.current || !state?.current) return;
    sent.current = true;
    setSubmitting(true);
    setError("");
    try {
      const s = await api(`/api/interview/${id}/mcq/answer`, {
        method: "POST",
        body: { questionIndex: state.current.index, selectedIndex: selectedRef.current },
      });
      apply(s);
    } catch (e) {
      if (e.status === 409 && e.body?.state) return apply(e.body.state); // the server moved on (time ran out): follow it
      sent.current = false;
      setSubmitting(false);
      setError(errorMessage(e));
    }
  }, [id, state, apply]);

  // Countdown. When it reaches zero the current choice (or no answer) is sent and the next question appears.
  useEffect(() => {
    if (!state?.current) return;
    const t = setInterval(() => {
      const rem = Math.max(0, deadline.current - performance.now());
      setLeft(rem);
      if (rem <= 0 && !autoTried.current) {
        autoTried.current = true;
        submit();
      }
    }, 200);
    return () => clearInterval(t);
  }, [state, submit]);

  // Keys 1 to 4 pick an option.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4) choose(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose]);

  // Rule-break watch: only while a question is on screen. The server counts and may end the round.
  const integrity = useIntegrity({
    id,
    active: !!state?.current,
    limit: state?.violations?.limit ?? 3,
    serverCount: state?.violations?.count ?? 0,
    onAutoSubmit: apply,
  });

  if (!state) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        {error ? (
          <>
            <p role="alert" className="text-danger">{error}</p>
            <Link to="/candidate" className="mt-4 inline-block text-brand underline">Back to dashboard</Link>
          </>
        ) : (
          <p className="text-muted">Loading...</p>
        )}
      </main>
    );
  }

  if (state.result) return <Result state={state} />;

  const { current, total, limitSeconds } = state;
  const secs = Math.ceil(left / 1000);
  const low = secs <= 10;
  const last = current.index === total - 1;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="flex items-baseline justify-between">
        <p className="font-display text-sm font-medium text-muted">
          Question {current.index + 1} of {total}
        </p>
        <p role="timer" aria-label="Time left" className="font-display text-2xl font-bold tabular-nums" style={{ color: low ? "var(--signal)" : "var(--ink)" }}>
          {clock(secs)}
        </p>
      </div>
      <div className="mt-2 h-2 rounded-full bg-line" aria-hidden="true">
        <div className="h-2 rounded-full" style={{ width: `${(left / (limitSeconds * 1000)) * 100}%`, background: low ? "var(--signal)" : "var(--brand)" }} />
      </div>
      <p className="sr-only" aria-live="polite">{secs === 10 ? "10 seconds left" : secs === 5 ? "5 seconds left" : ""}</p>
      <IntegrityBanner {...integrity} />

      <fieldset key={current.index} className="mt-8" disabled={submitting}>
        <legend className="select-none font-display text-xl font-semibold leading-snug">{current.question}</legend>
        <div className="mt-5 space-y-3">
          {current.options.map((opt, i) => (
            <label key={i}
              className={`flex cursor-pointer select-none items-start gap-3 rounded-md border p-3.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand ${
                selected === i ? "border-brand bg-surface" : "border-line hover:bg-surface"
              }`}>
              <input type="radio" name="option" className="sr-only" checked={selected === i} onChange={() => choose(i)} />
              <span className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm font-medium ${
                selected === i ? "border-brand bg-brand text-brand-ink" : "border-line text-muted"
              }`}>{LETTERS[i]}</span>
              <span>{opt}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error} <button onClick={submit} className="underline">Try again</button>
        </p>
      )}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-sm text-muted">Answers are shown at the end. <span className="hidden sm:inline">Press 1 to 4 to choose. </span>If time runs out, your current choice is sent.</p>
        <button onClick={submit} disabled={selected === null || submitting} className={primaryBtn + " sm:w-auto sm:shrink-0 sm:px-6"}>
          {submitting ? "Sending..." : last ? "Finish" : "Next"}
        </button>
      </div>
    </main>
  );
}

function Result({ state }) {
  const r = state.result;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight">
        {r.passed ? "You passed the multiple-choice round" : "Multiple-choice round finished"}
      </h1>
      <p className="mt-2 text-lg">
        You answered {r.correctCount} of {r.total} correctly ({r.percent}%). The pass mark is {r.passPercent}%.
      </p>
      {r.passed ? (
        <p className="mt-3 text-muted">Next comes the voice interview on camera. You will answer by speaking, and each question follows from your last answer.</p>
      ) : (
        state.autoSubmitted ? (
        <p className="mt-3 text-muted">The round was submitted automatically, so the interview ends here with a verdict of <strong className="text-ink">{r.verdict}</strong>. You can start another practice interview whenever you like.</p>
      ) : (
        <p className="mt-3 text-muted">Your score is below the pass mark, so the interview ends here with a verdict of <strong className="text-ink">{r.verdict}</strong>. You can start another practice interview whenever you like.</p>
      )
      )}
      <ViolationLog state={state} />

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {r.passed && <Link to={`/interview/${state.id}/voice`} className={primaryBtn + " inline-block w-auto px-6 text-center"}>Start the voice interview</Link>}
        <Link to="/candidate" className={r.passed ? "text-brand underline" : primaryBtn + " inline-block w-auto px-6 text-center"}>Back to dashboard</Link>
      </div>

      {r.review && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Review</h2>
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {r.review.map((q, i) => (
              <li key={i} className="py-4">
                <p className="font-medium">{i + 1}. {q.question}</p>
                <p className="mt-1 text-sm">
                  <strong>{q.timedOut ? "Time ran out" : q.correct ? "Correct" : "Incorrect"}.</strong>{" "}
                  {q.timedOut ? "No answer was sent." : `You chose ${LETTERS[q.selectedIndex]}: ${q.options[q.selectedIndex]}.`}
                </p>
                {!q.correct && <p className="text-sm">Correct answer: {LETTERS[q.correctIndex]}: {q.options[q.correctIndex]}.</p>}
                {q.explanation && <p className="mt-1 text-sm text-muted">{q.explanation}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
