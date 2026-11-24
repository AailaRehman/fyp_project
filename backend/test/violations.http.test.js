import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "x".repeat(40);
process.env.MONGO_URI = "mongodb://localhost/test";
process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
process.env.CLIENT_URL = "http://localhost:5173";

const { createApp } = await import("../src/app.js");
const { makeFakeUser, makeFakeInterview, makeFakeAi } = await import("../testing/fakes.js");
const { VIOLATION_TYPES } = await import("../src/constants.js");

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
const start = (t) => call("POST", "/api/interview/start", t, { role: "Backend Developer", level: "mid", count: 5 });
const mcq = (t, id, i, sel) => call("POST", `/api/interview/${id}/mcq/answer`, t, { questionIndex: i, selectedIndex: sel });
const report = (t, id, type, extra = {}) => call("POST", `/api/interview/${id}/violations`, t, { type, ...extra });
const get = (t, id) => call("GET", `/api/interview/${id}`, t);
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const row = (id) => fake.interviews.rows.find((r) => String(r._id) === id);
const finish = async (t, id) => { advance(1000); await get(t, id); }; // lets everything left time out

before(async () => {
  server = createApp({
    userModel: makeFakeUser(), interviewModel: fake.interviews, aiClient: fake.ai,
    now: () => new Date(nowMs), startLimit: 1000, voiceQuestions: 3, idleMinutes: 30, violationLimit: 3,
  }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  cand = await register("cand", "candidate");
  other = await register("other", "candidate");
  rec = await register("rec", "recruiter");
});
after(() => server.close());

test("only the owner, and only a candidate, can report", async () => {
  const s = await start(cand);
  assert.equal((await report(null, s.body.id, "tab_switch")).status, 401);
  assert.equal((await report(rec, s.body.id, "tab_switch")).status, 403);
  assert.equal((await report(other, s.body.id, "tab_switch")).status, 404);
  assert.equal((await call("POST", "/api/interview/not-an-id/violations", cand, { type: "copy" })).status, 404);
  await finish(cand, s.body.id);
});

test("every violation type is accepted, anything else is refused", async () => {
  for (const type of VIOLATION_TYPES) {
    const s = await start(cand);
    const r = await report(cand, s.body.id, type);
    assert.equal(r.status, 200, type);
    assert.equal(r.body.recorded, true);
    await finish(cand, s.body.id);
  }
  const s = await start(cand);
  for (const bad of [{ type: "dancing" }, {}, { type: "copy", agoMs: -1 }, { type: "copy", agoMs: 130000 }, { type: "copy", agoMs: "5" }, { type: 5 }]) {
    assert.equal((await call("POST", `/api/interview/${s.body.id}/violations`, cand, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(row(s.body.id).violations.length, 0);
  await finish(cand, s.body.id);
});

test("three strikes end the MCQ round: warnings first, then a Reject", async () => {
  const id = (await start(cand)).body.id;
  await mcq(cand, id, 0, 0);
  advance(2);
  const r1 = await report(cand, id, "tab_switch");
  assert.deepEqual(r1.body, { recorded: true, counted: true, count: 1, limit: 3, autoSubmitted: false });
  advance(2);
  assert.equal((await report(cand, id, "copy")).body.count, 2);
  advance(2);
  const note = await report(cand, id, "context_menu");
  assert.deepEqual([note.body.recorded, note.body.counted, note.body.count, note.body.autoSubmitted], [true, false, 2, false]);
  advance(2);
  const last = await report(cand, id, "window_blur");
  assert.equal(last.body.autoSubmitted, true);
  const s = last.body.state;
  assert.equal(s.status, "rejected");
  assert.equal(s.autoSubmitted, true);
  assert.equal(s.result.verdict, "Reject");
  assert.equal(s.result.verdictReason, "auto_submitted");
  assert.equal(s.result.passed, false);
  assert.deepEqual(s.violations.items.map((v) => [v.type, v.questionNumber, v.counted]),
    [["tab_switch", 2, true], ["copy", 2, true], ["context_menu", 2, false], ["window_blur", 2, true]]);
  assert.equal(s.violations.count, 3);

  const again = await report(cand, id, "paste");
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "not_in_progress");
  assert.equal(again.body.state.status, "rejected");
  const g = await get(cand, id);
  assert.equal(g.body.violations.items.length, 4);
  const h = await call("GET", "/api/interview/history", cand);
  const item = h.body.interviews.find((i) => i.id === id);
  assert.deepEqual([item.violations, item.autoSubmitted, item.status], [3, true, "rejected"]);
});

test("a tab switch that also blurs the window counts once", async () => {
  const id = (await start(cand)).body.id;
  assert.equal((await report(cand, id, "window_blur")).body.recorded, true);
  advance(0.5);
  const dup = await report(cand, id, "tab_switch");
  assert.deepEqual([dup.status, dup.body.recorded, dup.body.count], [200, false, 1]);
  advance(1.5);
  assert.deepEqual([(await report(cand, id, "tab_switch")).body.recorded], [true]);
  assert.equal(row(id).violations.length, 2);
  await finish(cand, id);
});

test("a delayed report is dated when the event really happened", async () => {
  const id = (await start(cand)).body.id;
  advance(10);
  await report(cand, id, "tab_switch", { agoMs: 5000 });
  assert.equal(row(id).violations[0].at.getTime(), nowMs - 5000);
  await finish(cand, id);
});

test("an interview that has not started the voice phase, or is over, takes no reports", async () => {
  const id = (await start(cand)).body.id;
  for (let i = 0; i < 5; i++) await mcq(cand, id, i, i < 3 ? i % 4 : (i + 1) % 4); // passed
  const r = await report(cand, id, "tab_switch");
  assert.equal(r.status, 409);
  assert.equal(r.body.state.status, "mcq_passed");
  const old = (await start(other)).body.id;
  advance(1000); // the MCQ time runs out first
  assert.equal((await report(other, old, "tab_switch")).status, 409);
});

test("strikes carry over from the MCQ round into the voice interview", async () => {
  advance(100);
  const id = (await start(cand)).body.id;
  advance(2); await report(cand, id, "tab_switch");
  advance(2); await report(cand, id, "window_blur");
  for (let i = 0; i < 5; i++) await mcq(cand, id, i, i < 3 ? i % 4 : (i + 1) % 4);
  assert.equal((await get(cand, id)).body.status, "mcq_passed"); // two strikes do not stop a pass
  await call("POST", `/api/interview/${id}/voice/start`, cand);
  advance(20);
  await call("POST", `/api/interview/${id}/voice/answer`, cand, { turnIndex: 0, answer: words(6) });
  advance(2);
  const third = await report(cand, id, "paste");
  assert.equal(third.body.autoSubmitted, true);
  const s = third.body.state;
  assert.equal(s.status, "completed");
  assert.equal(s.autoSubmitted, true);
  assert.equal(s.result.turns.length, 1);
  assert.equal(s.result.scores.overall, 6);
  assert.deepEqual(s.violations.items.map((v) => [v.phase, v.questionNumber]), [["mcq", 1], ["mcq", 1], ["voice", 2]]);
});

test("a normal interview with no violations is untouched", async () => {
  advance(100);
  const id = (await start(cand)).body.id;
  for (let i = 0; i < 5; i++) await mcq(cand, id, i, i % 4);
  const s = (await get(cand, id)).body;
  assert.equal(s.autoSubmitted, false);
  assert.deepEqual(s.violations, { count: 0, limit: 3, items: [] });
  assert.equal(s.status, "mcq_passed");
});
