import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizePauses, sanitizeGaze, startVoice, submitTurn, expireIdle, publicVoiceState, LONG_INITIAL_MS } from "../src/services/voice.js";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = (s) => new Date(T0 + s * 1000);
const ev = (n) => ({ technical: n, communication: n, confidence: 5, overall: n, feedback: `fb ${n}` });
const passedDoc = () => ({
  _id: "1", role: "Dev", level: "mid", mode: "practice", status: "mcq_passed",
  mcq: { correctCount: 4, questions: [1, 2, 3, 4, 5], percent: 80 },
});
const P = (initialPauseMs, midPausesMs = []) => ({ initialPauseMs, midPausesMs });

test("pause data that fits the elapsed time is kept as it is", () => {
  const r = sanitizePauses(P(6500, [3200, 4100]), 30000);
  assert.deepEqual(r, { initialMs: 6500, midMs: [3200, 4100], longInitial: true, longMidCount: 2, inconsistent: false });
});

test("the initial pause is long only above 5 seconds", () => {
  assert.equal(sanitizePauses(P(LONG_INITIAL_MS), 20000).longInitial, false);
  assert.equal(sanitizePauses(P(LONG_INITIAL_MS + 1), 20000).longInitial, true);
});

test("mid-answer pauses under 3 seconds are not logged", () => {
  assert.deepEqual(sanitizePauses(P(0, [1000, 2999, 3000]), 20000).midMs, [3000]);
});

test("claimed pauses cannot be longer than the time that really passed", () => {
  const r = sanitizePauses(P(100000, [4000, 5000]), 10000);
  assert.equal(r.initialMs, 10000);
  assert.deepEqual(r.midMs, []);
  assert.equal(r.inconsistent, true);
});

test("a small clock difference is not flagged as inconsistent", () => {
  assert.equal(sanitizePauses(P(10500), 10000).inconsistent, false);
  assert.equal(sanitizePauses(P(11600), 10000).inconsistent, true);
});

test("missing or negative pause data is treated as zero", () => {
  assert.deepEqual(sanitizePauses(undefined, 5000), { initialMs: 0, midMs: [], longInitial: false, longMidCount: 0, inconsistent: false });
  assert.equal(sanitizePauses(P(-50), 5000).initialMs, 0);
});

test("a voice interview can only start after the MCQ round was passed", () => {
  const d = passedDoc();
  d.status = "rejected";
  assert.throws(() => startVoice(d, { question: "Q?????", type: "opening" }, { total: 3, now: at(0) }), { code: "mcq_not_passed" });
});

function run(total, answers) {
  const d = passedDoc();
  startVoice(d, { question: "Opening?", type: "opening" }, { total, now: at(0) });
  answers.forEach((a, i) => {
    const t = (i + 1) * 30;
    const sanitized = sanitizePauses(a.pauses, 30000);
    submitTurn(d, { turnIndex: i, answer: a.text, pauses: sanitized }, ev(a.score), { question: `Next ${i + 2}?`, type: "follow_up" }, at(t));
  });
  return d;
}

test("each answer moves to the next question, and the last one finishes", () => {
  const d = run(3, [{ text: "a", score: 4, pauses: P(6000, [3500]) }, { text: "b", score: 6, pauses: P(1000) }, { text: "c", score: 8, pauses: P(7000) }]);
  assert.equal(d.status, "completed");
  assert.deepEqual(d.voice.scores, { technical: 6, communication: 6, confidence: 5, overall: 6 });
  assert.equal(d.voice.summary.answered, 3);
  assert.equal(d.voice.summary.longInitialCount, 2);
  assert.equal(d.voice.summary.longMidCount, 1);
  assert.equal(d.voice.summary.avgInitialMs, 4667);
  assert.equal(d.voice.turns.length, 3); // no extra question after the last answer
});

