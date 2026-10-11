from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from .llm import complete_json, LLMUnavailable, _cfg

app = FastAPI(title="Smart Interview AI Service")


@app.exception_handler(LLMUnavailable)
async def llm_unavailable(_req: Request, exc: LLMUnavailable):
    return JSONResponse(status_code=503, content={
        "error": "ai_busy", "message": str(exc), "retry_after": exc.retry_after})


@app.get("/health")
def health():
    c = _cfg()
    return {"status": "ok", "llm_mode": c["mode"], "model": c["model"] or None}


@app.get("/dev/llm-test")
def llm_test():
    """Temporary route to verify the gateway. Removed later."""
    msgs = [{"role": "user", "content": 'Reply with JSON only: {"pong": true, "word": "<any one word>"}'}]
    return complete_json(msgs, mock={"pong": True, "word": "mock"})
