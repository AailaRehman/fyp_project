import { Router } from "express";
import { dbState } from "../config/db.js";
import { env } from "../config/env.js";

const router = Router();

router.get("/", async (_req, res) => {
  let ai = "unreachable";
  try {
    const r = await fetch(`${env.AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    ai = r.ok ? "ok" : `status_${r.status}`;
  } catch {}
  res.json({ status: "ok", db: dbState(), ai, time: new Date().toISOString() });
});

export default router;
