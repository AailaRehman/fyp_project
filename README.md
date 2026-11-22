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

## Voice interview (Step 6, frontend)
Page: `/interview/:id/voice` (candidates only). The MCQ result page links to it after a pass.
- Needs Google Chrome or Microsoft Edge (Web Speech API), a camera and a microphone. Speech recognition needs an internet connection.
- Flow: turn on camera and microphone -> start -> each question is shown (and read aloud if switched on) -> the microphone listens -> "Done answering" or "Skip this question".
- There is no text box: an answer can only come from the microphone. The camera is shown during the interview but is not recorded yet (Step 9).
- Pause tracking (`src/utils/pauseTracker.js`): a message appears after 5 s of silence before answering, and after 3 s of silence mid-answer. All pauses are sent with the answer and shown in the results.
- Refreshing during an interview asks the candidate to continue; the same question comes back and the answer starts again.
- An answer ends by itself after 3 minutes or 3800 characters.
- Tests: `cd frontend && npm test` (pause tracker). `cd backend && npm test` covers the server side.

## Gaze tracking (Step 7)
The camera that is already on for the voice interview is also used to notice when the candidate looks away.
- MediaPipe Face Landmarker (`@mediapipe/tasks-vision` 1.2.2, Apache-2.0) is loaded **from a CDN in the browser** (`src/utils/mediapipe.js`). Nothing is installed. The model runs on the candidate's computer: no camera pictures are uploaded, only a note of when something was noticed.
- About every 2 seconds the image is checked (`src/hooks/useGazeTracker.js`). The decision logic is plain arithmetic in `src/utils/gaze.js` (tested with `npm test`).
- Events: `looking_away` (head turned more than 30 degrees, tilted more than 25, or eyes pointing far to a side or up/down), `no_face` (nobody in view), `multiple_faces` (more than one face in view). An event needs **two checks in a row**, so a glance or a blink is ignored.
- The ready screen learns how the candidate normally sits (their last few normal checks), so a slightly turned posture is not punished.
- Each answer carries the events from its question: `gaze: {status, samples, faceSamples, events:[{type, atMs, durationMs}]}`. The server caps them by the time that really passed, stores a timestamp and the question, and summarises at the end (`on`, `partial` or `unavailable`).
- **If MediaPipe cannot load or stops working, the interview carries on.** The data then says `unavailable` (with a reason), so "nothing was checked" is never mistaken for "nothing was noticed".
- The limits (30 / 25 / 0.45 / 0.5) are starting values and have **not been tuned on real people**. Change them in `CONFIG` in `src/utils/gaze.js` if honest candidates are flagged or obvious look-aways are missed.
- To check the real model on your computer: open the interview in Chrome, turn the camera on, and the line under the camera should say "Gaze check: on". Look to the side for about 6 seconds, finish the answer, and the results should list "Looked away from the screen".
