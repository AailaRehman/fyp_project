import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizePauses, startVoice, submitTurn, expireIdle, publicVoiceState, LONG_INITIAL_MS } from "../src/services/voice.js";

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
