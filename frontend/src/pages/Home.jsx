import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth, homeFor } from "../context/AuthContext.jsx";
import InterviewPreview from "../components/InterviewPreview.jsx";

const steps = [
  {
    title: "Multiple-choice round",
    body: "Answer questions written for your role and level. Each question has 30 seconds. Score 60% or higher to move on.",
  },
  {
    title: "Voice interview on camera",
    body: "Speak your answers. Each new question follows from what you just said. Typing is switched off.",
  },
  {
    title: "Scored report",
    body: "Recruiters see your scores, how long you paused and any moments that were flagged. Practice runs also get a four-week study plan.",
  },
];

const candidates = [
  "Practice for a role and level you choose",
  "Upload your resume to get questions about your own experience",
  "See separate scores for technical skill, communication and confidence",
  "Get a four-week study plan after a practice interview",
];
const recruiters = [
  "Create a session and send candidates an invite link",
  "Sort candidates by recommendation, score or date",
  "Watch the recording of each interview",
  "Review pauses and flagged moments next to the scores",
];

const rules = [
  ["Hire", "Score of 7.5 or higher and no flagged moments."],
  ["Consider", "Score of 7.5 or higher with flagged moments, or a score from 5.5 to 7.4."],
  ["Reject", "Score below 5.5, an MCQ score below 60%, or an interview that was auto-submitted after repeated violations."],
];

export default function Home() {
  const { user } = useAuth();
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:py-20">
        <div>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Interviews that follow the conversation
          </h1>
          <p className="mt-5 max-w-prose text-lg text-muted">
            Pass a timed multiple-choice round, then talk through a voice interview where every question builds on your last answer.
            Recruiters get scored reports they can compare side by side.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {user ? (
              <Link to={homeFor(user.role)} className="rounded-md bg-brand px-5 py-2.5 font-medium text-brand-ink hover:opacity-90">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/register" className="rounded-md bg-brand px-5 py-2.5 font-medium text-brand-ink hover:opacity-90">
                  Create account
                </Link>
                <Link to="/login" className="rounded-md border border-line px-5 py-2.5 font-medium hover:bg-surface">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
        <InterviewPreview />
      </section>

      <section id="how-it-works" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight">How an interview runs</h2>
          <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-0">
            {steps.map((s, i) => (
              <li key={s.title} className={`md:px-8 md:first:pl-0 md:last:pr-0 ${i > 0 ? "md:border-l md:border-line" : ""}`}>
                <p className="font-display text-sm font-medium text-brand">Step {i + 1}</p>
                <h3 className="mt-1 font-display text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 max-w-prose text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">If you are applying</h2>
            <ul className="mt-5 space-y-3 text-muted">
              {candidates.map((t) => <li key={t} className="max-w-prose">{t}</li>)}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">If you are hiring</h2>
            <ul className="mt-5 space-y-3 text-muted">
              {recruiters.map((t) => <li key={t} className="max-w-prose">{t}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-2xl font-bold tracking-tight">How recommendations are decided</h2>
          <p className="mt-2 max-w-prose text-muted">The same rules apply to every candidate, and recruiters can see which one applied.</p>
          <dl className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
            {rules.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr] sm:gap-6">
                <dt className="font-display text-lg font-semibold">{k}</dt>
                <dd className="text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
