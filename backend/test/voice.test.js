import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "x".repeat(40);
process.env.MONGO_URI = "mongodb://localhost/test";
process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
process.env.CLIENT_URL = "http://localhost:5173";

const { createApp } = await import("../src/app.js");
const { makeFakeUser, makeFakeInterview, makeFakeAi } = await import("../testing/fakes.js");

let nowMs = Date.parse("2026-01-01T00:00:00Z");
const advance = (s) => (nowMs += s * 1000);
const fake = { interviews: makeFakeInterview(), ai: makeFakeAi() };
let server, base, cand, other, rec;

const call = async (method, path, token, body) => {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const register = async (name, role) =>
  (await call("POST", "/api/auth/register", null, { name, email: `${name}@example.com`, password: "Passw0rdOK", role })).body.token;
const start = (t, extra = {}) => call("POST", "/api/interview/start", t, { role: "Backend Developer", level: "mid", count: 5, ...extra });
const mcq = (t, id, i, sel) => call("POST", `/api/interview/${id}/mcq/answer`, t, { questionIndex: i, selectedIndex: sel });
const vStart = (t, id) => call("POST", `/api/interview/${id}/voice/start`, t);
const vAnswer = (t, id, turnIndex, answer, pauses, gaze) =>
  call("POST", `/api/interview/${id}/voice/answer`, t, { turnIndex, answer, ...(pauses && { pauses }), ...(gaze && { gaze }) });
const get = (t, id) => call("GET", `/api/interview/${id}`, t);
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

// plays the MCQ round: the fake AI marks option i % 4 as correct for question i
async function mcqRound(t, right) {
  const s = await start(t);
  for (let i = 0; i < 5; i++) await mcq(t, s.body.id, i, i < right ? i % 4 : (i + 1) % 4);
  return s.body.id;
}
const passed = (t) => mcqRound(t, 3);

before(async () => {
  server = createApp({
    userModel: makeFakeUser(), interviewModel: fake.interviews, aiClient: fake.ai,
    now: () => new Date(nowMs), startLimit: 1000, voiceQuestions: 3, idleMinutes: 30,
  }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  cand = await register("cand", "candidate");
  other = await register("other", "candidate");
  rec = await register("rec", "recruiter");
});
after(() => server.close());

test("the voice interview cannot start before the MCQ round is passed", async () => {
  const s = await start(cand);
  const early = await vStart(cand, s.body.id);
  assert.equal(early.status, 409);
  assert.equal(early.body.error, "mcq_not_passed");
  for (let i = 0; i < 5; i++) await mcq(cand, s.body.id, i, (i + 1) % 4); // fail the round
  const failed = await vStart(cand, s.body.id);
  assert.equal(failed.body.error, "mcq_not_passed");
  assert.equal(fake.ai.questionCalls.length, 0);
});

test("only the owner, and only a candidate, can use the voice endpoints", async () => {
  const id = await passed(cand);
  assert.equal((await vStart(other, id)).status, 404);
  assert.equal((await vStart(rec, id)).status, 403);
  assert.equal((await vAnswer(other, id, 0, "x")).status, 404);
  assert.equal((await vStart(null, id)).status, 401);
});

test("starting asks the AI for question 1 and returns only that question", async () => {
  const id = await passed(cand);
  const r = await vStart(cand, id);
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "interview_in_progress");
  assert.deepEqual(r.body.turn, { index: 0, question: "Opening question for Backend Developer?", type: "opening" });
  assert.equal(r.body.total, 3);
  const call1 = fake.ai.questionCalls.at(-1);
  assert.deepEqual(call1, { role: "Backend Developer", level: "mid", question_number: 1 });
  assert.equal(r.body.result, undefined);
});

test("starting twice carries on without another AI call", async () => {
  const before = fake.ai.questionCalls.length;
  const open = fake.interviews.rows.find((r) => r.status === "interview_in_progress");
  const again = await vStart(cand, String(open._id));
  assert.equal(again.status, 200);
  assert.equal(again.body.turn.index, 0);
  assert.equal(fake.ai.questionCalls.length, before);
});

test("a full interview: follow-ups come from the answers, scores are averaged", async () => {
  const open = fake.interviews.rows.find((r) => r.status === "interview_in_progress");
  const id = String(open._id);
  advance(30);
  const a1 = words(4);
  const r1 = await vAnswer(cand, id, 0, a1, { initialPauseMs: 6500, midPausesMs: [3200] });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.turn.index, 1);
  assert.equal(r1.body.turn.type, "clarify"); // only 4 words: too little to build on
  const ev = fake.ai.evalCalls.at(-1);
  assert.deepEqual(ev.pauses, { initial_pause_s: 6.5, mid_pauses_s: [3.2] });
  assert.equal(ev.question, "Opening question for Backend Developer?");
  assert.equal(ev.answer, a1);

  advance(30);
  const a2 = "I fixed a memory leak using heap snapshots in production";
  const r2 = await vAnswer(cand, id, 1, a2, { initialPauseMs: 1000, midPausesMs: [] });
  assert.equal(r2.body.turn.type, "follow_up");
  assert.ok(r2.body.turn.question.includes("I fixed a memory leak"));
  const q2 = fake.ai.questionCalls.at(-1);
  assert.equal(q2.previous_answer, a2);
  assert.equal(q2.previous_question, "Could you give one specific example?");
  assert.equal(q2.question_number, 3);
  assert.ok(!JSON.stringify(r2.body).includes("Feedback")); // scores are not shown while the interview runs

  advance(30);
  const n3 = fake.ai.questionCalls.length;
  const r3 = await vAnswer(cand, id, 2, words(10), { initialPauseMs: 8000 });
  assert.equal(r3.status, 200);
  assert.equal(r3.body.status, "completed");
  assert.equal(fake.ai.questionCalls.length, n3); // no question is written after the last answer
  assert.deepEqual(r3.body.result.scores, { technical: 8, communication: 8, confidence: 5, overall: 8 }); // (4 + 10 + 10) / 3
  assert.equal(r3.body.result.summary.longInitialCount, 2);
  assert.equal(r3.body.result.summary.longMidCount, 1);
  assert.equal(r3.body.result.turns.length, 3);
  assert.equal(r3.body.result.turns[1].answer, a2);
  assert.equal(r3.body.result.turns[0].evaluation.feedback, "Feedback for 4 words.");

  const g = await get(cand, id);
  assert.equal(g.body.status, "completed");
  assert.deepEqual(g.body.result.scores, r3.body.result.scores);
  assert.equal((await vStart(cand, id)).body.error, "already_completed");
});

