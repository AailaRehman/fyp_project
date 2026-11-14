import mongoose from "mongoose";

const { Schema } = mongoose;

export const LEVELS = ["junior", "mid", "senior"];
export const STATUSES = ["mcq_in_progress", "mcq_passed", "rejected"];

const questionSchema = new Schema(
  {
    question: { type: String, required: true },
    options: { type: [String], required: true },
    correctIndex: { type: Number, required: true, min: 0, max: 3 }, // never sent to the candidate while the round runs
    explanation: { type: String, default: "" },
  },
  { _id: false }
);

const answerSchema = new Schema(
  {
    index: { type: Number, required: true },
    selectedIndex: { type: Number, default: null }, // null = no answer, the time ran out
    correct: { type: Boolean, required: true },
    timedOut: { type: Boolean, required: true },
    answeredAt: { type: Date, required: true },
  },
  { _id: false }
);

const interviewSchema = new Schema(
  {
    candidate: { type: Schema.Types.ObjectId, ref: "User", required: true },
    mode: { type: String, enum: ["practice"], default: "practice" }, // recruiter sessions are added in Step 11
    role: { type: String, required: true, maxlength: 80 },
    level: { type: String, enum: LEVELS, required: true },
    status: { type: String, enum: STATUSES, required: true },
    verdict: { type: String, enum: ["Reject"], default: null },
    verdictReason: { type: String, default: null },
    mcq: {
      questions: { type: [questionSchema], default: [] },
      answers: { type: [answerSchema], default: [] },
      currentIndex: { type: Number, default: 0 },
      questionStartedAt: { type: Date },
      limitSeconds: { type: Number, required: true },
      correctCount: { type: Number, default: 0 },
      percent: { type: Number, default: null },
      passed: { type: Boolean, default: null },
      completedAt: { type: Date, default: null },
    },
  },
  { timestamps: true, optimisticConcurrency: true }
);

interviewSchema.index({ candidate: 1, createdAt: -1 });
// A candidate can have only one unfinished interview. This also stops a double-click from creating two.
interviewSchema.index(
  { candidate: 1 },
  { unique: true, partialFilterExpression: { status: "mcq_in_progress" }, name: "one_open_interview_per_candidate" }
);

export const Interview = mongoose.models.Interview || mongoose.model("Interview", interviewSchema);
