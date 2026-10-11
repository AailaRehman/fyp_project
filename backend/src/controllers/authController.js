import bcrypt from "bcryptjs";
import { z } from "zod";
import { ROLES } from "../models/User.js";
import { signToken } from "../utils/token.js";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters")
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
  role: z.enum(ROLES),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

// Pre-computed hash so login takes similar time whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

function badRequest(res, parsed) {
  return res.status(400).json({
    error: "validation_error",
    issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
  });
}

export function makeAuthController(User) {
  return {
    async register(req, res) {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed);
      const { name, email, password, role } = parsed.data;

      if (await User.findOne({ email })) return res.status(409).json({ error: "email_taken" });
      const passwordHash = await bcrypt.hash(password, 12);
      let user;
      try {
        user = await User.create({ name, email, passwordHash, role });
      } catch (e) {
        if (e.code === 11000) return res.status(409).json({ error: "email_taken" });
        throw e;
      }
      res.status(201).json({ token: signToken(user), user: user.toPublic() });
    },

    async login(req, res) {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed);
      const { email, password } = parsed.data;

      const user = await User.findOne({ email }).select("+passwordHash");
      const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
      if (!user || !ok) return res.status(401).json({ error: "invalid_credentials" });
      res.json({ token: signToken(user), user: user.toPublic() });
    },

    async me(req, res) {
      const user = await User.findById(req.auth.userId);
      if (!user) return res.status(401).json({ error: "unauthorized" });
      res.json({ user: user.toPublic() });
    },
  };
}
