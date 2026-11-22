import mongoose from "mongoose";

const { Schema } = mongoose;

export const LEVELS = ["junior", "mid", "senior"];
export const STATUSES = ["mcq_in_progress", "mcq_passed", "rejected", "interview_in_progress", "completed", "abandoned"];

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

// Phase 2 (voice interview): one "turn" is one question and the spoken answer to it.
const pauseSchema = new Schema(
  {
    initialMs: { type: Number, default: 0 }, // silence before the first word
    midMs: { type: [Number], default: [] }, // pauses of 3 seconds or more in the middle of the answer
    longInitial: { type: Boolean, default: false }, // initial pause longer than 5 seconds
    longMidCount: { type: Number, default: 0 },
    inconsistent: { type: Boolean, default: false }, // the browser claimed more pause time than really passed
  },
  { _id: false }
);

// Gaze tracking (Step 7). The browser reports what it noticed for each question; the server keeps the result.
export const GAZE_EVENT_TYPES = ["looking_away", "no_face", "multiple_faces"];
const gazeEventSchema = new Schema(
  {
    type: { type: String, enum: GAZE_EVENT_TYPES, required: true },
    at: { type: Date, required: true }, // when it started
    atMs: { type: Number, required: true }, // how long after the question was asked
    durationMs: { type: Number, required: true },
  },
  { _id: false }
);
const gazeSchema = new Schema(
  {
    status: { type: String, enum: ["on", "unavailable"], required: true }, // "unavailable" = tracking did not run, so nothing was checked
    reason: { type: String, default: null },
    samples: { type: Number, default: 0 }, // how many times the camera image was checked
    faceSamples: { type: Number, default: 0 }, // how many of those had a face in view
    events: { type: [gazeEventSchema], default: [] },
  },
  { _id: false }
);

const evaluationSchema = new Schema(
  {
    technical: Number,
    communication: Number,
    confidence: Number,
    overall: Number,
    feedback: String,
  },
  { _id: false }
);

const turnSchema = new Schema(
  {
    index: { type: Number, required: true },
    question: { type: String, required: true },
    type: { type: String, enum: ["opening", "follow_up", "clarify"], required: true },
    askedAt: { type: Date, required: true },
    answer: { type: String, default: null }, // null until answered, "" if skipped
    answeredAt: { type: Date, default: null },
    elapsedMs: { type: Number, default: null },
    pauses: { type: pauseSchema, default: undefined },
    evaluation: { type: evaluationSchema, default: undefined },
    gaze: { type: gazeSchema, default: undefined },
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
    voice: {
      total: { type: Number, default: 0 },
      currentIndex: { type: Number, default: 0 },
      turns: { type: [turnSchema], default: [] },
      startedAt: { type: Date, default: null },
      lastActivityAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      scores: {
        technical: { type: Number, default: null },
        communication: { type: Number, default: null },
        confidence: { type: Number, default: null },
        overall: { type: Number, default: null },
      },
      gaze: {
        status: { type: String, default: null }, // on | partial | unavailable, set when the interview ends
        events: { type: Number, default: 0 },
        lookingAway: { type: Number, default: 0 },
        noFace: { type: Number, default: 0 },
        multipleFaces: { type: Number, default: 0 },
        totalMs: { type: Number, default: 0 },
        samples: { type: Number, default: 0 },
        expectedSamples: { type: Number, default: 0 },
      },
      summary: {
        answered: { type: Number, default: 0 },
        longInitialCount: { type: Number, default: 0 },
        longMidCount: { type: Number, default: 0 },
        avgInitialMs: { type: Number, default: null },
      },
    },
  },
  { timestamps: true, optimisticConcurrency: true }
);

interviewSchema.index({ candidate: 1, createdAt: -1 });
// A candidate can have only one unfinished interview per phase. This also stops a double-click from creating two.
interviewSchema.index(
  { candidate: 1 },
  { unique: true, partialFilterExpression: { status: "mcq_in_progress" }, name: "one_open_interview_per_candidate" }
);
interviewSchema.index(
  { candidate: 1 },
  { unique: true, partialFilterExpression: { status: "interview_in_progress" }, name: "one_voice_interview_per_candidate" }
);

export const Interview = mongoose.models.Interview || mongoose.model("Interview", interviewSchema);
