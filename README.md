# Smart Interview AI (FYP)

Local-only development. No cloud resources until the final deployment phase.

## Run
1. `docker compose up -d`            (MongoDB on :27017)
2. server:      `cd server && cp .env.example .env && npm i && npm run dev`   (Node 20.6+)
3. ai-service:  `cd ai-service && python -m venv venv && venv\Scripts\activate` (Linux/Mac: `source venv/bin/activate`)
                `pip install -r requirements.txt && cp .env.example .env && uvicorn app.main:app --reload --port 8000`
4. client:      `cd client && cp .env.example .env && npm i && npm run dev`

Edit `server/.env`: set JWT_SECRET to 32+ random chars.
AI runs in `LLM_MODE=mock` by default (zero quota). Switch to `groq` only when testing real output.
