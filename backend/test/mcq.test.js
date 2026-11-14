import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInterview, expireOverdue, submitAnswer, publicState, result, StateError, GRACE_MS } from "../src/services/mcq.js";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = (s) => new Date(T0 + s * 1000);
const qs = (n) => Array.from({ length: n }, (_, i) => ({ question: `Q${i}?????`, options: ["a", "b", "c", "d"], correct_index: 0, explanation: "e" }));
const make = (n, mode = "practice") => ({
  _id: "1",
  ...buildInterview({ candidateId: "u", role: "Dev", level: "mid", questions: qs(n), limitSeconds: 30, now: at(0), mode }),
});
// answers `correct` questions right (index 0) and the rest wrong (index 1), one per second
function play(n, correct) {
  const d = make(n);
  for (let i = 0; i < n; i++) submitAnswer(d, { questionIndex: i, selectedIndex: i < correct ? 0 : 1 }, at(i + 1));
  return d;
}

test("60% is the exact pass mark", () => {
  assert.equal(play(10, 6).status, "mcq_passed");
  assert.equal(play(10, 5).status, "rejected");
  assert.equal(play(5, 3).status, "mcq_passed"); // 3 of 5 = 60%
  assert.equal(play(9, 5).status, "rejected"); // 55.6%
  assert.equal(play(15, 9).status, "mcq_passed");
  assert.equal(play(15, 8).status, "rejected");
});

test("failing gives a Reject verdict and passing does not", () => {
  const f = play(10, 2);
  assert.equal(f.verdict, "Reject");
  assert.equal(f.verdictReason, "mcq_below_60");
  const p = play(10, 8);
  assert.equal(p.verdict, null);
  assert.equal(result(p).nextPhase, "interview");
  assert.equal(result(f).nextPhase, null);
});

test("percent is rounded to one decimal", () => {
  assert.equal(play(9, 5).mcq.percent, 55.6);
});

test("the answer key is never in the public state while the round runs", () => {
  const d = make(5);
  const text = JSON.stringify(publicState(d, at(1)));
  assert.ok(!/correct/i.test(text) && !/explanation/i.test(text));
  assert.equal(publicState(d, at(1)).current.remainingMs, 29000);
});

test("review shows the key after the round, but only for practice mode", () => {
  assert.ok(result(play(5, 3)).review[0].correctIndex === 0);
  const d = make(3, "session");
  for (let i = 0; i < 3; i++) submitAnswer(d, { questionIndex: i, selectedIndex: 0 }, at(i + 1));
  assert.equal(result(d).review, undefined);
});

test("unanswered questions time out one by one, even if nobody is watching", () => {
  const d = make(5);
  assert.equal(expireOverdue(d, at(30 + GRACE_MS / 1000 - 1)), false); // still inside the grace window
  expireOverdue(d, at(100)); // 100s: questions 0,1,2 are overdue (30s each + 2s grace)
  assert.equal(d.mcq.currentIndex, 3);
  assert.ok(d.mcq.answers.every((a) => a.timedOut && !a.correct));
  assert.equal(d.mcq.questionStartedAt.getTime(), T0 + 90_000); // each next question starts exactly 30s later
  assert.equal(publicState(d, at(100)).current.remainingMs, 20000);
});

test("leaving everything unanswered ends the round with a Reject", () => {
  const d = make(5);
  expireOverdue(d, at(10_000));
  assert.equal(d.status, "rejected");
  assert.equal(d.mcq.correctCount, 0);
});

test("an answer a moment after the limit still counts, a later one does not", () => {
  const d = make(5);
  submitAnswer(d, { questionIndex: 0, selectedIndex: 0 }, at(31)); // inside the 2s grace
  assert.equal(d.mcq.answers[0].correct, true);
  const e = make(5);
  assert.throws(() => submitAnswer(e, { questionIndex: 0, selectedIndex: 0 }, at(33)), StateError); // too late: already timed out
  assert.equal(e.mcq.answers[0].timedOut, true);
  assert.equal(e.mcq.currentIndex, 1);
});

test("old, repeated and finished submissions are refused", () => {
  const d = make(3);
  submitAnswer(d, { questionIndex: 0, selectedIndex: 0 }, at(1));
  assert.throws(() => submitAnswer(d, { questionIndex: 0, selectedIndex: 0 }, at(2)), { code: "stale_question" });
  assert.throws(() => submitAnswer(d, { questionIndex: 2, selectedIndex: 0 }, at(2)), { code: "stale_question" });
  submitAnswer(d, { questionIndex: 1, selectedIndex: 0 }, at(3));
  submitAnswer(d, { questionIndex: 2, selectedIndex: 0 }, at(4));
  assert.throws(() => submitAnswer(d, { questionIndex: 2, selectedIndex: 0 }, at(5)), { code: "not_in_progress" });
});

test("a clock that runs backwards cannot give more than the limit", () => {
  const d = make(3);
  assert.equal(publicState(d, at(-100)).current.remainingMs, 30000);
});
