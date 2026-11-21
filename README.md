# Smart Interview AI (FYP)

Local-only development. No cloud resources until the final deployment phase.

## Run
1. `docker compose up -d`            (MongoDB on :27017)
2. backend:     `cd backend && cp .env.example .env && npm i && npm run dev`   (Node 20.6+)
3. ai-service:  `cd ai-service && python -m venv venv && venv\Scripts\activate` (Linux/Mac: `source venv/bin/activate`)
                `pip install -r requirements.txt && cp .env.example .env && uvicorn app.main:app --reload --port 8000`
4. frontend:    `cd frontend && cp .env.example .env && npm i && npm run dev`

Edit `backend/.env`: set JWT_SECRET to 32+ random chars.
AI runs in `LLM_MODE=mock` by default (zero quota). Switch to `groq` only when testing real output.

## Auth (Step 2)
- `POST /api/auth/register` `{name,email,password,role}` role = candidate | recruiter
- `POST /api/auth/login` `{email,password}`
- `GET /api/auth/me` (Bearer token)
- Backend tests: `cd backend && npm test` (no MongoDB needed)

## AI service endpoints (Step 4)
All run in mock mode by default (`LLM_MODE=mock`): no API calls, no quota. Level is `junior`, `mid` or `senior`.
- `POST /generate-mcq` `{role, level, count=10, exclude=[]}` -> `{questions:[{question, options[4], correct_index, explanation}]}`.
  The backend must strip `correct_index` and `explanation` before sending questions to the candidate.
- `POST /generate-question` `{role, level, question_number, previous_question, previous_answer, resume_summary}` -> `{question, type}`.
  `type` is `opening`, `follow_up` or `clarify` (answer under 5 words; no AI call). After question 1, send `previous_answer` (empty string for silence).
- `POST /evaluate-answer` `{role, level, question, answer, pauses:{initial_pause_s, mid_pauses_s[]}}` -> `{technical, communication, confidence, overall, feedback}` (0-10). An empty answer scores 0 with no AI call.
- `POST /generate-from-resume` `{role, level, resume_text, count=5}` -> `{questions:[{question, focus}]}`
- `POST /generate-roadmap` `{role, level, scores, mcq_percent, weak_areas, feedback}` -> `{summary, weeks:[4 x {week, focus, goals[], practice[]}]}`

Errors: `422` invalid input, `502 bad_ai_output` (AI reply failed validation twice), `503 ai_busy` (rate limit or outage; has `retry_after`).
Tests: `cd ai-service && python -m pytest`

## MCQ phase (Step 5)
Candidate-only endpoints (Bearer token). The server keeps the clock and the answer key; the browser only gets questions without answers.
- `POST /api/interview/start` `{role, level, count}` (count 3-15) -> first question. Calls the AI service. One unfinished interview per candidate (409 with `interviewId`).
- `GET /api/interview/:id` -> current question with `remainingMs`, or the result once finished. Refreshing never gives extra time.
- `POST /api/interview/:id/mcq/answer` `{questionIndex, selectedIndex | null}` -> next question or the result. `null` means no answer.
- `GET /api/interview/history` -> the candidate's interviews.
Rules: 30 seconds per question (`MCQ_SECONDS`, 5-120, default 30) plus 2 seconds network grace; an unanswered question is marked timed out by the server. 60% or more passes (`mcq_passed`, next phase = voice interview). Below 60% the interview ends with verdict `Reject` (`rejected`).
Practice interviews show the answer key only after the round ends.
Errors: `409 stale_question` (old or repeated answer, includes the current state), `502 ai_bad_response`, `503 ai_unavailable`.
Tests: `cd backend && npm test`

## Voice interview (Step 6, backend)
Phase 2 of an interview. Candidate-only. Only available after the MCQ round was passed (60% or more).
- `POST /api/interview/:id/voice/start` -> asks the AI service for question 1. Calling it again resumes without another AI call.
- `POST /api/interview/:id/voice/answer` `{turnIndex, answer, pauses:{initialPauseMs, midPausesMs[]}}` -> scores the answer and writes the next question from it (both AI calls run together). The last answer finishes the interview.
- `GET /api/interview/:id` and `GET /api/interview/history` now cover both phases.
Statuses: `mcq_in_progress`, `mcq_passed`, `rejected`, `interview_in_progress`, `completed`, `abandoned` (no activity for `INTERVIEW_IDLE_MINUTES`, default 30).
Settings: `INTERVIEW_QUESTIONS` (3-10, default 5), `INTERVIEW_IDLE_MINUTES` (5-240, default 30).
Pause rules: initial pause is "long" above 5 s; mid-answer pauses of 3 s or more are logged. The server caps pause data by the time that really passed. If the AI fails nothing is stored, so the same answer can be sent again.
Errors: `409 mcq_not_passed | stale_turn | interview_abandoned | already_completed | interview_in_progress`, `502 ai_bad_response`, `503 ai_unavailable`.
