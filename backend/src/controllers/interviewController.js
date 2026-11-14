import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { AiError } from "../services/aiClient.js";
import { IN_PROGRESS, StateError, buildInterview, expireOverdue, publicState, submitAnswer, summary } from "../services/mcq.js";

const startSchema = z.object({
  role: z.string().trim().transform((s) => s.replace(/\s+/g, " ")).pipe(z.string().min(2).max(80)),
  level: z.enum(["junior", "mid", "senior"]),
  count: z.number().int().min(3).max(15).default(10),
});

const answerSchema = z.object({
  questionIndex: z.number().int().min(0).max(50),
  selectedIndex: z.number().int().min(0).max(3).nullable(),
});

// The AI service is a separate program, so its reply is checked again here instead of being trusted.
const aiMcqSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(5).max(600),
        options: z.array(z.string().trim().min(1).max(300)).length(4),
        correct_index: z.number().int().min(0).max(3),
        explanation: z.string().max(600).optional().default(""),
      }).refine((q) => new Set(q.options.map((o) => o.toLowerCase())).size === 4, "options must be distinct")
    )
    .min(1),
});

const badRequest = (res, parsed) =>
  res.status(400).json({
    error: "validation_error",
    issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
  });

export function makeInterviewController({ Interview, ai, now = () => new Date(), limitSeconds }) {
  const aiFail = (res, e) => {
    if (!(e instanceof AiError)) throw e;
    return e.kind === "bad_response"
      ? res.status(502).json({ error: "ai_bad_response" })
      : res.status(503).json({ error: "ai_unavailable" });
  };

  // Saves a document. A VersionError means another request changed it first (for example a double submit).
  async function save(doc, res) {
    try {
      await doc.save();
      return true;
    } catch (e) {
      if (e?.name === "VersionError") {
        res.status(409).json({ error: "conflict" });
        return false;
      }
      throw e;
    }
  }

  async function load(req, res) {
    const { id } = req.params;
    const doc = isValidObjectId(id) ? await Interview.findOne({ _id: id, candidate: req.auth.userId }) : null;
    if (!doc) {
      res.status(404).json({ error: "not_found" }); // also used for someone else's interview, so ids cannot be probed
      return null;
    }
    return doc;
  }

  return {
    async start(req, res) {
      const p = startSchema.safeParse(req.body);
      if (!p.success) return badRequest(res, p);
      const { role, level, count } = p.data;
      const candidate = req.auth.userId;

      const open = await Interview.findOne({ candidate, status: IN_PROGRESS });
      if (open) {
        if (expireOverdue(open, now()) && !(await save(open, res))) return;
        if (open.status === IN_PROGRESS) return res.status(409).json({ error: "interview_in_progress", interviewId: String(open._id) });
      }

      // Ask for new questions: tell the AI which ones this candidate saw recently.
      const recent = await Interview.find({ candidate }).sort({ createdAt: -1 }).limit(3);
      const exclude = recent.flatMap((d) => Array.from(d.mcq.questions, (q) => q.question)).slice(0, 45);

      let raw;
      try {
        raw = await ai.generateMcq({ role, level, count, exclude });
      } catch (e) {
        return aiFail(res, e);
      }
      const parsed = aiMcqSchema.safeParse(raw);
      if (!parsed.success || parsed.data.questions.length < count) return res.status(502).json({ error: "ai_bad_response" });

      let doc;
      try {
        doc = await Interview.create(
          buildInterview({ candidateId: candidate, role, level, questions: parsed.data.questions.slice(0, count), limitSeconds, now: now() })
        );
      } catch (e) {
        if (e?.code === 11000) return res.status(409).json({ error: "interview_in_progress" });
        throw e;
      }
      res.status(201).json(publicState(doc, now()));
    },

    async get(req, res) {
      const doc = await load(req, res);
      if (!doc) return;
      const t = now();
      if (expireOverdue(doc, t) && !(await save(doc, res))) return;
      res.json(publicState(doc, t));
    },

    async answer(req, res) {
      const doc = await load(req, res);
      if (!doc) return;
      const p = answerSchema.safeParse(req.body);
      if (!p.success) return badRequest(res, p);
      const t = now();
      let stateError = null;
      try {
        submitAnswer(doc, p.data, t);
      } catch (e) {
        if (!(e instanceof StateError)) throw e;
        stateError = e; // time-outs recorded before the error still need saving
      }
      if (!(await save(doc, res))) return;
      if (stateError) return res.status(409).json({ error: stateError.code, state: publicState(doc, t) });
      res.json(publicState(doc, t));
    },

    async history(req, res) {
      const docs = await Interview.find({ candidate: req.auth.userId }).sort({ createdAt: -1 }).limit(50);
      const t = now();
      for (const d of docs) {
        if (d.status === IN_PROGRESS && expireOverdue(d, t) && !(await save(d, res))) return;
      }
      res.json({ interviews: docs.map(summary) });
    },
  };
}
