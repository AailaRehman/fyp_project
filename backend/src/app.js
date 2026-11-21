import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import health from "./routes/health.js";
import { makeAuthRouter } from "./routes/auth.js";
import { makeInterviewRouter } from "./routes/interview.js";

export function createApp({ userModel, interviewModel, aiClient, now, startLimit, voiceQuestions, idleMinutes } = {}) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", health);
  app.use("/api/auth", makeAuthRouter(userModel));
  app.use("/api/interview", makeInterviewRouter({ Interview: interviewModel, ai: aiClient, now, startLimit, voiceQuestions, idleMinutes }));

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, _req, res, _next) => {
    // Client mistakes (bad JSON, body too large) keep their status. Anything else is a 500 with no internal details.
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? "server_error" : status === 413 ? "payload_too_large" : "bad_request" });
  });
  return app;
}
