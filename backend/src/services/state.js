import * as mcq from "./mcq.js";
import * as voice from "./voice.js";

export const OPEN_STATUSES = [mcq.IN_PROGRESS, voice.VOICE_IN_PROGRESS];

/** The one place that decides what the browser sees, whichever phase the interview is in. */
export function publicState(doc, now) {
  return voice.isVoiceStatus(doc.status) ? voice.publicVoiceState(doc) : mcq.publicState(doc, now);
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
    createdAt: doc.createdAt,
  };
}
