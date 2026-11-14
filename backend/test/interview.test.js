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
const start = (token, extra = {}) => call("POST", "/api/interview/start", token, { role: "Backend Developer", level: "mid", count: 5, ...extra });
const answer = (token, id, questionIndex, selectedIndex) => call("POST", `/api/interview/${id}/mcq/answer`, token, { questionIndex, selectedIndex });

before(async () => {
  server = createApp({
    userModel: makeFakeUser(),
    interviewModel: fake.interviews,
    aiClient: fake.ai,
    now: () => new Date(nowMs),
    startLimit: 1000,
  }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  cand = await register("cand", "candidate");
  other = await register("other", "candidate");
  rec = await register("rec", "recruiter");
});
after(() => server.close());

// plays a whole round: the first `right` answers are correct (the fake AI marks option i%4 as correct for question i)
async function play(token, id, total, right) {
  let last;
  for (let i = 0; i < total; i++) last = await answer(token, id, i, i < right ? i % 4 : (i + 1) % 4);
  return last;
}

test("login is required, and only candidates may use it", async () => {
  assert.equal((await call("POST", "/api/interview/start", null, {})).status, 401);
  assert.equal((await start(rec)).status, 403);
  assert.equal((await call("GET", "/api/interview/history", rec)).status, 403);
});

test("start returns the first question and no answer key", async () => {
  const r = await start(cand);
  assert.equal(r.status, 201);
  assert.equal(r.body.total, 5);
  assert.equal(r.body.current.index, 0);
  assert.equal(r.body.current.options.length, 4);
  assert.equal(r.body.current.remainingMs, 30000);
  const text = JSON.stringify(r.body);
  assert.ok(!/correct/i.test(text) && !/explanation/i.test(text));
  await play(cand, r.body.id, 5, 0); // finish so later tests can start again
});

test("start validates its input", async () => {
  for (const bad of [{ level: "expert" }, { count: 2 }, { count: 16 }, { role: "  " }, { count: "5" }]) {
    assert.equal((await start(cand, bad)).status, 400, JSON.stringify(bad));
  }
});

test("3 of 5 right passes and unlocks the next phase", async () => {
  const s = await start(cand);
  const end = await play(cand, s.body.id, 5, 3);
  assert.equal(end.status, 200);
  assert.equal(end.body.status, "mcq_passed");
  assert.equal(end.body.result.passed, true);
  assert.equal(end.body.result.percent, 60);
  assert.equal(end.body.result.nextPhase, "interview");
  assert.equal(end.body.result.review.length, 5);
  assert.equal(end.body.result.review[1].correctIndex, 1);
});

test("2 of 5 right ends the interview with a Reject verdict", async () => {
  const s = await start(cand);
  const end = await play(cand, s.body.id, 5, 2);
  assert.equal(end.body.status, "rejected");
  assert.equal(end.body.result.verdict, "Reject");
  assert.equal(end.body.result.nextPhase, null);
});

test("the server enforces the time limit, even after a refresh", async () => {
  const s = await start(cand);
  const id = s.body.id;
  advance(65); // two questions' worth of time (30s + 2s grace each) has passed
  const g = await call("GET", `/api/interview/${id}`, cand);
  assert.equal(g.body.current.index, 2);
  assert.equal(g.body.current.remainingMs, 25000); // 65s - 2 x 30s = 5s used of question 3
  const late = await answer(cand, id, 0, 0);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "stale_question");
  assert.equal(late.body.state.current.index, 2);
  advance(1000);
  const done = await call("GET", `/api/interview/${id}`, cand);
  assert.equal(done.body.status, "rejected");
  assert.equal(done.body.result.review.every((q) => q.timedOut), true);
});

test("an answer just after the limit is still accepted", async () => {
  const s = await start(cand);
  advance(31);
  const r = await answer(cand, s.body.id, 0, 0); // question 1: option 0 is correct
  assert.equal(r.status, 200);
  assert.equal(r.body.current.index, 1);
  assert.equal(r.body.current.remainingMs, 30000);
  advance(1000);
  await call("GET", `/api/interview/${s.body.id}`, cand);
});