test("pause data is capped by the time that really passed", async () => {
  const id = await passed(cand);
  await vStart(cand, id);
  advance(10);
  const r = await vAnswer(cand, id, 0, words(6), { initialPauseMs: 100000, midPausesMs: [4000, 5000] });
  assert.equal(r.status, 200);
  const g = await vAnswer(cand, id, 1, words(6)); // pauses left out entirely is fine
  assert.equal(g.status, 200);
  const done = await vAnswer(cand, id, 2, words(6));
  const first = done.body.result.turns[0].pauses;
  assert.equal(first.initialMs, 10000);
  assert.deepEqual(first.midMs, []);
  assert.equal(first.inconsistent, true);
  assert.equal(done.body.result.turns[1].pauses.initialMs, 0);
});

test("bad input is refused and nothing is stored", async () => {
  const id = await passed(cand);
  await vStart(cand, id);
  const bad = [
    [0, "x".repeat(4001)], [0, 123], [0, null], ["0", "x"], [-1, "x"],
  ];
  for (const [i, a] of bad) assert.equal((await vAnswer(cand, id, i, a)).status, 400, JSON.stringify([i, a]));
  assert.equal((await vAnswer(cand, id, 0, "x", { initialPauseMs: -5 })).status, 400);
  assert.equal((await vAnswer(cand, id, 0, "x", { initialPauseMs: 700000 })).status, 400);
  assert.equal((await vAnswer(cand, id, 0, "x", { midPausesMs: Array(51).fill(3000) })).status, 400);
  assert.equal((await vAnswer(cand, id, 0, "x", { midPausesMs: ["a"] })).status, 400);
  assert.equal((await get(cand, id)).body.turn.index, 0);
  await vAnswer(cand, id, 0, words(5)); await vAnswer(cand, id, 1, words(5)); await vAnswer(cand, id, 2, words(5));
});

