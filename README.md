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
