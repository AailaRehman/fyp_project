/* Voice interview (phase 2) rules. Pure functions: no database, no network.
   The browser measures pauses and sends them with the answer, but the server never trusts them blindly:
   they are capped by the time that really passed between asking the question and receiving the answer. */
import { StateError } from "./mcq.js";

export const VOICE_IN_PROGRESS = "interview_in_progress";
export const COMPLETED = "completed";
export const ABANDONED = "abandoned";
export const LONG_INITIAL_MS = 5000; // silence before answering that counts as a long pause
export const LONG_MID_MS = 3000; // silence in the middle of an answer that is logged
export const SLACK_MS = 1500; // allowance for the browser and server clocks not matching exactly
export const GAZE_SAMPLE_MS = 2000; // the browser checks the camera image about every 2 seconds
export const GAZE_EVENT_TYPES = ["looking_away", "no_face", "multiple_faces"];

const ms = (d) => new Date(d).getTime();
const round1 = (x) => Math.round(x * 10) / 10;

export const isVoiceStatus = (s) => s === VOICE_IN_PROGRESS || s === COMPLETED || s === ABANDONED;

export function startVoice(doc, first, { total, now }) {
  if (doc.status !== "mcq_passed") throw new StateError("mcq_not_passed");
  doc.status = VOICE_IN_PROGRESS;
  doc.voice = {
    total,
    currentIndex: 0,
    turns: [{ index: 0, question: first.question, type: first.type, askedAt: now, answer: null }],
    startedAt: now,
    lastActivityAt: now,
    completedAt: null,
    scores: { technical: null, communication: null, confidence: null, overall: null },
    gaze: { status: null, events: 0, lookingAway: 0, noFace: 0, multipleFaces: 0, totalMs: 0, samples: 0, expectedSamples: 0 },
    summary: { answered: 0, longInitialCount: 0, longMidCount: 0, avgInitialMs: null },
  };
}

/** Keeps only pause data that fits inside the time that really passed. */
export function sanitizePauses(p, elapsedMs) {
  const cap = Math.max(0, Math.round(elapsedMs));
  const claimedInitial = Math.max(0, Math.round(p?.initialPauseMs ?? 0));
  const claimedMids = (p?.midPausesMs ?? []).map((x) => Math.max(0, Math.round(x))).filter((x) => x >= LONG_MID_MS);
  const claimed = claimedInitial + claimedMids.reduce((a, b) => a + b, 0);
  const initialMs = Math.min(claimedInitial, cap);
  let room = cap - initialMs;
  const midMs = [];
  for (const m of claimedMids) {
    if (m <= room) {
      midMs.push(m);
      room -= m;
    }
  }
  return {
    initialMs,
    midMs,
    longInitial: initialMs > LONG_INITIAL_MS,
    longMidCount: midMs.length,
    inconsistent: claimed > cap + SLACK_MS,
  };
}

/** Keeps only gaze data that is plausible for the time that really passed. */
export function sanitizeGaze(g, elapsedMs) {
  const cap = Math.max(0, Math.round(elapsedMs));
  if (!g || g.status !== "on") {
    return { status: "unavailable", reason: g?.reason ?? "not_reported", samples: 0, faceSamples: 0, events: [] };
  }
  const samples = Math.min(Math.round(g.samples), Math.floor(cap / 1000) + 2); // cannot have more checks than time allows
  const faceSamples = Math.min(Math.round(g.faceSamples), samples);
  const events = (g.events ?? [])
    .filter((e) => GAZE_EVENT_TYPES.includes(e.type))
    .slice(0, Math.floor(samples / 2)) // an event needs at least two checks in a row
    .map((e) => {
      const atMs = Math.min(Math.max(0, Math.round(e.atMs)), cap);
      const durationMs = Math.min(Math.max(0, Math.round(e.durationMs)), Math.max(0, cap - atMs) + GAZE_SAMPLE_MS);
      return { type: e.type, atMs, durationMs };
    });
  return { status: "on", reason: null, samples, faceSamples, events };
}

function summariseGaze(answered) {
  const g = answered.map((t) => t.gaze).filter(Boolean);
  const tracked = g.filter((x) => x.status === "on").length;
  const all = g.flatMap((x) => Array.from(x.events ?? []));
  const count = (type) => all.filter((e) => e.type === type).length;
  return {
    status: tracked === 0 ? "unavailable" : tracked === answered.length ? "on" : "partial",
    events: all.length,
    lookingAway: count("looking_away"),
    noFace: count("no_face"),
    multipleFaces: count("multiple_faces"),
    totalMs: all.reduce((s, e) => s + e.durationMs, 0),
    samples: g.reduce((s, x) => s + (x.samples ?? 0), 0),
    expectedSamples: Math.round(answered.reduce((s, t) => s + (t.elapsedMs ?? 0), 0) / GAZE_SAMPLE_MS),
  };
}

