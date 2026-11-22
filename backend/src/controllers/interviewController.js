import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { AiError } from "../services/aiClient.js";
import { IN_PROGRESS, StateError, buildInterview, expireOverdue, submitAnswer } from "../services/mcq.js";
import { ABANDONED, COMPLETED, GAZE_EVENT_TYPES, VOICE_IN_PROGRESS, expireIdle, sanitizeGaze, sanitizePauses, startVoice, submitTurn } from "../services/voice.js";
import { OPEN_STATUSES, publicState, summary } from "../services/state.js";

const MINUTE = 60 * 1000;

const startSchema = z.object({
  role: z.string().trim().transform((s) => s.replace(/\s+/g, " ")).pipe(z.string().min(2).max(80)),
  level: z.enum(["junior", "mid", "senior"]),
  count: z.number().int().min(3).max(15).default(10),
});

const answerSchema = z.object({
  questionIndex: z.number().int().min(0).max(50),
  selectedIndex: z.number().int().min(0).max(3).nullable(),
});

const voiceAnswerSchema = z.object({
  turnIndex: z.number().int().min(0).max(50),
  answer: z.string().max(4000),
  pauses: z
    .object({
      initialPauseMs: z.number().min(0).max(600000).default(0),
      midPausesMs: z.array(z.number().min(0).max(600000)).max(50).default([]),
    })
    .default({ initialPauseMs: 0, midPausesMs: [] }),
  // What the browser noticed with the camera while this question was open. Optional: older clients send nothing.
  gaze: z
    .object({
      status: z.enum(["on", "unavailable"]),
      reason: z.string().regex(/^[a-z_]{1,40}$/).optional(),
      samples: z.number().int().min(0).max(5000),
      faceSamples: z.number().int().min(0).max(5000),
      events: z
        .array(
          z.object({
            type: z.enum(GAZE_EVENT_TYPES),
            atMs: z.number().min(0).max(3600000),
            durationMs: z.number().min(0).max(3600000),
          })
        )
        .max(40),
    })
    .optional(),
});

// The AI service is a separate program, so everything it returns is checked again here instead of being trusted.
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

const aiQuestionSchema = z.object({
  question: z.string().trim().min(5).max(600),
  type: z.enum(["opening", "follow_up", "clarify"]),
});

const score = z.number().min(0).max(10);
const aiEvalSchema = z.object({
  technical: score,
  communication: score,
  confidence: score,
  overall: score,
  feedback: z.string().trim().min(1).max(1000),
});

const badRequest = (res, parsed) =>
  res.status(400).json({
    error: "validation_error",
    issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
  });

