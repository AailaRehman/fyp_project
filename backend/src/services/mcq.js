/* MCQ round rules. Pure functions: no database, no network, so they are easy to test.
   The server owns the clock and the answer key. The browser only shows questions and sends choices. */

export const PASS_PERCENT = 60;
export const GRACE_MS = 2000; // allowance for network delay when an answer arrives just after the limit
export const IN_PROGRESS = "mcq_in_progress";

export class StateError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const ms = (d) => new Date(d).getTime();

export function buildInterview({ candidateId, role, level, questions, limitSeconds, now, mode = "practice" }) {
  return {
    candidate: candidateId,
    mode,
    role,
    level,
    status: IN_PROGRESS,
    verdict: null,
    verdictReason: null,
    mcq: {
      questions: questions.map((q) => ({
        question: q.question,
        options: q.options,
        correctIndex: q.correct_index,
        explanation: q.explanation || "",
      })),
      answers: [],
      currentIndex: 0,
      questionStartedAt: now,
      limitSeconds,
      correctCount: 0,
      percent: null,
      passed: null,
      completedAt: null,
    },
  };
}

export function remainingMs(doc, now) {
  const limit = doc.mcq.limitSeconds * 1000;
  const left = limit - (ms(now) - ms(doc.mcq.questionStartedAt));
  return Math.max(0, Math.min(limit, left));
}

function finish(doc, at) {
  const m = doc.mcq;
  const total = m.questions.length;
  m.completedAt = at;
  m.percent = Math.round((m.correctCount * 1000) / total) / 10;
  m.passed = m.correctCount * 100 >= PASS_PERCENT * total; // integer maths, so 6 of 10 is exactly 60%
  doc.status = m.passed ? "mcq_passed" : "rejected";
  doc.verdict = m.passed ? null : "Reject";
  doc.verdictReason = m.passed ? null : "mcq_below_60";
}

function record(doc, selectedIndex, at) {
  const m = doc.mcq;
  const i = m.currentIndex;
  const correct = selectedIndex !== null && selectedIndex === m.questions[i].correctIndex;
  m.answers.push({ index: i, selectedIndex, correct, timedOut: selectedIndex === null, answeredAt: at });
  if (correct) m.correctCount += 1;
  m.currentIndex = i + 1;
  if (m.currentIndex >= m.questions.length) finish(doc, at);
  else m.questionStartedAt = at;
}

/** Marks every question whose time (plus the grace allowance) has passed as timed out.
    Refreshing the page or closing the tab therefore never gives extra time. Returns true if anything changed. */
export function expireOverdue(doc, now) {
  const m = doc.mcq;
  const limit = m.limitSeconds * 1000;
  let changed = false;
  while (doc.status === IN_PROGRESS && ms(now) - ms(m.questionStartedAt) > limit + GRACE_MS) {
    record(doc, null, new Date(ms(m.questionStartedAt) + limit));
    changed = true;
  }
  return changed;
}

export function submitAnswer(doc, { questionIndex, selectedIndex }, now) {
  expireOverdue(doc, now);
  if (doc.status !== IN_PROGRESS) throw new StateError("not_in_progress");
  if (questionIndex !== doc.mcq.currentIndex) throw new StateError("stale_question");
  record(doc, selectedIndex, now);
}

export function result(doc) {
  const m = doc.mcq;
  const total = m.questions.length;
  const out = {
    correctCount: m.correctCount,
    total,
    percent: m.percent,
    passed: m.passed,
    verdict: doc.verdict,
    verdictReason: doc.verdictReason,
    passPercent: PASS_PERCENT,
    nextPhase: m.passed ? "interview" : null,
  };
  if (doc.mode === "practice") {
    // Practice rounds show the answer key once the round is over. Recruiter sessions will not.
    out.review = m.questions.map((q, i) => ({
      question: q.question,
      options: Array.from(q.options),
      selectedIndex: m.answers[i].selectedIndex ?? null,
      correctIndex: q.correctIndex,
      correct: m.answers[i].correct,
      timedOut: m.answers[i].timedOut,
      explanation: q.explanation,
    }));
  }
  return out;
}

/** What the browser is allowed to see. While the round runs there is no answer key in here. */
export function publicState(doc, now) {
  const m = doc.mcq;
  const base = {
    id: String(doc._id),
    role: doc.role,
    level: doc.level,
    mode: doc.mode,
    status: doc.status,
    total: m.questions.length,
    limitSeconds: m.limitSeconds,
  };
  if (doc.status === IN_PROGRESS) {
    const q = m.questions[m.currentIndex];
    return {
      ...base,
      current: { index: m.currentIndex, question: q.question, options: Array.from(q.options), remainingMs: remainingMs(doc, now) },
    };
  }
  return { ...base, result: result(doc) };
}
