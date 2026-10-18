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
