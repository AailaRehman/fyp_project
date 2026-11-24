/* Layer 1 anti-cheating rules. Pure functions: no database, no network.
   The browser only reports what it noticed. The server decides what it means: which question it happened on,
   whether it counts, and when the interview has to end. */
import { COUNTED_VIOLATION_TYPES } from "../constants.js";
import { IN_PROGRESS, StateError, abortRound } from "./mcq.js";
import { VOICE_IN_PROGRESS, abortVoice } from "./voice.js";

export const COALESCE_MS = 1500; // two reports this close together are one incident (a tab switch also blurs the window)
export const MAX_STORED = 100;
export const MAX_AGO_MS = 120000; // how far back a delayed report may claim the event happened

const ms = (d) => new Date(d).getTime();

export const countedViolations = (doc) => Array.from(doc.violations ?? []).filter((v) => v.counted).length;

/** Records one violation. Returns what happened: { recorded, counted, autoSubmitted }. */
export function recordViolation(doc, { type, agoMs = 0 }, now, limit) {
  if (doc.status !== IN_PROGRESS && doc.status !== VOICE_IN_PROGRESS) throw new StateError("not_in_progress");
  const list = doc.violations;
  const at = new Date(ms(now) - Math.min(Math.max(0, Math.round(agoMs)), MAX_AGO_MS));
  const last = list.length ? list[list.length - 1] : null;
  if (list.length >= MAX_STORED || (last && Math.abs(ms(at) - ms(last.at)) < COALESCE_MS)) {
    return { recorded: false, counted: false, autoSubmitted: false };
  }
  const phase = doc.status === IN_PROGRESS ? "mcq" : "voice";
  const questionNumber = (phase === "mcq" ? doc.mcq.currentIndex : doc.voice.currentIndex) + 1;
  const counted = COUNTED_VIOLATION_TYPES.includes(type);
  list.push({ type, at, phase, questionNumber, counted });
  let autoSubmitted = false;
  if (counted && countedViolations(doc) >= limit) {
    if (phase === "mcq") abortRound(doc, now);
    else abortVoice(doc, now);
    autoSubmitted = true;
  }
  return { recorded: true, counted, autoSubmitted };
}