test("old and repeated answers get the current state back", async () => {
  const id = await passed(cand);
  await vStart(cand, id);
  const ahead = await vAnswer(cand, id, 1, words(6));
  assert.equal(ahead.status, 409);
  assert.equal(ahead.body.error, "stale_turn");
  assert.equal(ahead.body.state.turn.index, 0);
  assert.equal((await vAnswer(cand, id, 0, words(6))).status, 200);
  const repeat = await vAnswer(cand, id, 0, words(6));
  assert.equal(repeat.status, 409);
  assert.equal(repeat.body.state.turn.index, 1);
  await vAnswer(cand, id, 1, words(6)); await vAnswer(cand, id, 2, words(6));
});

test("a skipped question scores zero and the interview carries on", async () => {
  const id = await passed(cand);
  await vStart(cand, id);
  const r = await vAnswer(cand, id, 0, "   ");
  assert.equal(r.status, 200);
  assert.equal(r.body.turn.type, "clarify");
  await vAnswer(cand, id, 1, words(6));
  const done = await vAnswer(cand, id, 2, words(6));
  assert.equal(done.body.result.turns[0].answer, "");
  assert.equal(done.body.result.turns[0].evaluation.overall, 0);
  assert.equal(done.body.result.scores.technical, 4);
});

test("when the AI fails nothing is stored and the same answer can be sent again", async () => {
  const id = await passed(cand);
  await vStart(cand, id);
  fake.ai.mode = "down";
  assert.deepEqual((await vAnswer(cand, id, 0, words(6))).body, { error: "ai_unavailable" });
  fake.ai.mode = "bad";
  assert.deepEqual((await vAnswer(cand, id, 0, words(6))).body, { error: "ai_bad_response" });
  fake.ai.mode = "ok";
  const still = await get(cand, id);
  assert.equal(still.body.turn.index, 0);
  assert.equal(still.body.answered, 0);
  assert.equal((await vAnswer(cand, id, 0, words(6))).status, 200);
  await vAnswer(cand, id, 1, words(6)); await vAnswer(cand, id, 2, words(6));
});

test("the AI failing while starting leaves the interview ready to start again", async () => {
  const id = await passed(cand);
  fake.ai.mode = "down";
  assert.equal((await vStart(cand, id)).status, 503);
  fake.ai.mode = "ok";
  assert.equal((await get(cand, id)).body.status, "mcq_passed");
  assert.equal((await vStart(cand, id)).status, 201);
  await vAnswer(cand, id, 0, words(6)); await vAnswer(cand, id, 1, words(6)); await vAnswer(cand, id, 2, words(6));
});

test("a running voice interview blocks a new interview, until it is finished", async () => {
  const id = await passed(cand);
  await vStart(cand, id);
  const blocked = await start(cand);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.interviewId, id);
  const sibling = await passed(other); // someone else is not affected
  assert.ok(sibling);
  await vAnswer(cand, id, 0, words(6)); await vAnswer(cand, id, 1, words(6)); await vAnswer(cand, id, 2, words(6));
  assert.equal((await start(cand)).status, 201);
  advance(100); // let that new MCQ round time out
  await get(cand, (await call("GET", "/api/interview/history", cand)).body.interviews[0].id);
});

test("only one voice interview can run at a time", async () => {
  advance(100);
  const a = await passed(cand);
  advance(100);
  const b = await passed(cand);
  assert.equal((await vStart(cand, a)).status, 201);
  const second = await vStart(cand, b);
  assert.equal(second.status, 409);
  assert.equal(second.body.interviewId, a);
  await vAnswer(cand, a, 0, words(6)); await vAnswer(cand, a, 1, words(6)); await vAnswer(cand, a, 2, words(6));
  assert.equal((await vStart(cand, b)).status, 201);
  await vAnswer(cand, b, 0, words(6)); await vAnswer(cand, b, 1, words(6)); await vAnswer(cand, b, 2, words(6));
});

test("an interview left alone is closed after the idle time and stops blocking", async () => {
  advance(100);
  const id = await passed(cand);
  await vStart(cand, id);
  advance(31 * 60);
  const g = await get(cand, id);
  assert.equal(g.body.status, "abandoned");
  assert.equal(g.body.result.scores, null);
  const late = await vAnswer(cand, id, 0, words(6));
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "interview_abandoned");
  assert.equal((await vStart(cand, id)).body.error, "interview_abandoned");
  assert.equal((await start(cand)).status, 201); // not blocked any more
  advance(100);
  await call("GET", "/api/interview/history", cand);
});