test("scores are averaged to one decimal", () => {
  const d = run(3, [{ text: "a", score: 5, pauses: P(0) }, { text: "b", score: 6, pauses: P(0) }, { text: "c", score: 6, pauses: P(0) }]);
  assert.equal(d.voice.scores.overall, 5.7);
});

test("old, repeated and late answers are refused", () => {
  const d = passedDoc();
  startVoice(d, { question: "Opening?", type: "opening" }, { total: 3, now: at(0) });
  const args = (i) => [d, { turnIndex: i, answer: "x", pauses: sanitizePauses(P(0), 1000) }, ev(5), { question: "Next?????", type: "follow_up" }, at(5)];
  assert.throws(() => submitTurn(...args(1)), { code: "stale_turn" });
  submitTurn(...args(0));
  assert.throws(() => submitTurn(...args(0)), { code: "stale_turn" });
  d.status = "completed";
  assert.throws(() => submitTurn(...args(1)), { code: "not_in_progress" });
});

test("a skipped question is stored as an empty answer", () => {
  const d = run(3, [{ text: "", score: 0, pauses: P(0) }, { text: "b", score: 4, pauses: P(0) }, { text: "c", score: 4, pauses: P(0) }]);
  assert.equal(d.voice.turns[0].answer, "");
  assert.equal(d.voice.scores.technical, 2.7);
});

test("an interview nobody touches is closed after the idle time", () => {
  const d = passedDoc();
  startVoice(d, { question: "Opening?", type: "opening" }, { total: 3, now: at(0) });
  const idle = 30 * 60 * 1000;
  assert.equal(expireIdle(d, new Date(T0 + idle), idle), false);
  assert.equal(expireIdle(d, new Date(T0 + idle + 1), idle), true);
  assert.equal(d.status, "abandoned");
  assert.equal(expireIdle(d, new Date(T0 + idle * 5), idle), false);
});

test("the public state shows only the current question while the interview runs", () => {
  const d = run(3, [{ text: "secret answer words here now", score: 5, pauses: P(0) }]);
  const s = publicVoiceState(d);
  assert.equal(s.turn.index, 1);
  assert.equal(s.answered, 1);
  assert.ok(!JSON.stringify(s).includes("secret answer"));
  assert.equal(s.result, undefined);
});

test("practice results include per-question detail, other modes do not", () => {
  const d = run(3, [{ text: "one", score: 5, pauses: P(6000, [3500]) }, { text: "two", score: 5, pauses: P(0) }, { text: "three", score: 5, pauses: P(0) }]);
  const r = publicVoiceState(d).result;
  assert.equal(r.turns.length, 3);
  assert.deepEqual(r.turns[0].pauses, { initialMs: 6000, midMs: [3500], longInitial: true, longMidCount: 1, inconsistent: false });
  d.mode = "session";
  assert.equal(publicVoiceState(d).result.turns, undefined);
  assert.ok(publicVoiceState(d).result.scores.overall);
});

test("a skipped question is left out of the average wait, and an all-skipped interview has none", () => {
  const some = run(3, [{ text: "a", score: 5, pauses: P(6000) }, { text: "", score: 0, pauses: P(0) }, { text: "c", score: 5, pauses: P(2000) }]);
  assert.equal(some.voice.summary.avgInitialMs, 4000); // (6000 + 2000) / 2, not / 3
  const none = run(3, [{ text: "", score: 0, pauses: P(0) }, { text: "", score: 0, pauses: P(0) }, { text: "", score: 0, pauses: P(0) }]);
  assert.equal(none.voice.summary.avgInitialMs, null);
  assert.equal(none.voice.scores.overall, 0);
});

// ---------- gaze ----------
const G = (events, samples = 8, faceSamples = samples) => ({ status: "on", samples, faceSamples, events });
const E = (type, atMs, durationMs) => ({ type, atMs, durationMs });

