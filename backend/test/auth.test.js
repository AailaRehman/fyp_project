import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "x".repeat(40);
process.env.MONGO_URI = "mongodb://localhost/test";
process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
process.env.CLIENT_URL = "http://localhost:5173";

const { createApp } = await import("../src/app.js");

function makeFakeUser() {
  const rows = [];
  let n = 0;
  const wrap = (r) => ({
    ...r, _id: r.id,
    toPublic: () => ({ id: r.id, name: r.name, email: r.email, role: r.role }),
  });
  return {
    findOne: (q) => {
      const r = rows.find((x) => x.email === q.email);
      const doc = r ? wrap(r) : null;
      return Object.assign(Promise.resolve(doc), { select: () => Promise.resolve(doc) });
    },
    findById: async (id) => { const r = rows.find((x) => x.id === id); return r ? wrap(r) : null; },
    create: async (d) => { const r = { id: String(++n), ...d }; rows.push(r); return wrap(r); },
  };
}

let server, base;
before(async () => {
  server = createApp({ userModel: makeFakeUser() }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, token) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });

const good = { name: "Test User", email: "Test@Example.com", password: "Passw0rdOK", role: "candidate" };
let token;

test("register creates user and returns token", async () => {
  const r = await post("/api/auth/register", good);
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.ok(d.token);
  assert.equal(d.user.email, "test@example.com");
  assert.equal(d.user.passwordHash, undefined);
});

test("duplicate email is rejected", async () => {
  assert.equal((await post("/api/auth/register", good)).status, 409);
});

test("weak password and bad role are rejected", async () => {
  assert.equal((await post("/api/auth/register", { ...good, email: "a@b.co", password: "short1" })).status, 400);
  assert.equal((await post("/api/auth/register", { ...good, email: "a@b.co", role: "admin" })).status, 400);
});

test("login works and wrong password fails", async () => {
  const bad = await post("/api/auth/login", { email: good.email, password: "wrongpass1" });
  assert.equal(bad.status, 401);
  const ok = await post("/api/auth/login", { email: good.email, password: good.password });
  assert.equal(ok.status, 200);
  token = (await ok.json()).token;
});

test("/me requires a valid token", async () => {
  assert.equal((await fetch(base + "/api/auth/me")).status, 401);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { authorization: "Bearer junk" } })).status, 401);
  const r = await fetch(base + "/api/auth/me", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).user.role, "candidate");
});
