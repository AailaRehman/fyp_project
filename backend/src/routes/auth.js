import { Router } from "express";
import rateLimit from "express-rate-limit";
import { User } from "../models/User.js";
import { makeAuthController } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";

export function makeAuthRouter(UserModel = User) {
  const router = Router();
  const c = makeAuthController(UserModel);
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
  });
  router.post("/register", limiter, c.register);
  router.post("/login", limiter, c.login);
  router.get("/me", requireAuth, c.me);
  return router;
}

export default makeAuthRouter();
