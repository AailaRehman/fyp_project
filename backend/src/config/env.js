import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  AI_SERVICE_URL: z.string().url(),
  CLIENT_URL: z.string().url(),
  MCQ_SECONDS: z.coerce.number().int().min(5).max(120).default(30),
  INTERVIEW_QUESTIONS: z.coerce.number().int().min(3).max(10).default(5),
  INTERVIEW_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  MAX_VIOLATIONS: z.coerce.number().int().min(1).max(10).default(3),
  STORAGE_DRIVER: z.enum(["local", "cloudinary"]).default("local"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const i of parsed.error.issues) console.error(` - ${i.path.join(".")}: ${i.message}`);
  process.exit(1);
}
export const env = parsed.data;