test("bad answers are refused", async () => {
  const s = await start(cand);
  const id = s.body.id;
  assert.equal((await answer(cand, id, 0, 4)).status, 400);
  assert.equal((await answer(cand, id, 0, -1)).status, 400);
  assert.equal((await answer(cand, id, 0, "1")).status, 400);
  assert.equal((await call("POST", `/api/interview/${id}/mcq/answer`, cand, { questionIndex: 0 })).status, 400);
  assert.equal((await answer(cand, id, 3, 0)).body.error, "stale_question");
  assert.equal((await answer(cand, id, 0, 0)).status, 200);
  assert.equal((await answer(cand, id, 0, 0)).status, 409); // sent twice
  advance(1000);
  await call("GET", `/api/interview/${id}`, cand);
});

test("a skipped question (null) counts as wrong", async () => {
  const s = await start(cand);
  const r = await answer(cand, s.body.id, 0, null);
  assert.equal(r.status, 200);
  advance(1000);
  const g = await call("GET", `/api/interview/${s.body.id}`, cand);
  assert.equal(g.body.result.review[0].timedOut, true);
});

test("one unfinished interview at a time", async () => {
  const s = await start(cand);
  const again = await start(cand);
  assert.equal(again.status, 409);
  assert.equal(again.body.interviewId, s.body.id);
  advance(1000); // everything times out, so the old one no longer blocks
  assert.equal((await start(cand)).status, 201);
  advance(1000);
});

test("other people cannot see or change an interview", async () => {
  const s = await start(cand);
  const id = s.body.id;
  assert.equal((await call("GET", `/api/interview/${id}`, other)).status, 404);
  assert.equal((await answer(other, id, 0, 0)).status, 404);
  assert.equal((await call("GET", `/api/interview/${id}`, rec)).status, 403);
  assert.equal((await call("GET", "/api/interview/not-an-id", cand)).status, 404);
  advance(1000);
  await call("GET", `/api/interview/${id}`, cand);
});

test("recent questions are passed to the AI so they are not repeated", async () => {
  advance(1000);
  const before = fake.ai.calls.length;
  await start(other);
  const first = fake.ai.calls[before];
  assert.deepEqual(first.exclude, []);
  advance(1000);
  await call("GET", "/api/interview/history", other);
  await start(other);
  const second = fake.ai.calls[before + 1];
  assert.ok(second.exclude.length >= 5);
  assert.deepEqual({ role: second.role, level: second.level, count: second.count }, { role: "Backend Developer", level: "mid", count: 5 });
  advance(1000);
  await call("GET", "/api/interview/history", other);
});

test("AI problems give clear errors and create nothing", async () => {
  const count = fake.interviews.rows.length;
  fake.ai.mode = "down";
  assert.deepEqual((await start(other)).body, { error: "ai_unavailable" });
  fake.ai.mode = "bad";
  assert.deepEqual((await start(other)).body, { error: "ai_bad_response" });
  fake.ai.mode = "ok";
  assert.equal(fake.interviews.rows.length, count);
});

test("history lists my interviews, newest first, with scores", async () => {
  const r = await call("GET", "/api/interview/history", cand);
  assert.equal(r.status, 200);
  assert.ok(r.body.interviews.length >= 5);
  const times = r.body.interviews.map((i) => i.createdAt);
  assert.deepEqual(times, [...times].sort().reverse());
  const passed = r.body.interviews.find((i) => i.status === "mcq_passed");
  assert.equal(passed.percent, 60);
  assert.ok(!JSON.stringify(r.body).match(/correctIndex|options/));
});

test("a conflicting save returns 409", async () => {
  const s = await start(cand);
  fake.interviews.failNextSave = "VersionError";
  assert.equal((await answer(cand, s.body.id, 0, 0)).status, 409);
  advance(1000);
  await call("GET", `/api/interview/${s.body.id}`, cand);
});

test("error responses do not leak internal details", async () => {
  const bad = await fetch(base + "/api/interview/start", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cand}` },
    body: "{not json",
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "bad_request" });
});