test("history shows voice progress and the final score", async () => {
  const h = await call("GET", "/api/interview/history", cand);
  const done = h.body.interviews.find((i) => i.status === "completed");
  assert.ok(done.voice.overall > 0);
  assert.equal(done.voice.answered, 3);
  const mcqOnly = h.body.interviews.find((i) => i.status === "rejected");
  assert.equal(mcqOnly.voice, null);
  assert.ok(!JSON.stringify(h.body).match(/answer"|feedback|correctIndex/i));
});

const gz = (events, samples = 9, faceSamples = samples) => ({ status: "on", samples, faceSamples, events });
const off = { status: "unavailable", reason: "load_failed", samples: 0, faceSamples: 0, events: [] };

test("gaze reports are stored per question and summarised at the end", async () => {
  advance(100);
  const id = await passed(cand);
  await vStart(cand, id);
  advance(20);
  await vAnswer(cand, id, 0, words(6), undefined, gz([{ type: "looking_away", atMs: 6000, durationMs: 4000 }]));
  advance(20);
  await vAnswer(cand, id, 1, words(6), undefined, gz([{ type: "no_face", atMs: 2000, durationMs: 6000 }], 8, 4));
  advance(20);
  const done = await vAnswer(cand, id, 2, words(6), undefined, off);
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.result.gaze, { status: "partial", events: 2, lookingAway: 1, noFace: 1, multipleFaces: 0, totalMs: 10000, samples: 17, expectedSamples: 30 });
  assert.deepEqual(done.body.result.turns[0].gaze, { status: "on", events: [{ type: "looking_away", atMs: 6000, durationMs: 4000 }] });
  assert.equal(done.body.result.turns[2].gaze.status, "unavailable");
  const stored = fake.interviews.rows.find((r) => String(r._id) === id).voice.turns[0].gaze.events[0];
  assert.equal(stored.at.getTime() - stored.atMs, new Date(fake.interviews.rows.find((r) => String(r._id) === id).voice.turns[0].askedAt).getTime()); // timestamp = when the question was asked + offset
  const h = await call("GET", "/api/interview/history", cand);
  assert.equal(h.body.interviews.find((i) => i.id === id).voice.gazeEvents, 2);
});

test("an answer without gaze data is stored as not reported", async () => {
  advance(100);
  const id = await passed(cand);
  await vStart(cand, id);
  await vAnswer(cand, id, 0, words(6)); await vAnswer(cand, id, 1, words(6));
  const done = await vAnswer(cand, id, 2, words(6));
  assert.equal(done.body.result.gaze.status, "unavailable");
  assert.equal(fake.interviews.rows.find((r) => String(r._id) === id).voice.turns[0].gaze.reason, "not_reported");
});

test("gaze data that does not fit the time that passed is cut down", async () => {
  advance(100);
  const id = await passed(cand);
  await vStart(cand, id);
  advance(10);
  await vAnswer(cand, id, 0, words(6), undefined, gz([{ type: "looking_away", atMs: 50000, durationMs: 99999 }], 5000, 5000));
  await vAnswer(cand, id, 1, words(6)); 
  const done = await vAnswer(cand, id, 2, words(6));
  const t0 = done.body.result.turns[0].gaze;
  assert.deepEqual(t0.events, [{ type: "looking_away", atMs: 10000, durationMs: 2000 }]);
  assert.equal(done.body.result.gaze.samples, 12);
});

test("badly formed gaze data is refused", async () => {
  advance(100);
  const id = await passed(cand);
  await vStart(cand, id);
  const ev1 = { type: "looking_away", atMs: 1000, durationMs: 2000 };
  const bad = [
    gz([{ ...ev1, type: "dancing" }]),
    gz([{ ...ev1, atMs: -1 }]),
    gz([{ ...ev1, durationMs: 4000000 }]),
    gz(Array(41).fill(ev1)),
    { ...gz([]), samples: 1.5 },
    { ...gz([]), samples: 6000 },
    { ...gz([]), status: "maybe" },
    { ...gz([]), reason: "Bad Reason!" },
    { status: "on", samples: 1, faceSamples: 1 }, // events missing
  ];
  for (const g of bad) assert.equal((await vAnswer(cand, id, 0, words(6), undefined, g)).status, 400, JSON.stringify(g).slice(0, 80));
  assert.equal((await get(cand, id)).body.turn.index, 0); // nothing was stored
  await vAnswer(cand, id, 0, words(6)); await vAnswer(cand, id, 1, words(6)); await vAnswer(cand, id, 2, words(6));
});
