import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../utils/api.js";
import { primaryBtn } from "../components/AuthForm.jsx";
import CameraPreview from "../components/CameraPreview.jsx";
import { useCamera } from "../hooks/useCamera.js";
import { useSpeechAnswer } from "../hooks/useSpeechAnswer.js";
import { useGazeTracker } from "../hooks/useGazeTracker.js";
import { useIntegrity } from "../hooks/useIntegrity.js";
import IntegrityBanner from "../components/IntegrityBanner.jsx";
import ViolationLog from "../components/ViolationLog.jsx";
import { canSpeak, speak, stopSpeaking, supportsVoiceInterview } from "../utils/speech.js";

const MAX_ANSWER_MS = 180000; // one answer can last at most 3 minutes
const MAX_CHARS = 3800; // the server accepts 4000 characters
const sec = (ms) => (ms / 1000).toFixed(1);

const MIC_ERRORS = {
  denied: "The microphone is blocked. Click the lock icon in the address bar, allow the microphone, then try again.",
  no_mic: "No microphone was found. Connect one and try again.",
  network: "Speech recognition needs an internet connection. Check your connection and try again.",
  unstable: "Speech recognition keeps stopping. Close other apps that use the microphone and try again.",
  unknown: "Speech recognition stopped working. Please try again.",
};