function finishVoice(doc, at) {
  const v = doc.voice;
  const answered = v.turns.filter((t) => t.answer !== null && t.answer !== undefined);
  const spoken = answered.filter((t) => t.answer !== "");
  const mean = (k) => round1(answered.reduce((s, t) => s + t.evaluation[k], 0) / answered.length);
  v.scores = { technical: mean("technical"), communication: mean("communication"), confidence: mean("confidence"), overall: mean("overall") };
  v.summary = {
    answered: answered.length,
    longInitialCount: answered.filter((t) => t.pauses.longInitial).length,
    longMidCount: answered.reduce((s, t) => s + t.pauses.longMidCount, 0),
    // a skipped question has no wait to measure, so it is left out of the average
    avgInitialMs: spoken.length ? Math.round(spoken.reduce((s, t) => s + t.pauses.initialMs, 0) / spoken.length) : null,
  };
  v.gaze = summariseGaze(answered);
  v.completedAt = at;
  doc.status = COMPLETED;
}

/** Stores the answer and its evaluation, then either asks the next question or finishes. */
export function submitTurn(doc, { turnIndex, answer, pauses, gaze }, evaluation, next, now) {
  const v = doc.voice;
  if (doc.status !== VOICE_IN_PROGRESS) throw new StateError("not_in_progress");
  if (turnIndex !== v.currentIndex) throw new StateError("stale_turn");
  const turn = v.turns[turnIndex];
  turn.answer = answer;
  turn.answeredAt = now;
  turn.elapsedMs = ms(now) - ms(turn.askedAt);
  turn.pauses = pauses;
  const g = gaze ?? sanitizeGaze(undefined, 0);
  turn.gaze = {
    status: g.status,
    reason: g.reason,
    samples: g.samples,
    faceSamples: g.faceSamples,
    events: g.events.map((e) => ({ ...e, at: new Date(ms(turn.askedAt) + e.atMs) })),
  };
  turn.evaluation = {
    technical: evaluation.technical,
    communication: evaluation.communication,
    confidence: evaluation.confidence,
    overall: evaluation.overall,
    feedback: evaluation.feedback,
  };
  v.lastActivityAt = now;
  v.currentIndex += 1;
  if (v.currentIndex >= v.total) finishVoice(doc, now);
  else v.turns.push({ index: v.currentIndex, question: next.question, type: next.type, askedAt: now, answer: null });
}

/** A voice interview nobody has touched for a while is closed, so it stops blocking a new one. */
export function expireIdle(doc, now, idleMs) {
  if (doc.status !== VOICE_IN_PROGRESS || ms(now) - ms(doc.voice.lastActivityAt) <= idleMs) return false;
  const answered = doc.voice.turns.filter((t) => t.answer !== null && t.answer !== undefined).length;
  doc.status = ABANDONED;
  doc.voice.completedAt = now;
  doc.voice.summary = { answered, longInitialCount: 0, longMidCount: 0, avgInitialMs: null };
  return true;
}

function voiceResult(doc) {
  const v = doc.voice;
  const out = {
    status: doc.status,
    answered: v.turns.filter((t) => t.answer !== null && t.answer !== undefined).length,
    total: v.total,
    scores: doc.status === COMPLETED ? { ...plain(v.scores) } : null,
    summary: doc.status === COMPLETED ? { ...plain(v.summary) } : null,
    gaze: doc.status === COMPLETED ? { ...plain(v.gaze) } : null,
  };
  if (doc.mode === "practice") {
    out.turns = v.turns
      .filter((t) => t.answer !== null && t.answer !== undefined)
      .map((t) => ({
        index: t.index,
        question: t.question,
        type: t.type,
        answer: t.answer,
        evaluation: { ...plain(t.evaluation) },
        pauses: { ...plain(t.pauses), midMs: Array.from(t.pauses.midMs) },
        gaze: {
          status: t.gaze?.status ?? "unavailable",
          events: Array.from(t.gaze?.events ?? [], (e) => ({ type: e.type, atMs: e.atMs, durationMs: e.durationMs })),
        },
      }));
  }
  return out;
}

// Mongoose sub-documents carry extra internals, so copy only plain values.
function plain(o) {
  const out = {};
  for (const [k, val] of Object.entries(typeof o?.toObject === "function" ? o.toObject() : o ?? {})) if (k !== "_id") out[k] = val;
  return out;
}

/** What the browser may see: the current question, never earlier internals. */
export function publicVoiceState(doc) {
  const v = doc.voice;
  const m = doc.mcq;
  const base = {
    id: String(doc._id),
    role: doc.role,
    level: doc.level,
    mode: doc.mode,
    status: doc.status,
    phase: "interview",
    total: v.total,
    mcq: { correctCount: m.correctCount, total: m.questions.length, percent: m.percent },
  };
  if (doc.status === VOICE_IN_PROGRESS) {
    const t = v.turns[v.currentIndex];
    return { ...base, turn: { index: t.index, question: t.question, type: t.type }, answered: v.currentIndex };
  }
  return { ...base, result: voiceResult(doc) };
}
