import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import health from "./routes/health.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", health);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: "server_error", message: err.message });
  });
  return app;
}