export default function VoiceInterview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [gate, setGate] = useState(true); // stays true until the candidate clicks start or continue
  const [phase, setPhase] = useState("idle"); // idle | presenting | listening | submitting | failed
  const [readAloud, setReadAloud] = useState(canSpeak());
  const [round, setRound] = useState(0); // goes up every time the server sends a new state
  const [starting, setStarting] = useState(false);
  const cam = useCamera();
  const sp = useSpeechAnswer();
  const gaze = useGazeTracker(cam.stream);
  const pending = useRef(null);
  const submitRef = useRef(null);
  const supported = supportsVoiceInterview();

  useEffect(() => {
    let cancelled = false;
    api(`/api/interview/${id}`)
      .then((s) => {
        if (cancelled) return;
        if (s.status === "mcq_in_progress" || s.status === "rejected") navigate(`/interview/${id}/mcq`, { replace: true });
        else setState(s);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => { cancelled = true; };
  }, [id, navigate]);

  function applyState(s) {
    setState(s);
    setRound((n) => n + 1);
    setPhase("idle");
    if (s.result && s.phase === "interview") {
      sp.cancel();
      stopSpeaking();
      cam.stop();
    }
  }

  async function begin() {
    setError("");
    setStarting(true);
    try {
      if (state.status === "mcq_passed") applyState(await api(`/api/interview/${id}/voice/start`, { method: "POST" }));
      gaze.calibrate();
      setGate(false);
    } catch (e) {
      if (e.body?.state) applyState(e.body.state);
      else setError(errorMessage(e));
    }
    setStarting(false);
  }

  // For every question: read it aloud (if switched on), then start listening.
  useEffect(() => {
    if (gate || !state?.turn) return;
    let cancelled = false;
    gaze.startQuestion();
    (async () => {
      setPhase("presenting");
      if (readAloud) await speak(state.turn.question);
      if (cancelled) return;
      setPhase(sp.begin() ? "listening" : "idle");
    })();
    return () => { cancelled = true; stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, state?.turn?.index, round]);

  async function send(payload) {
    pending.current = payload;
    setPhase("submitting");
    setError("");
    try {
      const s = await api(`/api/interview/${id}/voice/answer`, { method: "POST", body: payload });
      pending.current = null;
      applyState(s);
    } catch (e) {
      if (e.status === 409 && e.body?.state) { // the server is already further on: follow it
        pending.current = null;
        return applyState(e.body.state);
      }
      setError(errorMessage(e));
      setPhase("failed"); // nothing was stored, so the same answer can be sent again
    }
  }

  async function submit(skip = false) {
    if (phase !== "listening") return;
    setPhase("submitting");
    const turnIndex = state.turn.index;
    if (skip) {
      sp.cancel();
      return send({ turnIndex, answer: "", pauses: { initialPauseMs: 0, midPausesMs: [] }, gaze: gaze.drain() });
    }
    const { text, pauses } = await sp.finish();
    return send({ turnIndex, answer: text, pauses, gaze: gaze.drain() });
  }
  submitRef.current = submit;

  // An answer ends by itself after 3 minutes or when it gets too long.
  useEffect(() => {
    if (phase !== "listening") return;
    const t = setTimeout(() => submitRef.current(false), MAX_ANSWER_MS);
    return () => clearTimeout(t);
  }, [phase, round]);
  useEffect(() => {
    if (phase === "listening" && sp.text.length >= MAX_CHARS) submitRef.current(false);
  }, [sp.text, phase]);

  // Rule-break watch: only while the interview is running (not on the ready screen, where permission prompts appear).
  const integrity = useIntegrity({
    id,
    active: !gate && !!state?.turn,
    limit: state?.violations?.limit ?? 3,
    serverCount: state?.violations?.count ?? 0,
    onAutoSubmit: (s) => applyState(s),
  });

  // ---------- screens ----------
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

  if (state.result && state.phase === "interview") return <Result state={state} />;

  if (gate) {
    const resuming = state.status === "interview_in_progress";
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">{resuming ? "Welcome back" : "Voice interview"}</h1>
        <p className="mt-2 text-muted">
          {resuming
            ? `You are on question ${state.answered + 1} of ${state.total}. Your answer to this question starts again from the beginning.`
            : `You passed the multiple-choice round with ${state.mcq?.percent ?? state.result?.percent}%. Now you will answer a few questions out loud.`}
        </p>
        {!supported ? (
          <p role="alert" className="mt-6 rounded-md border border-line bg-surface p-4">
            The voice interview needs <strong>Google Chrome or Microsoft Edge on a computer</strong>, with a camera and microphone. Please open this page in one of those browsers.
          </p>
        ) : (
          <div className="mt-8 grid gap-8 md:grid-cols-[1fr_20rem]">
            <div>
              <ul className="space-y-2 text-muted">
                <li>You answer by speaking. Typing is switched off.</li>
                <li>Each new question is based on what you just said.</li>
                <li>Your camera stays on during the interview.</li>
                <li>Long silences are noted and shown with your results. A short pause to think is normal.</li>
                <li>Your camera is also used to notice if you look away from the screen for several seconds. This is worked out inside your browser: no pictures are sent anywhere, only a note of when it happened.</li>
                <li>
                  Switching to another tab or window, copying, cutting and pasting are not allowed and are recorded as warnings. After {state.violations?.limit ?? 3} warnings
                  the interview is submitted automatically and ends with a verdict of Reject. Right-click is turned off.
                </li>
                <li>Use Chrome or Edge, and keep your internet connection on, because speech recognition needs it.</li>
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {cam.status !== "on" && (
                  <button onClick={cam.start} disabled={cam.status === "asking"} className={primaryBtn + " w-auto px-6"}>
                    {cam.status === "asking" ? "Waiting for permission..." : "Turn on camera and microphone"}
                  </button>
                )}
                {cam.status === "on" && (
                  <button onClick={begin} disabled={starting} className={primaryBtn + " w-auto px-6"}>
                    {starting ? "Getting your first question..." : resuming ? "Continue the interview" : "Start the interview"}
                  </button>
                )}
              </div>
              {cam.status === "denied" && <p role="alert" className="mt-3 text-sm text-danger">Camera or microphone access was blocked. Click the lock icon in the address bar, allow both, then try again.</p>}
              {cam.status === "error" && <p role="alert" className="mt-3 text-sm text-danger">No camera or microphone could be opened. Check that they are connected and not used by another app.</p>}
              {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
              <Link to="/candidate" className="mt-6 inline-block text-sm text-brand underline">Back to dashboard</Link>
            </div>
            <div>
              <CameraPreview stream={cam.stream} status={cam.status} />
              <GazeStatus status={gaze.status} />
            </div>
          </div>
        )}
      </main>
    );
  }

  const turn = state.turn;
  const listening = phase === "listening";
  const statusLine = { presenting: "The interviewer is asking the question...", listening: "Listening. Speak your answer.", submitting: "Thinking about your answer...", failed: "Your answer could not be sent." }[phase] || "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="grid gap-8 md:grid-cols-[1fr_18rem]">
        <div className="order-2 md:order-1">
          <p className="font-display text-sm font-medium text-muted">Question {turn.index + 1} of {state.total}</p>
          <div className="mt-2 h-1.5 rounded-full bg-line" aria-hidden="true">
            <div className="h-1.5 rounded-full bg-brand" style={{ width: `${(state.answered / state.total) * 100}%` }} />
          </div>

          <IntegrityBanner {...integrity} />
          <h1 className="mt-6 select-none font-display text-2xl font-semibold leading-snug">{turn.question}</h1>
          <p className="mt-3 flex items-center gap-2 text-sm text-muted" aria-live="polite">
            {listening && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger" />}
            {statusLine}
            {listening && <span className="sr-only">Microphone on.</span>}
          </p>

          <div className="mt-4 min-h-[8rem] rounded-lg border border-line bg-surface p-4">
            <p className="text-xs text-muted">What we heard</p>
            <p className="mt-1" data-testid="transcript">
              {sp.text || <span className="text-muted">{listening ? "Start speaking. Your words will appear here." : "..."}</span>}
            </p>
          </div>
          <p className="mt-2 h-6 text-sm text-signal" aria-live="polite" data-testid="hint">
            {sp.hint === "initial" && "Take your time. We are listening."}
            {sp.hint === "mid" && "Still thinking? Take your time."}
          </p>

          {sp.state === "error" && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {MIC_ERRORS[sp.error]}{" "}
              <button onClick={() => sp.begin()} className="underline">Try listening again</button> (this clears what was heard so far)
            </p>
          )}
          {cam.status === "ended" && (
            <p role="alert" className="mt-2 text-sm text-danger">
              Your camera turned off. Please turn it back on. <button onClick={cam.start} className="underline">Turn on camera</button>
            </p>
          )}
          {phase === "failed" && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error} <button onClick={() => send(pending.current)} className="underline">Send it again</button>
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button onClick={() => submit(false)} disabled={!listening || !sp.text} className={primaryBtn + " w-auto px-6"}>
              Done answering
            </button>
            <button onClick={() => submit(true)} disabled={!listening} className="text-sm text-muted underline disabled:no-underline disabled:opacity-50">
              Skip this question
            </button>
            {canSpeak() && (
              <label className="ml-auto flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} />
                Read questions aloud
              </label>
            )}
          </div>
        </div>

        <div className="order-1 md:order-2">
          <div className="ml-auto w-40 md:ml-0 md:w-auto md:sticky md:top-20">
            <CameraPreview stream={cam.stream} status={cam.status} />
            <GazeStatus status={gaze.status} />
          </div>
        </div>
      </div>
    </main>
  );
}

const GAZE_LABEL = { looking_away: "Looked away from the screen", no_face: "Face not in view", multiple_faces: "More than one face in view" };

function GazeStatus({ status }) {
  const text = {
    idle: "",
    loading: "Gaze check: getting ready...",
    on: "Gaze check: on",
    unavailable: "Gaze check: not available. The interview works without it.",
  }[status];
  return text ? <p className="mt-2 text-xs text-muted" data-testid="gaze-status">{text}</p> : null;
}

function gazeSummary(g) {
  if (!g || g.status === "unavailable") return "Gaze tracking was not available, so where you looked was not checked.";
  const part = g.status === "partial" ? " Gaze tracking worked for only part of the interview." : "";
  if (g.events === 0) return `No looking away was noticed.${part}`;
  return `Looking away, or not being in view, was noticed ${g.events} time${g.events === 1 ? "" : "s"} (about ${Math.round(g.totalMs / 1000)} seconds in total).${part}`;
}

function Result({ state }) {
  const r = state.result;
  if (r.status === "abandoned") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">Interview closed</h1>
        <p className="mt-3 text-muted">
          This interview was left unfinished for too long, so it was closed after {r.answered} of {r.total} answers. You can start a new practice interview.
        </p>
        <Link to="/candidate" className={primaryBtn + " mt-6 inline-block w-auto px-6 text-center"}>Back to dashboard</Link>
      </main>
    );
  }
  const { scores, summary, turns } = r;
  const rows = [["Technical", scores.technical], ["Communication", scores.communication], ["Confidence", scores.confidence], ["Overall", scores.overall]];
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight">Voice interview finished</h1>
      <p className="mt-2 text-muted">You answered {r.answered} of {r.total} questions. Scores are out of 10 and come from an AI model, so treat them as a guide.</p>

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {rows.map(([label, v]) => (
          <div key={label} className="rounded-lg border border-line bg-surface p-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="font-display text-2xl font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-muted">
        You waited more than 5 seconds before answering {summary.longInitialCount} time{summary.longInitialCount === 1 ? "" : "s"} and paused for 3 seconds or more
        during an answer {summary.longMidCount} time{summary.longMidCount === 1 ? "" : "s"}.
        {summary.avgInitialMs !== null && ` On average you started speaking after ${sec(summary.avgInitialMs)} seconds.`}
      </p>
      <p className="mt-3 text-muted" data-testid="gaze-summary">{gazeSummary(r.gaze)}</p>
      <ViolationLog state={state} />
      <Link to="/candidate" className={primaryBtn + " mt-6 inline-block w-auto px-6 text-center"}>Back to dashboard</Link>

      {turns && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Your answers</h2>
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {turns.map((t) => (
              <li key={t.index} className="py-4">
                <p className="font-medium">{t.index + 1}. {t.question}</p>
                <p className="mt-2 text-sm text-muted">{t.answer ? t.answer : "Skipped."}</p>
                <p className="mt-2 text-sm">
                  Technical {t.evaluation.technical}, communication {t.evaluation.communication}, confidence {t.evaluation.confidence}, overall {t.evaluation.overall}.
                </p>
                <p className="mt-1 text-sm">{t.evaluation.feedback}</p>
                {t.answer && (
                  <p className="mt-1 text-sm text-muted">
                    Waited {sec(t.pauses.initialMs)} s before answering{t.pauses.longInitial ? " (a long pause)" : ""}.
                    {t.pauses.longMidCount > 0 && ` ${t.pauses.longMidCount} pause${t.pauses.longMidCount === 1 ? "" : "s"} of 3 seconds or more during the answer.`}
                  </p>
                )}
                {t.gaze?.events?.length > 0 && (
                  <ul className="mt-1 text-sm text-muted">
                    {t.gaze.events.map((e, i) => (
                      <li key={i}>{GAZE_LABEL[e.type]} for about {Math.max(1, Math.round(e.durationMs / 1000))} s, {Math.round(e.atMs / 1000)} s into the answer.</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