test("gaze that was not reported or not running is stored as unavailable", () => {
  assert.deepEqual(sanitizeGaze(undefined, 20000), { status: "unavailable", reason: "not_reported", samples: 0, faceSamples: 0, events: [] });
  const r = sanitizeGaze({ status: "unavailable", reason: "load_failed", samples: 50, faceSamples: 50, events: [E("looking_away", 0, 5000)] }, 20000);
  assert.deepEqual(r, { status: "unavailable", reason: "load_failed", samples: 0, faceSamples: 0, events: [] }); // nothing is trusted when it says it did not run
});

test("plausible gaze data is kept as it is", () => {
  const r = sanitizeGaze(G([E("looking_away", 6000, 4000), E("no_face", 14000, 2000)], 9), 20000);
  assert.deepEqual(r.events, [E("looking_away", 6000, 4000), E("no_face", 14000, 2000)]);
  assert.equal(r.samples, 9);
});

test("gaze data cannot claim more checks or events than the time allows", () => {
  const r = sanitizeGaze(G([E("looking_away", 50000, 99999)], 5000, 5000), 10000);
  assert.equal(r.samples, 12); // 10 s allows at most 12
  assert.equal(r.faceSamples, 12);
  assert.deepEqual(r.events, [E("looking_away", 10000, 2000)]); // starts no later than the end, lasts at most one check beyond it
});

test("an event needs two checks in a row, and unknown event types are dropped", () => {
  const many = Array.from({ length: 10 }, (_, i) => E("looking_away", i * 1000, 2000));
  assert.equal(sanitizeGaze(G(many, 6), 30000).events.length, 3);
  assert.equal(sanitizeGaze(G([E("looking_away", 0, 2000)], 1), 30000).events.length, 0);
  assert.equal(sanitizeGaze(G([{ type: "dancing", atMs: 0, durationMs: 1 }], 8), 30000).events.length, 0);
  assert.equal(sanitizeGaze(G([E("no_face", -5, -5)], 8), 30000).events[0].atMs, 0);
});

function runGaze(reports) {
  const d = passedDoc();
  startVoice(d, { question: "Opening?", type: "opening" }, { total: reports.length, now: at(0) });
  reports.forEach((g, i) => submitTurn(d, { turnIndex: i, answer: "words", pauses: sanitizePauses(P(0), 20000), gaze: sanitizeGaze(g, 20000) }, ev(5), { question: `Next ${i + 2}?`, type: "follow_up" }, at((i + 1) * 20)));
  return d;
}

test("the gaze summary counts events by type and adds up their time", () => {
  const d = runGaze([G([E("looking_away", 4000, 6000), E("looking_away", 12000, 4000)]), G([E("no_face", 2000, 4000)]), G([E("multiple_faces", 0, 2000)])]);
  assert.deepEqual(d.voice.gaze, { status: "on", events: 4, lookingAway: 2, noFace: 1, multipleFaces: 1, totalMs: 16000, samples: 24, expectedSamples: 30 });
});

test("gaze status is on, partial or unavailable, so no news is never mistaken for good news", () => {
  const off = { status: "unavailable", reason: "load_failed", samples: 0, faceSamples: 0, events: [] };
  assert.equal(runGaze([G([]), G([]), G([])]).voice.gaze.status, "on");
  assert.equal(runGaze([G([]), off, G([])]).voice.gaze.status, "partial");
  assert.equal(runGaze([off, off, off]).voice.gaze.status, "unavailable");
  assert.equal(runGaze([undefined, undefined, undefined]).voice.gaze.status, "unavailable");
});

test("practice results list the gaze events for each answer", () => {
  const d = runGaze([G([E("looking_away", 4000, 6000)]), G([]), G([])]);
  const r = publicVoiceState(d).result;
  assert.deepEqual(r.turns[0].gaze, { status: "on", events: [E("looking_away", 4000, 6000)] });
  assert.equal(r.gaze.events, 1);
  d.mode = "session";
  assert.equal(publicVoiceState(d).result.turns, undefined);
  assert.equal(publicVoiceState(d).result.gaze.events, 1); // the summary stays available for recruiter sessions
});