export function makeInterviewController({ Interview, ai, now = () => new Date(), limitSeconds, voiceQuestions = 5, idleMinutes = 30 }) {
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
      if (e?.code === 11000) {
        res.status(409).json({ error: "interview_in_progress" });
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

  // Closes anything whose time has run out. Returns true if the document changed and needs saving.
  const settle = (doc, t) =>
    doc.status === IN_PROGRESS ? expireOverdue(doc, t) : doc.status === VOICE_IN_PROGRESS ? expireIdle(doc, t, idleMinutes * MINUTE) : false;

  return {
    async start(req, res) {
      const p = startSchema.safeParse(req.body);
      if (!p.success) return badRequest(res, p);
      const { role, level, count } = p.data;
      const candidate = req.auth.userId;

      const open = await Interview.findOne({ candidate, status: { $in: OPEN_STATUSES } });
      if (open) {
        if (settle(open, now()) && !(await save(open, res))) return;
        if (OPEN_STATUSES.includes(open.status)) return res.status(409).json({ error: "interview_in_progress", interviewId: String(open._id) });
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
      if (settle(doc, t) && !(await save(doc, res))) return;
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

    // ---------- phase 2: voice interview ----------
    async startVoice(req, res) {
      const doc = await load(req, res);
      if (!doc) return;
      const t = now();
      if (settle(doc, t) && !(await save(doc, res))) return;
      if (doc.status === VOICE_IN_PROGRESS) return res.json(publicState(doc, t)); // already started: carry on, no new AI call
      if (doc.status !== "mcq_passed") {
        const error = doc.status === ABANDONED ? "interview_abandoned" : doc.status === COMPLETED ? "already_completed" : "mcq_not_passed";
        return res.status(409).json({ error, state: publicState(doc, t) });
      }
      const other = await Interview.findOne({ candidate: req.auth.userId, status: VOICE_IN_PROGRESS });
      if (other) return res.status(409).json({ error: "interview_in_progress", interviewId: String(other._id) });

      let raw;
      try {
        raw = await ai.generateQuestion({ role: doc.role, level: doc.level, question_number: 1 });
      } catch (e) {
        return aiFail(res, e);
      }
      const q = aiQuestionSchema.safeParse(raw);
      if (!q.success) return res.status(502).json({ error: "ai_bad_response" });

      startVoice(doc, q.data, { total: voiceQuestions, now: t });
      if (!(await save(doc, res))) return;
      res.status(201).json(publicState(doc, t));
    },

    async answerVoice(req, res) {
      const doc = await load(req, res);
      if (!doc) return;
      const p = voiceAnswerSchema.safeParse(req.body);
      if (!p.success) return badRequest(res, p);
      const t = now();
      if (settle(doc, t) && !(await save(doc, res))) return;
      if (doc.status !== VOICE_IN_PROGRESS) {
        const error = doc.status === ABANDONED ? "interview_abandoned" : "not_in_progress";
        return res.status(409).json({ error, state: publicState(doc, t) });
      }
      const v = doc.voice;
      if (p.data.turnIndex !== v.currentIndex) return res.status(409).json({ error: "stale_turn", state: publicState(doc, t) });

      const turn = v.turns[v.currentIndex];
      const answer = p.data.answer.replace(/\s+/g, " ").trim();
      const elapsed = new Date(t).getTime() - new Date(turn.askedAt).getTime();
      const pauses = sanitizePauses(p.data.pauses, elapsed);
      const gaze = sanitizeGaze(p.data.gaze, elapsed);
      const isLast = v.currentIndex + 1 >= v.total;

      // Scoring this answer and writing the next question do not depend on each other, so they run together.
      let rawEval, rawNext;
      try {
        [rawEval, rawNext] = await Promise.all([
          ai.evaluateAnswer({
            role: doc.role,
            level: doc.level,
            question: turn.question,
            answer,
            pauses: { initial_pause_s: pauses.initialMs / 1000, mid_pauses_s: pauses.midMs.map((x) => x / 1000) },
          }),
          isLast
            ? null
            : ai.generateQuestion({
                role: doc.role,
                level: doc.level,
                question_number: v.currentIndex + 2,
                previous_question: turn.question,
                previous_answer: answer,
              }),
        ]);
      } catch (e) {
        return aiFail(res, e); // nothing has been stored, so the candidate can simply send the answer again
      }
      const ev = aiEvalSchema.safeParse(rawEval);
      const next = isLast ? { success: true, data: null } : aiQuestionSchema.safeParse(rawNext);
      if (!ev.success || !next.success) return res.status(502).json({ error: "ai_bad_response" });

      submitTurn(doc, { turnIndex: p.data.turnIndex, answer, pauses, gaze }, ev.data, next.data, t);
      if (!(await save(doc, res))) return;
      res.json(publicState(doc, t));
    },

    async history(req, res) {
      const docs = await Interview.find({ candidate: req.auth.userId }).sort({ createdAt: -1 }).limit(50);
      const t = now();
      for (const d of docs) {
        if (settle(d, t) && !(await save(d, res))) return;
      }
      res.json({ interviews: docs.map(summary) });
    },
  };
}
