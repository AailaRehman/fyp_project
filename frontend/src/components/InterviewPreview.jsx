import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

const QUESTION = "Tell me about a time you had to debug a problem in production.";
const ANSWER = "We had a memory leak in our Node service. I took heap snapshots and found an event listener that was never removed.";
const FOLLOW_UP = "You mentioned heap snapshots. What did you look for in them first?";
const TRACK = 8;      // seconds shown on the meter
const LONG_PAUSE = 5; // seconds before the gentle prompt appears
const FINAL_PAUSE = 6;

export default function InterviewPreview() {
  const reduce = useReducedMotion();
  const [typed, setTyped] = useState(reduce ? ANSWER.length : 0);
  const [pause, setPause] = useState(reduce ? FINAL_PAUSE : 0);
  const [showNext, setShowNext] = useState(!!reduce);

  useEffect(() => {
    if (reduce) { setTyped(ANSWER.length); setPause(FINAL_PAUSE); setShowNext(true); return; }
    const timers = [];
    const intervals = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));

    later(900, () => {
      let i = 0;
      const typing = setInterval(() => {
        i += 1; setTyped(i);
        if (i >= ANSWER.length) {
          clearInterval(typing);
          let s = 0;
          const wait = setInterval(() => {
            s = Math.min(s + 0.1, FINAL_PAUSE); setPause(s);
            if (s >= FINAL_PAUSE) { clearInterval(wait); later(800, () => setShowNext(true)); }
          }, 50);
          intervals.push(wait);
        }
      }, 26);
      intervals.push(typing);
    });

    return () => { timers.forEach(clearTimeout); intervals.forEach(clearInterval); };
  }, [reduce]);

  const long = pause >= LONG_PAUSE;

  return (
    <figure aria-label="Sample interview" className="rounded-lg border border-line bg-surface">
      <p className="sr-only">
        Sample interview. Question: {QUESTION} Answer: {ANSWER} After a long pause the candidate sees a gentle prompt.
        Next question, based on the answer: {FOLLOW_UP}
      </p>
      <div aria-hidden="true">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm text-muted">
          <span>Sample interview: backend developer, mid level</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-danger" /> Recording
          </span>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_8.5rem]">
          <div>
            <p className="font-display text-lg font-medium leading-snug">{QUESTION}</p>
            <p className="mt-3 min-h-[5.5rem] text-sm text-muted">
              {ANSWER.slice(0, typed)}
              {typed < ANSWER.length && <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-ink" />}
            </p>
          </div>
          <div className="hidden aspect-[4/3] items-end justify-center overflow-hidden rounded-md bg-line sm:flex">
            <svg viewBox="0 0 80 60" className="w-full text-muted" fill="currentColor" opacity="0.55">
              <circle cx="40" cy="24" r="10" />
              <path d="M16 60c2-14 12-20 24-20s22 6 24 20Z" />
            </svg>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-baseline justify-between text-xs text-muted">
            <span>Pause before answering</span>
            <span className="tabular-nums">{pause.toFixed(0)}s</span>
          </div>
          <div className="relative mt-1.5 h-2 rounded-full bg-line">
            <div
              className="h-2 rounded-full"
              style={{ width: `${(pause / TRACK) * 100}%`, background: long ? "var(--signal)" : "var(--brand)" }}
            />
            <div className="absolute -top-1 h-4 w-px bg-ink/60" style={{ left: `${(LONG_PAUSE / TRACK) * 100}%` }} />
          </div>
          <p className="mt-2 h-5 text-sm text-signal">{long ? "Take your time. We are still listening." : ""}</p>
        </div>

        <div
          className="border-t border-line px-4 py-3 transition-opacity duration-500"
          style={{ opacity: showNext ? 1 : 0.15 }}
        >
          <p className="text-xs text-muted">Next question, based on your answer</p>
          <p className="mt-1 font-display text-base font-medium">{FOLLOW_UP}</p>
        </div>
      </div>
    </figure>
  );
}
