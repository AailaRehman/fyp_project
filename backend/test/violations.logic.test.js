import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInterview, submitAnswer } from "../src/services/mcq.js";
import { startVoice, submitTurn, sanitizePauses, sanitizeGaze, publicVoiceState } from "../src/services/voice.js";
import { COALESCE_MS, MAX_AGO_MS, MAX_STORED, countedViolations, recordViolation } from "../src/services/violations.js";
import { publicState } from "../src/services/state.js";
import { COUNTED_VIOLATION_TYPES, VIOLATION_TYPES } from "../src/constants.js";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = (s) => new Date(T0 + s * 1000);
const qs = (n) => Array.from({ length: n }, (_, i) => ({ question: `Q${i}?????`, options: ["a", "b", "c", "d"], correct_index: 0, explanation: "e" }));
const mcqDoc = (n = 5) => ({ _id: "1", ...buildInterview({ candidateId: "u", role: "Dev", level: "mid", questions: qs(n), limitSeconds: 30, now: at(0) }) });
const voiceDoc = () => {
  const d = mcqDoc();
  d.status = "mcq_passed";
  startVoice(d, { question: "Opening?", type: "opening" }, { total: 3, now: at(0) });
  return d;
};
const answerVoice = (d, i = 0, score = 5) =>
  submitTurn(d, { turnIndex: i, answer: "words", pauses: sanitizePauses({ initialPauseMs: 6000 }, 20000), gaze: sanitizeGaze(undefined, 0) },
    { technical: score, communication: score, confidence: score, overall: score, feedback: "fb" }, { question: "Next?????", type: "follow_up" }, at(20 + i * 20));

test("the lists of violation types agree", () => {
  assert.ok(COUNTED_VIOLATION_TYPES.every((t) => VIOLATION_TYPES.includes(t)));
  assert.ok(!COUNTED_VIOLATION_TYPES.includes("context_menu")); // right-click is a note, not a strike
});

test("a violation is logged with its type, time, phase and question number", () => {
  const d = mcqDoc();
  submitAnswer(d, { questionIndex: 0, selectedIndex: 0 }, at(5));
  assert.deepEqual(recordViolation(d, { type: "tab_switch" }, at(10), 3), { recorded: true, counted: true, autoSubmitted: false });
  assert.deepEqual(d.violations[0], { type: "tab_switch", at: at(10), phase: "mcq", questionNumber: 2, counted: true });
});

test("during the voice interview the phase and question number follow it", () => {
  const d = voiceDoc();
  recordViolation(d, { type: "window_blur" }, at(10), 3);
  answerVoice(d, 0);
  recordViolation(d, { type: "copy" }, at(40), 3);
  assert.deepEqual(d.violations.map((v) => [v.phase, v.questionNumber]), [["voice", 1], ["voice", 2]]);
});

test("right-click is logged but never counts towards the limit", () => {
  const d = mcqDoc();
  for (let i = 0; i < 6; i++) recordViolation(d, { type: "context_menu" }, at(10 + i * 2), 3);
  assert.equal(d.violations.length, 6);
  assert.equal(countedViolations(d), 0);
  assert.equal(d.status, "mcq_in_progress");
});

test("two reports close together are one incident", () => {
  const d = mcqDoc();
  assert.equal(recordViolation(d, { type: "window_blur" }, at(10), 3).recorded, true);
  assert.equal(recordViolation(d, { type: "tab_switch" }, new Date(at(10).getTime() + COALESCE_MS - 1), 3).recorded, false);
  assert.equal(recordViolation(d, { type: "tab_switch" }, new Date(at(10).getTime() + COALESCE_MS), 3).recorded, true);
  assert.equal(d.violations.length, 2);
});

