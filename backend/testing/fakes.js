// In-memory stand-ins for MongoDB and the AI service. Used by the tests and by local end-to-end checks.
import { AiError } from "../src/services/aiClient.js";

export function makeFakeUser() {
  const rows = [];
  let n = 0;
  const id = () => (++n).toString(16).padStart(24, "0"); // looks like a real ObjectId
  const wrap = (r) => ({ ...r, _id: r.id, toPublic: () => ({ id: r.id, name: r.name, email: r.email, role: r.role }) });
  return {
    findOne: (q) => {
      const r = rows.find((x) => x.email === q.email);
      const doc = r ? wrap(r) : null;
      return Object.assign(Promise.resolve(doc), { select: () => Promise.resolve(doc) });
    },
    findById: async (i) => {
      const r = rows.find((x) => x.id === i);
      return r ? wrap(r) : null;
    },
    create: async (d) => {
      const r = { id: id(), ...d };
      rows.push(r);
      return wrap(r);
    },
  };
}

export function makeFakeInterview() {
  const rows = [];
  let n = 0;
  const matches = (row, q) =>
    Object.entries(q).every(([k, v]) =>
      v && typeof v === "object" && Array.isArray(v.$in) ? v.$in.map(String).includes(String(row[k])) : String(row[k]) === String(v)
    );
  const fake = {
    rows,
    failNextSave: null, // set to an error name to make the next save fail, e.g. "VersionError"
    async create(data) {
      const row = structuredClone(data);
      row._id = (++n).toString(16).padStart(24, "0");
      row.createdAt = new Date(2026, 0, 1, 0, 0, n);
      row.save = async () => {
        if (fake.failNextSave) {
          const name = fake.failNextSave;
          fake.failNextSave = null;
          throw Object.assign(new Error(name), { name });
        }
      };
      if (rows.some((r) => String(r.candidate) === String(row.candidate) && r.status === "mcq_in_progress" && row.status === "mcq_in_progress")) {
        throw Object.assign(new Error("duplicate key"), { code: 11000 });
      }
      rows.push(row);
      return row;
    },
    async findOne(q) {
      return rows.find((r) => matches(r, q)) || null;
    },
    find(q) {
      const list = rows.filter((r) => matches(r, q)).reverse(); // newest first
      const chain = {
        sort: () => chain,
        limit: (k) => Promise.resolve(list.slice(0, k)),
        then: (a, b) => Promise.resolve(list).then(a, b),
      };
      return chain;
    },
  };
  return fake;
}

export function makeFakeAi() {
  const words = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;
  const ai = {
    calls: [],
    questionCalls: [],
    evalCalls: [],
    mode: "ok", // "ok" | "down" | "bad"
    async generateMcq(body) {
      ai.calls.push(body);
      if (ai.mode === "down") throw new AiError("unavailable");
      if (ai.mode === "bad") return { questions: [{ question: "x", options: ["a"], correct_index: 0 }] };
      const call = ai.calls.length;
      return {
        questions: Array.from({ length: body.count }, (_, i) => ({
          question: `Call ${call} question ${i + 1}?`,
          options: ["A", "B", "C", "D"].map((o) => `${o} option ${i + 1}`),
          correct_index: i % 4,
          explanation: `Explanation ${i + 1}`,
        })),
      };
    },
    // Behaves like the real AI service: an opening question, a follow-up built from the previous answer,
    // and a "clarify" question when the previous answer was too short to build on.
    async generateQuestion(body) {
      ai.questionCalls.push(body);
      if (ai.mode === "down") throw new AiError("unavailable");
      if (ai.mode === "bad") return { question: "x", type: "nonsense" };
      if (body.question_number === 1) return { question: `Opening question for ${body.role}?`, type: "opening" };
      if (words(body.previous_answer) < 5) return { question: "Could you give one specific example?", type: "clarify" };
      return { question: `Follow-up ${body.question_number} about: ${body.previous_answer.slice(0, 24)}?`, type: "follow_up" };
    },
    // Scores equal the number of words in the answer (capped at 10), so tests can predict them exactly.
    async evaluateAnswer(body) {
      ai.evalCalls.push(body);
      if (ai.mode === "down") throw new AiError("unavailable");
      if (ai.mode === "bad") return { technical: 99, communication: -1, confidence: "high", feedback: "" };
      const n = Math.min(10, words(body.answer));
      return { technical: n, communication: n, confidence: n ? 5 : 0, overall: n, feedback: n ? `Feedback for ${n} words.` : "No answer was recorded." };
    },
  };
  return ai;
}
