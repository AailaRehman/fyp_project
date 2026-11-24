import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { Interview as InterviewModel } from "../models/Interview.js";
import { makeAiClient } from "../services/aiClient.js";
import { makeInterviewController } from "../controllers/interviewController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export function makeInterviewRouter({
  Interview = InterviewModel,
  ai = makeAiClient(),
  now,
  limitSeconds = env.MCQ_SECONDS,
  startLimit = 20,
  voiceQuestions = env.INTERVIEW_QUESTIONS,
  idleMinutes = env.INTERVIEW_IDLE_MINUTES,
  violationLimit = env.MAX_VIOLATIONS,
} = {}) {
  const router = Router();
  const c = makeInterviewController({ Interview, ai, now, limitSeconds, voiceQuestions, idleMinutes, violationLimit });
  // Every start calls the AI service, so starts are limited to protect the free quota.
  const startLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: startLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
  });
  router.use(requireAuth, requireRole("candidate"));
  router.post("/start", startLimiter, c.start);
  router.get("/history", c.history);
  router.get("/:id", c.get);
  router.post("/:id/mcq/answer", c.answer);
  router.post("/:id/voice/start", c.startVoice);
  router.post("/:id/voice/answer", c.answerVoice);
  router.post("/:id/violations", c.reportViolation);
  return router;
}