test("the third counted violation ends the MCQ round with a Reject, however well it was going", () => {
  const d = mcqDoc();
  [0, 1, 2].forEach((i) => submitAnswer(d, { questionIndex: i, selectedIndex: 0 }, at(i + 1))); // 3 right: would pass at 60%
  assert.equal(recordViolation(d, { type: "tab_switch" }, at(10), 3).autoSubmitted, false);
  assert.equal(recordViolation(d, { type: "copy" }, at(12), 3).autoSubmitted, false);
  const last = recordViolation(d, { type: "window_blur" }, at(14), 3);
  assert.deepEqual(last, { recorded: true, counted: true, autoSubmitted: true });
  assert.equal(d.status, "rejected");
  assert.equal(d.verdict, "Reject");
  assert.equal(d.verdictReason, "auto_submitted");
  assert.equal(d.autoSubmitted, true);
  assert.equal(d.mcq.passed, false);
  assert.equal(d.mcq.answers.length, 5);
  assert.deepEqual(d.mcq.answers.slice(3).map((a) => a.timedOut), [true, true]); // the rest count as unanswered
  assert.equal(d.mcq.correctCount, 3);
});

test("the limit can be changed", () => {
  const d = mcqDoc();
  recordViolation(d, { type: "paste" }, at(10), 2);
  assert.equal(recordViolation(d, { type: "cut" }, at(12), 2).autoSubmitted, true);
});

test("in the voice interview what was answered so far is scored and the rest is not", () => {
  const d = voiceDoc();
  answerVoice(d, 0, 6);
  ["tab_switch", "copy", "window_blur"].forEach((type, i) => recordViolation(d, { type }, at(30 + i * 2), 3));
  assert.equal(d.status, "completed");
  assert.equal(d.verdict, "Reject");
  assert.equal(d.autoSubmitted, true);
  assert.equal(d.voice.scores.overall, 6);
  assert.equal(d.voice.summary.answered, 1);
  assert.equal(publicVoiceState(d).result.turns.length, 1);
});

test("an interview stopped before any answer has zero scores, not nonsense", () => {
  const d = voiceDoc();
  ["tab_switch", "copy", "window_blur"].forEach((type, i) => recordViolation(d, { type }, at(10 + i * 2), 3));
  assert.deepEqual(d.voice.scores, { technical: 0, communication: 0, confidence: 0, overall: 0 });
  assert.equal(d.voice.gaze.status, "unavailable");
  assert.equal(d.voice.summary.answered, 0);
  assert.equal(d.voice.summary.avgInitialMs, null);
});

test("nothing can be recorded once the interview is over or before it starts", () => {
  for (const status of ["rejected", "completed", "abandoned", "mcq_passed"]) {
    const d = mcqDoc();
    d.status = status;
    assert.throws(() => recordViolation(d, { type: "tab_switch" }, at(10), 3), { code: "not_in_progress" }, status);
  }
});

test("a delayed report is dated when it happened, within limits", () => {
  const d = mcqDoc();
  recordViolation(d, { type: "tab_switch", agoMs: 30000 }, at(100), 3);
  assert.equal(d.violations[0].at.getTime(), at(70).getTime());
  recordViolation(d, { type: "copy", agoMs: -5000 }, at(200), 3);
  assert.equal(d.violations[1].at.getTime(), at(200).getTime());
  recordViolation(d, { type: "paste", agoMs: 9e9 }, at(900), 3);
  assert.equal(d.violations[2].at.getTime(), at(900).getTime() - MAX_AGO_MS);
});

test("only a limited number of violations are stored", () => {
  const d = mcqDoc();
  d.violations = Array.from({ length: MAX_STORED }, (_, i) => ({ type: "context_menu", at: at(i * 2), phase: "mcq", questionNumber: 1, counted: false }));
  assert.equal(recordViolation(d, { type: "tab_switch" }, at(1000), 3).recorded, false);
});

test("the state shows the candidate their log, without internal details", () => {
  const d = mcqDoc();
  recordViolation(d, { type: "tab_switch" }, at(10), 3);
  recordViolation(d, { type: "context_menu" }, at(13), 3);
  const s = publicState(d, at(14), { violationLimit: 3 });
  assert.deepEqual(s.violations, {
    count: 1,
    limit: 3,
    items: [{ type: "tab_switch", phase: "mcq", questionNumber: 1, counted: true }, { type: "context_menu", phase: "mcq", questionNumber: 1, counted: false }],
  });
  assert.equal(s.autoSubmitted, false);
  const v = publicState(voiceDoc(), at(5));
  assert.deepEqual(v.violations, { count: 0, limit: 3, items: [] });
});
