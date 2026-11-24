import * as mcq from "./mcq.js";
import * as voice from "./voice.js";
import { countedViolations } from "./violations.js";

export const OPEN_STATUSES = [mcq.IN_PROGRESS, voice.VOICE_IN_PROGRESS];

/** The one place that decides what the browser sees, whichever phase the interview is in. */
export function publicState(doc, now, { violationLimit = 3 } = {}) {
  const base = voice.isVoiceStatus(doc.status) ? voice.publicVoiceState(doc) : mcq.publicState(doc, now);
  return { ...base, autoSubmitted: !!doc.autoSubmitted, violations: violationView(doc, violationLimit) };
}

/** What the candidate may see about rule breaks: how many count, and the log. */
function violationView(doc, limit) {
  return {
    count: countedViolations(doc),
    limit,
    items: Array.from(doc.violations ?? [], (v) => ({ type: v.type, phase: v.phase, questionNumber: v.questionNumber, counted: v.counted })),
  };
}

/** One line per interview for the history list. */
export function summary(doc) {
  const m = doc.mcq;
  const v = doc.voice;
  const started = v?.turns?.length > 0;
  return {
    id: String(doc._id),
    role: doc.role,
    level: doc.level,
    mode: doc.mode,
    status: doc.status,
    verdict: doc.verdict,
    total: m.questions.length,
    answered: m.answers.length,
    correctCount: m.correctCount,
    percent: m.percent,
    voice: started
      ? {
          total: v.total,
          answered: v.turns.filter((t) => t.answer !== null && t.answer !== undefined).length,
          overall: doc.status === voice.COMPLETED ? v.scores.overall : null,
          gazeEvents: doc.status === voice.COMPLETED ? v.gaze.events : null,
        }
      : null,
    violations: countedViolations(doc),
    autoSubmitted: !!doc.autoSubmitted,
    createdAt: doc.createdAt,
  };
}
